import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService } from '../services/navigationService';
import type { SearchPageState } from '../ui/protocol/searchPage';
import { ActiveSearch } from '../ui/webview/activeSearch';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import {
  SearchIndexer,
  SearchPageController,
  SearchPageControllerOptions,
} from '../ui/webview/pages/searchPage/searchPageController';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { captureTimingLog } from './timingLog';
import { createPreferences } from './preferenceServices';
import { pageExtensionUri } from './pageWebview';

/** An in-memory store for the preferences. */
function createStore() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key: string, value: unknown) => void values.set(key, value),
  };
}

/** Four notes: a tag's hub, two entries with the tag, and one without it. */
function createIndex(): WorkspaceIndex {
  const files = [
    parseMarkdown('/notes/atlas.md', '---\ndescribes: project/atlas\n---\n# Atlas\nRetire the old ledger.\n'),
    parseMarkdown('/notes/planning.md', '## Atlas planning #project/atlas\nSequencing for the milestone.\n'),
    parseMarkdown('/notes/audit.md', '## Telemetry audit #project/atlas\nThe feed.\n- [ ] Send the audit summary\n'),
    parseMarkdown('/notes/beta.md', '## Beta kickoff #project/beta\nKickoff notes for beta.\n'),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

/**
 * A search page on `queryText`, attached to a fake panel: what it is sent,
 * the tab titles it names, the tags it opens, and what it tells the
 * sidebar, all in one log in the order they happen.
 */
function openSearchPage(queryText = '#project/atlas', options: { hasIndexed?: boolean } = {}) {
  let index = createIndex();
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    hasIndexed: options.hasIndexed,
    getSnapshot: () => index,
    getUri: (filePath: string) => vscode.Uri.file(filePath),
    getParkedRules: () => ({ tags: ['#risk/vendor'], notes: [] }),
    onDidUpdate: (listener: () => void) => updates.event(listener),
  } as unknown as SearchIndexer & { hasIndexed: boolean | undefined };
  const preferences = createPreferences(createStore() as never);
  const activeSearch = new ActiveSearch();
  const log: string[] = [];
  const openedTags: string[] = [];
  let closed = 0;
  activeSearch.onDidChange(() => log.push(`active ${activeSearch.active ? 'set' : 'none'}`));
  const source = { getRefineState: () => undefined, applySearch: async () => undefined };
  const controllerOptions: SearchPageControllerOptions = {
    originQuery: queryText,
    queryText,
    indexer,
    preferences,
    activeSearch,
    source,
    writes: {} as SearchPageControllerOptions['writes'],
    exports: {} as SearchPageControllerOptions['exports'],
    navigation: new NavigationService(),
    openTag: async (tagKey) => void openedTags.push(tagKey),
    extensionUri: pageExtensionUri(),
    setTitle: (title) => log.push(`title ${title}`),
    onDidClose: () => {
      closed += 1;
    },
  };
  const controller = new SearchPageController(controllerOptions);
  const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  const post = surface.webview.postMessage.bind(surface.webview);
  surface.webview.postMessage = (message: unknown) => {
    log.push(`post ${(message as { type: string }).type}`);
    return post(message);
  };
  host.attach(surface);
  const states = () => surface.webview.postedOf<{ type: 'state'; data: SearchPageState }>('state').map((message) => message.data);
  return {
    controller,
    host,
    surface,
    indexer,
    preferences,
    activeSearch,
    source,
    log,
    openedTags,
    closed: () => closed,
    states,
    last: () => states()[states().length - 1],
    send: (message: unknown) => surface.webview.send(message),
    updateIndex: (next: WorkspaceIndex = index) => {
      index = next;
      updates.fire();
    },
    dispose: () => {
      host.dispose();
      activeSearch.dispose();
    },
  };
}

/**
 * Runs `run` with commands and opened documents recorded rather than done,
 * and returns what was recorded, in order.
 */
async function record(run: () => Promise<void>): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const window = vscode.window as unknown as Record<string, unknown>;
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const originals = [commands.executeCommand, window.showTextDocument, workspace.openTextDocument];
  const calls: unknown[][] = [];
  commands.executeCommand = async (...call: unknown[]) => void calls.push(call);
  workspace.openTextDocument = async (uri: vscode.Uri) => ({ uri, lineCount: 40 });
  window.showTextDocument = async (document: { uri: vscode.Uri }, options: { preview: boolean; viewColumn?: number }) => {
    calls.push(['open', document.uri.fsPath, options.preview, 'viewColumn' in options]);
    return { document, selection: undefined, revealRange: () => undefined };
  };
  try {
    await run();
  } finally {
    [commands.executeCommand, window.showTextDocument, workspace.openTextDocument] = originals;
  }
  return calls;
}

