import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService } from '../services/navigationService';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { StatsController, StatsControllerOptions } from '../ui/webview/pages/stats/statsController';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { createPreferences } from './preferenceServices';
import { pageExtensionUri, pageWebview } from './pageWebview';
import { openWebviewPage } from './webviewPage';

/** An in-memory store for the preferences. */
function createStore() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key: string, value: unknown) => void values.set(key, value),
  };
}

/**
 * Stats over two notes, attached to a fake panel: what the page is sent,
 * the tags it opens, the visits it counts, and the commands it runs.
 */
function openStats(options: { drawHtml?: boolean } = {}) {
  const files = [
    parseMarkdown('/notes/atlas.md', '# Atlas #project/relay\nSome words.\n- [ ] Call the vendor #once\n'),
    parseMarkdown('/notes/plain.md', 'Nothing to see here.\n'),
  ];
  let index: WorkspaceIndex = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getUnreadable: () => [],
    onDidUpdate: (listener: () => void) => updates.event(listener),
  } as unknown as StatsControllerOptions['indexer'];
  const preferences = createPreferences(createStore() as never);
  const openedTags: string[] = [];
  const controller = new StatsController({
    indexer,
    preferences,
    onOpenTag: (tagKey) => void openedTags.push(tagKey),
    navigation: new NavigationService(),
    extensionUri: pageExtensionUri(),
  });
  const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  if (options.drawHtml) {
    surface.htmlWebview = pageWebview as vscode.Webview;
  }
  host.attach(surface);
  const entry = [...index.sections.keys()][0];
  return {
    host,
    controller,
    surface,
    preferences,
    openedTags,
    entry,
    send: (message: unknown) => surface.webview.send(message),
    updateIndex: (next: WorkspaceIndex) => {
      index = next;
      updates.fire();
    },
  };
}

/**
 * Runs `run` with commands, quick picks, and opened documents recorded
 * rather than done, and returns what was recorded, in order.
 */
async function record(run: () => Promise<void>, pick?: (items: readonly vscode.QuickPickItem[], options: vscode.QuickPickOptions) => unknown): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const window = vscode.window as unknown as Record<string, unknown>;
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const originals = [commands.executeCommand, window.showQuickPick, window.showTextDocument, workspace.openTextDocument];
  const calls: unknown[][] = [];
  commands.executeCommand = async (...call: unknown[]) => void calls.push(call);
  window.showQuickPick = async (items: readonly vscode.QuickPickItem[], options: vscode.QuickPickOptions) => {
    calls.push(['pick', options.title, items.map((item) => item.label)]);
    return pick?.(items, options);
  };
  workspace.openTextDocument = async (uri: vscode.Uri) => ({ uri, lineCount: 40 });
  window.showTextDocument = async (document: { uri: vscode.Uri }, options: { preview: boolean; viewColumn?: number }) => {
    const editor = {
      document,
      selection: new vscode.Selection(0, 0, 0, 0),
      revealRange: () =>
        calls.push(['open', document.uri.fsPath, editor.selection.active.line + 1, options.preview, options.viewColumn === vscode.ViewColumn.Beside]),
    };
    return editor;
  };
  try {
    await run();
  } finally {
    [commands.executeCommand, window.showQuickPick, window.showTextDocument, workspace.openTextDocument] = originals;
  }
  return calls;
}