suite('Search page host', () => {
  test('is kept running while hidden, for its search box, and opens on its loading line', () => {
    // Q1 of docs/implementation/20-webviews.md: a search page keeps retain,
    // so a search half built in the box outlives a hide. Its snapshot
    // takes 182 ms to build on 5,000 notes, over Q3's 50 ms, so it is
    // posted, never carried in the page's HTML.
    const page = openSearchPage();
    try {
      assert.strictEqual(page.controller.options.retainContextWhenHidden, true);
      assert.strictEqual(page.controller.options.readsInertState, undefined);
      assert.strictEqual(page.controller.options.embedsSnapshot, undefined);
    } finally {
      page.dispose();
    }
  });

  test('takes its turn as search page, and times its search as Search page, as it always has', () => {
    const page = openSearchPage();
    try {
      assert.strictEqual(page.controller.name, 'search page');
      assert.deepStrictEqual(captureTimingLog(() => page.host.refresh()), ['Search page: N ms']);
    } finally {
      page.dispose();
    }
  });

  test('names the tab, sends its snapshot, then tells the sidebar, and is the active search while in front', () => {
    const page = openSearchPage();
    try {
      page.host.refresh();
      assert.deepStrictEqual(page.log, ['active set', 'title Project: Atlas', 'post state', 'active set']);
      const state = page.last();
      assert.strictEqual(state.query.text, '#project/atlas');
      assert.deepStrictEqual(state.parkedTags, ['#risk/vendor'], 'the parked tags are sent with the snapshot');
      assert.strictEqual(state.refineInSidebar, false);

      page.log.length = 0;
      page.surface.setVisible(false);
      assert.deepStrictEqual(page.log, ['active none']);
    } finally {
      page.dispose();
    }
  });

  test('sends the Markdown view its cards without their rendered notes, and the HTML view with them', async () => {
    const page = openSearchPage();
    try {
      await page.preferences.display.setRenderMode('markdown');
      page.host.refresh();
      assert.ok(page.last().sections.length > 0);
      assert.ok(page.last().sections.every((card) => card.renderedHtml === '' && card.bodyTokens.length === 0));
      await page.preferences.display.setRenderMode('html');
      page.host.refresh();
      assert.ok(page.last().sections.some((card) => card.renderedHtml !== ''));
      assert.ok(page.last().sections.some((card) => card.bodyTokens.length > 0), 'as tokens too');
    } finally {
      page.dispose();
    }
  });

  test('a hidden page is marked stale and tells the sidebar, and is sent one snapshot when shown', () => {
    const page = openSearchPage();
    try {
      page.host.refresh();
      page.surface.setVisible(false);
      page.log.length = 0;
      page.updateIndex();
      page.activeSearch.setActive(page.source);
      page.log.length = 0;
      page.updateIndex();
      assert.deepStrictEqual(page.log, ['active set'], 'the stale page tells the sidebar, which reads it afresh');
      page.surface.setVisible(true);
      assert.deepStrictEqual(page.log, ['active set', 'title Project: Atlas', 'post state', 'active set']);
    } finally {
      page.dispose();
    }
  });

  test('before the first scan sends nothing and marks nothing stale, and draws once the scan is done', () => {
    const page = openSearchPage('#project/atlas', { hasIndexed: false });
    try {
      page.log.length = 0;
      page.host.refresh();
      page.updateIndex();
      page.surface.setVisible(false);
      page.host.refresh();
      page.surface.setVisible(true);
      assert.deepStrictEqual(page.log, ['active none', 'active set'], 'nothing is sent, and showing it again sends nothing');

      page.indexer.hasIndexed = true;
      page.log.length = 0;
      page.updateIndex();
      assert.deepStrictEqual(page.log, ['title Project: Atlas', 'post state', 'active set']);
    } finally {
      page.dispose();
    }
  });

  test('sends again when the sidebar takes or gives back Refine, and only then', () => {
    const page = openSearchPage();
    try {
      page.host.refresh();
      page.controller.refreshIfRefineMoved(page.host);
      assert.strictEqual(page.states().length, 1);
      page.activeSearch.setActive(page.source);
      page.activeSearch.setSidebarVisible(true);
      page.controller.refreshIfRefineMoved(page.host);
      assert.strictEqual(page.states().length, 2);
      assert.strictEqual(page.last().refineInSidebar, true);
      page.controller.refreshIfRefineMoved(page.host);
      assert.strictEqual(page.states().length, 2);
    } finally {
      page.dispose();
    }
  });

  test('runs, clears, and steps through searches, keeping text that does not parse in the box', async () => {
    const page = openSearchPage();
    try {
      await page.send({ type: 'setOverviewQuery', query: '#project/beta' });
      assert.strictEqual(page.last().query.text, '#project/beta');
      assert.deepStrictEqual(page.preferences.reader.value.recentQueries, ['#project/beta']);
      await page.send({ type: 'setOverviewQuery', query: 'text ~ ledger', remember: false });
      assert.deepStrictEqual(page.preferences.reader.value.recentQueries, ['#project/beta'], 'a step along the way is not remembered');
      await page.send({ type: 'setOverviewQuery', query: '(' });
      assert.strictEqual(page.last().query.text, 'text ~ ledger', 'the results stay as they were');
      assert.strictEqual(page.last().query.pending, '(');
      await page.send({ type: 'navigateSearchHistory', direction: 'back' });
      assert.strictEqual(page.last().query.text, '#project/beta');
      assert.strictEqual(page.last().query.pending, undefined);
      await page.send({ type: 'navigateSearchHistory', direction: 'forward' });
      assert.strictEqual(page.last().query.text, 'text ~ ledger');
      await page.send({ type: 'clearOverviewQuery' });
      assert.strictEqual(page.last().query.text, '#project/atlas');
      assert.deepStrictEqual(page.last().history, { back: true, forward: false });
      assert.strictEqual(page.controller.searchText(), '#project/atlas');
    } finally {
      page.dispose();
    }
  });

  test('narrows by the words being typed, from the first page, and ignores the same words twice', async () => {
    const page = openSearchPage();
    try {
      await page.send({ type: 'setResultPage', kind: 'notes', page: 3 });
      assert.strictEqual(page.states().length, 1);
      assert.strictEqual(page.last().notePaging.page, 1, 'clamped to the pages the search has');
      await page.send({ type: 'previewSearch', words: ['Ledger', ' '] });
      assert.strictEqual(page.states().length, 2);
      assert.deepStrictEqual(page.last().draftWords, ['ledger']);
      await page.send({ type: 'previewSearch', words: ['ledger'] });
      assert.strictEqual(page.states().length, 2, 'the same draft sends nothing');
    } finally {
      page.dispose();
    }
  });

  test('opens a tag as the reader may have written it, and parks tags and notes by their commands', async () => {
    const page = openSearchPage();
    try {
      const calls = await record(async () => {
        for (const tagKey of ['#project/beta', 'project/beta', '#Project/Beta', '#gone']) {
          await page.send({ type: 'openTag', tagKey });
        }
        await page.send({ type: 'parkTag', tagKey: '#project/beta' });
        await page.send({ type: 'unparkTag', tagKey: '#project/beta' });
        await page.send({ type: 'parkNote', filePath: '/notes/beta.md' });
        await page.send({ type: 'unparkNote', filePath: '/notes/beta.md' });
      });
      assert.deepStrictEqual(page.openedTags, ['#project/beta', '#project/beta', '#project/beta']);
      assert.deepStrictEqual(calls.map(([command, argument]) => [command, typeof argument === 'string' ? argument : (argument as vscode.Uri).fsPath]), [
        ['deckard.parkTag', '#project/beta'],
        ['deckard.unparkTag', '#project/beta'],
        ['deckard.parkNote', '/notes/beta.md'],
        ['deckard.unparkNote', '/notes/beta.md'],
      ]);
    } finally {
      page.dispose();
    }
  });

  test('opens the hub, a card counting its visit, or a task the page shows, and nothing else', async () => {
    const page = openSearchPage();
    try {
      page.host.refresh();
      const card = page.last().sections.find((section) => section.filePath === '/notes/planning.md');
      assert.ok(card);
      const calls = await record(async () => {
        await page.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 2 });
        await page.send({ type: 'openSource', filePath: '/notes/planning.md', line: 1, pin: true });
        await page.send({ type: 'openSource', filePath: '/notes/audit.md', line: 3, beside: true });
        await page.send({ type: 'openSource', filePath: '/notes/planning.md', line: 2 });
        await page.send({ type: 'openSource', filePath: '/notes/beta.md', line: 1 });
      });
      assert.deepStrictEqual(calls, [
        ['open', '/notes/atlas.md', true, false],
        ['open', '/notes/planning.md', false, false],
        ['open', '/notes/audit.md', true, true],
      ]);
      assert.deepStrictEqual(page.preferences.reader.value.sectionAccessCounts, { [card.id]: 1 });
    } finally {
      page.dispose();
    }
  });

  test('a page the reader closes is gone, and one disposed of is no longer the active search', () => {
    const page = openSearchPage();
    try {
      page.surface.dispose();
      assert.strictEqual(page.closed(), 1);
      const other = openSearchPage();
      other.log.length = 0;
      other.host.dispose();
      assert.deepStrictEqual(other.log, ['active none']);
      assert.strictEqual(other.surface.closed, true);
      other.activeSearch.dispose();
    } finally {
      page.dispose();
    }
  });

  test('acts on nothing it does not accept', async () => {
    const page = openSearchPage();
    try {
      const calls = await record(async () => {
        await page.send({ type: 'openHelp', section: 'periodic' });
        await page.send({ type: 'openSearch', query: '#a' });
        await page.send({ type: 'parkTag', tagKey: '#a', extra: 1 });
        await page.send({ type: 'setOverviewQuery', query: '#a', remember: true, extra: 1 });
        await page.send({ type: 'openTag', tagKey: '' });
      });
      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(page.openedTags, []);
      assert.deepStrictEqual(page.surface.webview.posted, []);
    } finally {
      page.dispose();
    }
  });
});