suite('Stats host', () => {
  test('sends its snapshot, again when a visit is recorded, and once on showing after a hidden update', async () => {
    const { host, surface, preferences, updateIndex } = openStats();
    try {
      host.refresh();
      const states = () => surface.webview.postedOf<{ type: 'state'; data: { fileCount: number; sectionViews: unknown[] } }>('state');
      assert.strictEqual(states().length, 1);
      assert.strictEqual(states()[0].data.fileCount, 2);

      await preferences.usage.recordTagAccess('#project/relay');
      assert.strictEqual(states().length, 2, 'a recorded view redraws the page');

      surface.setVisible(false);
      updateIndex(buildWorkspaceIndex(new Map()));
      assert.strictEqual(states().length, 2, 'nothing is sent while hidden');
      surface.setVisible(true);
      assert.strictEqual(states().length, 3);
      assert.strictEqual(states()[2].data.fileCount, 0, 'with the newest index');
    } finally {
      host.dispose();
    }
  });

  test('is not kept running while hidden: its hidden HTML carries the last snapshot it was sent, and showing it sends one only if it missed one', () => {
    const { host, controller, surface, updateIndex } = openStats({ drawHtml: true });
    const pages: ReturnType<typeof openWebviewPage>[] = [];
    try {
      assert.strictEqual(controller.options.retainContextWhenHidden, false);
      assert.ok(String(surface.html).includes('Loading statistics…'), 'it opens on its loading line');
      assert.ok(!String(surface.html).includes('id="state"'));
      let builds = 0;
      const build = controller.buildSnapshot.bind(controller);
      controller.buildSnapshot = () => {
        builds += 1;
        return build();
      };
      host.refresh();
      const [sent] = surface.webview.postedOf<{ data: { fileCount: number } }>('state');
      surface.setVisible(false);
      assert.strictEqual(builds, 1, 'the snapshot it carries is the one sent, not built again');
      const carried = /<script type="application\/json" id="state">([^<]*)<\/script>/.exec(String(surface.html));
      assert.ok(carried, 'the hidden page\'s HTML carries a snapshot');
      assert.deepStrictEqual(JSON.parse(carried[1]), sent.data);

      // VS Code loads that HTML when the tab is shown: the page draws it at
      // once, asking for nothing, as it drew the snapshot it was sent.
      const reloaded = openWebviewPage(String(surface.html));
      const drawn = openWebviewPage(String(surface.html).replace(carried[0], ''), sent.data);
      pages.push(reloaded, drawn);
      assert.strictEqual(reloaded.findAll('#app .loading').length, 0);
      assert.strictEqual(reloaded.posted.length, 0);
      assert.strictEqual(reloaded.find('#app').innerHTML, drawn.find('#app').innerHTML);

      surface.setVisible(true);
      assert.strictEqual(surface.webview.postedOf('state').length, 1, 'shown, it missed nothing');
      surface.setVisible(false);
      updateIndex(buildWorkspaceIndex(new Map()));
      assert.strictEqual(builds, 1, 'nothing is built while hidden');
      surface.setVisible(true);
      const states = surface.webview.postedOf<{ data: { fileCount: number } }>('state');
      assert.deepStrictEqual(states.map((state) => state.data.fileCount), [2, 0], 'shown, it is sent the update it missed');
    } finally {
      pages.forEach((page) => page.dispose());
      host.dispose();
    }
  });

  test('opens a tag the index has, as the reader may have written it', async () => {
    const { host, send, openedTags } = openStats();
    try {
      for (const tagKey of ['#project/relay', 'project/relay', '#Project/Relay', '#gone']) {
        await send({ type: 'openTag', tagKey });
      }
      assert.deepStrictEqual(openedTags, ['#project/relay', '#project/relay', '#project/relay']);
    } finally {
      host.dispose();
    }
  });

  test('opens an entry and counts its visit, opens any line of a note, and nothing else', async () => {
    const { host, send, preferences, entry } = openStats();
    try {
      const calls = await record(async () => {
        await send({ type: 'openSource', filePath: '/notes/atlas.md', line: 1 });
        await send({ type: 'openSource', filePath: '/notes/plain.md', line: 1, beside: true, pin: true });
        await send({ type: 'openSource', filePath: '/notes/missing.md', line: 1 });
      });
      assert.deepStrictEqual(calls, [
        ['open', '/notes/atlas.md', 1, true, false],
        ['open', '/notes/plain.md', 1, false, true],
      ]);
      assert.deepStrictEqual(preferences.reader.value.sectionAccessCounts, { [entry]: 1 });
    } finally {
      host.dispose();
    }
  });

  test('runs the command each total and list asks for', async () => {
    const { host, send } = openStats();
    try {
      const calls = await record(async () => {
        await send({ type: 'openSearch', query: 'link = [[Q4 offsite]]' });
        await send({ type: 'openNotesGraph', onlyWrittenLinks: true });
        await send({ type: 'reindexWorkspace' });
        await send({ type: 'mergeTags', sourceKey: 'once', targetKey: '#project/relay' });
        await send({ type: 'mergeTags', sourceKey: '#once', targetKey: '#gone' });
        await send({ type: 'mergeTags', sourceKey: '#Once', targetKey: 'once' });
        await send({ type: 'mergeTagInto', sourceKey: 'Once' });
        await send({ type: 'mergeTagInto', sourceKey: '#gone' });
      });
      assert.deepStrictEqual(calls, [
        ['deckard.search', 'link = [[Q4 offsite]]'],
        ['deckard.showNotesGraph', { onlyWrittenLinks: true }],
        ['deckard.reindexWorkspace'],
        ['deckard.mergeTag', '#once', '#project/relay'],
        ['deckard.mergeTag', '#once'],
      ]);
    } finally {
      host.dispose();
    }
  });

  test('a Tags total or a band opens the tag chosen from the ones it counts', async () => {
    const { host, send, openedTags } = openStats();
    try {
      const calls = await record(async () => {
        await send({ type: 'openTagList', namespaced: false });
        await send({ type: 'openTagList', namespaced: true });
        await send({ type: 'openTagList', namespaced: false, min: 1, max: 1 });
      }, (items) => items[0]);
      assert.deepStrictEqual(calls, [
        ['pick', 'Tags', ['#once', '#project/relay']],
        ['pick', 'Namespaced tags', ['#project/relay']],
        ['pick', 'Tags used once', ['#once', '#project/relay']],
      ]);
      assert.deepStrictEqual(openedTags, ['#once', '#project/relay', '#once']);
    } finally {
      host.dispose();
    }
  });

  test('makes no note when no link names a missing one, and acts on nothing it does not accept', async () => {
    const { host, send, surface, openedTags } = openStats();
    try {
      const calls = await record(async () => {
        await send({ type: 'createMissingNotes', names: [] });
        await send({ type: 'createMissingNotes', names: ['Q4 offsite'] });
        await send({ type: 'toggleTask', taskId: 'a', completed: true });
        await send({ type: 'openTag', tagKey: '' });
        await send({ type: 'reindexWorkspace', now: true });
      });
      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(openedTags, []);
      assert.deepStrictEqual(surface.webview.posted, []);
    } finally {
      host.dispose();
    }
  });
});
