import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import type { SidebarNotesSnapshot } from '../ui/protocol/sidebarNotes';
import { ActiveSearch } from '../ui/webview/activeSearch';
import { SidebarNotesView, SidebarNotesViewOptions } from '../ui/webview/sidebarNotes';
import { ThemePreview } from '../ui/webview/themePreview';
import { createPreferences } from './preferenceServices';

/** An in-memory store for the preferences. */
function createStore() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key: string, value: unknown) => void values.set(key, value),
  };
}

// Atlas is the entry Related Notes is about. Standup shares its tag, links
// to it on line 2, and names it on line 3; Budget only links to it, on
// line 2; Garden has nothing to do with it.
const NOTES: Array<[string, string]> = [
  ['/notes/atlas.md', '# Atlas #project/relay\nThe plan.\n'],
  ['/notes/standup.md', '# Standup #project/relay\n[[atlas]] depends on sign-off.\nThe atlas review is late.\n'],
  ['/notes/budget.md', '# Budget #finance\nSee [[atlas]].\n'],
  ['/notes/garden.md', '# Garden #hobby/garden\nTomatoes.\n'],
];

// After the update, Standup has none of that, and Relay takes the tag.
const UPDATED: Array<[string, string]> = [
  ['/notes/atlas.md', '# Atlas #project/relay\nThe plan.\n'],
  ['/notes/standup.md', '# Standup\nNothing about it now.\n'],
  ['/notes/budget.md', '# Budget #finance\nSee [[atlas]].\n'],
  ['/notes/garden.md', '# Garden #hobby/garden\nTomatoes.\n'],
  ['/notes/relay.md', '# Relay #project/relay\nThe launch.\n'],
];

/** The index of the notes given, each dated so the ranking is stable. */
function createIndex(notes: Array<[string, string]>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(notes.map(([filePath, text], at) => [filePath, parseMarkdown(filePath, text, { createdAt: 1 + at, updatedAt: 2 + at }, {})])),
  );
}

/** Lets the host finish handling a message the page posted. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A side-bar view as VS Code resolves one, with only what Related Notes
 * uses: what the host posts is kept, `send` delivers a message as the page
 * posts it, and `setVisible` shows or hides it, as collapsing the side bar
 * does.
 */
function createView() {
  const messages = new vscode.EventEmitter<unknown>();
  const visibility = new vscode.EventEmitter<void>();
  const disposal = new vscode.EventEmitter<void>();
  const posted: unknown[] = [];
  const view = {
    visible: true,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview://deckard',
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: (message: unknown) => {
        posted.push(JSON.parse(JSON.stringify(message)));
        return Promise.resolve(true);
      },
      onDidReceiveMessage: messages.event,
    },
    show: () => undefined,
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposal.event,
  };
  return {
    view: view as unknown as vscode.WebviewView,
    posted,
    send: async (message: unknown) => {
      messages.fire(JSON.parse(JSON.stringify(message)));
      await settle();
    },
    setVisible: (visible: boolean) => {
      view.visible = visible;
      visibility.fire();
    },
  };
}

/**
 * Runs `run` with commands, opened documents and editors, and messages
 * recorded rather than done, and returns what was recorded, in order: each
 * document opened, each editor shown, and each information message. Errors
 * are left out, since the e2e stand-in has no editor to reveal a line in.
 */
async function record(run: () => Promise<void>): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const window = vscode.window as unknown as Record<string, unknown>;
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const originals = [
    commands.executeCommand,
    window.showTextDocument,
    window.showInformationMessage,
    window.showWarningMessage,
    window.showErrorMessage,
    workspace.openTextDocument,
  ];
  const calls: unknown[][] = [];
  commands.executeCommand = async () => undefined;
  workspace.openTextDocument = async (uri: vscode.Uri) => {
    calls.push(['document', uri.fsPath]);
    return { uri, lineCount: 40, getText: () => '' };
  };
  window.showTextDocument = async (document: { uri: vscode.Uri }, options: { preview: boolean }) => {
    calls.push(['open', document.uri.fsPath, options.preview, 'viewColumn' in options]);
    return { document, selection: undefined, revealRange: () => undefined };
  };
  window.showInformationMessage = async (message: string) => void calls.push(['info', message]);
  window.showWarningMessage = async () => undefined;
  window.showErrorMessage = async () => undefined;
  try {
    await run();
  } finally {
    [
      commands.executeCommand,
      window.showTextDocument,
      window.showInformationMessage,
      window.showWarningMessage,
      window.showErrorMessage,
      workspace.openTextDocument,
    ] = originals;
  }
  return calls;
}

/**
 * Closes any editor an earlier suite left open, so Insert link has no note
 * to write in, and waits until VS Code says none is in front, so its event
 * cannot reach the sidebar and take the place of the entry chosen by hand.
 */
async function closeEditors(): Promise<void> {
  if (!vscode.window.activeTextEditor) {
    return;
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  for (let tries = 0; tries < 50 && vscode.window.activeTextEditor; tries += 1) {
    await settle();
  }
  await settle();
}

/**
 * Related Notes about Atlas's entry, chosen by hand as a hover's Show
 * Related Notes chooses it, so what it lists does not hang on an editor.
 */
async function openSidebar() {
  await closeEditors();
  let index = createIndex(NOTES);
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: (uri: vscode.Uri) => uri.fsPath,
    onDidUpdate: (listener: () => void) => updates.event(listener),
    parse: (uri: vscode.Uri, text: string) => parseMarkdown(uri.fsPath, text),
    refresh: async () => undefined,
  } as unknown as SidebarNotesViewOptions['indexer'];
  const preferences = createPreferences(createStore() as never);
  const sidebar = new SidebarNotesView({
    indexer,
    preferences,
    activeSearch: new ActiveSearch(),
    onOpenTag: () => undefined,
    extensionVersion: 'test',
    history: { write: async () => ({ applied: false, notes: [] }) } as never,
    themePreview: new ThemePreview(),
  });
  const view = createView();
  sidebar.resolveWebviewView(view.view);
  await record(() => sidebar.showRelatedNotesForEntry(vscode.Uri.file('/notes/atlas.md'), 1));
  const states = () =>
    view.posted
      .filter((message): message is { type: 'state'; data: SidebarNotesSnapshot } => (message as { type?: unknown }).type === 'state')
      .map((message) => message.data);
  const entryOf = (filePath: string) => [...index.sections.values()].find((section) => section.filePath === filePath)?.id;
  return {
    sidebar,
    view,
    states,
    entryOf,
    visits: () => ({ ...preferences.reader.value.sectionAccessCounts }),
    updateIndex: (notes: Array<[string, string]>) => {
      index = createIndex(notes);
      updates.fire();
    },
  };
}

suite('Related Notes host', () => {
  test('opens a line that links to or names the note, and a related note, counting only the note\'s visit', async () => {
    const { sidebar, view, states, entryOf, visits } = await openSidebar();
    try {
      const mention = states().at(-1)?.links?.mentions[0];
      assert.deepStrictEqual(mention && [mention.filePath, mention.line], ['/notes/standup.md', 3]);
      const calls = await record(async () => {
        await view.send({ type: 'openSource', filePath: '/notes/standup.md', line: 2 });
        await view.send({ type: 'openSource', filePath: '/notes/standup.md', line: 3, beside: true });
        await view.send({ type: 'openSource', filePath: '/notes/budget.md', line: 2 });
      });
      assert.deepStrictEqual(calls, [
        ['document', '/notes/standup.md'],
        ['open', '/notes/standup.md', false, false],
        ['document', '/notes/standup.md'],
        ['open', '/notes/standup.md', false, true],
        ['document', '/notes/budget.md'],
        ['open', '/notes/budget.md', false, false],
      ]);
      assert.deepStrictEqual(visits(), {}, 'a link row counts no visit');

      const opened = await record(() => view.send({ type: 'openSource', filePath: '/notes/standup.md', line: 1, pin: true }));
      assert.deepStrictEqual(opened, [['document', '/notes/standup.md'], ['open', '/notes/standup.md', false, false]]);
      assert.deepStrictEqual(visits(), { [entryOf('/notes/standup.md') as string]: 1 });
    } finally {
      sidebar.dispose();
    }
  });

  test('opens, links, and takes nothing it does not list', async () => {
    const { sidebar, view, visits } = await openSidebar();
    try {
      const calls = await record(async () => {
        // Garden is not related, and Atlas is the note itself.
        await view.send({ type: 'openSource', filePath: '/notes/garden.md', line: 1 });
        await view.send({ type: 'openSource', filePath: '/notes/budget.md', line: 1, beside: 'yes' });
        await view.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 1 });
        await view.send({ type: 'openSource', filePath: '/notes/missing.md', line: 1 });
        await view.send({ type: 'insertLink', filePath: '/notes/garden.md', line: 1 });
        await view.send({ type: 'insertLink', filePath: '/notes/standup.md', line: 2 });
        await view.send({ type: 'linkMention', filePath: '/notes/standup.md', line: 3, startColumn: 3 });
        await view.send({ type: 'linkMention', filePath: '/notes/budget.md', line: 2, startColumn: 4 });
        // Atlas has tags, so no tag is offered to it.
        await view.send({ type: 'addSuggestedTag', tagKey: '#project/relay' });
      });
      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(visits(), {});
    } finally {
      sidebar.dispose();
    }
  });

  test('writes a link to a related note, links a mention it lists, and links every mention of the note', async () => {
    const { sidebar, view, states } = await openSidebar();
    try {
      const mention = states().at(-1)?.links?.mentions[0];
      assert.ok(mention);
      const insert = await record(() => view.send({ type: 'insertLink', filePath: '/notes/standup.md', line: 1 }));
      // No note is open to write the link in, which the reader is told.
      assert.deepStrictEqual(insert, [['info', 'Open the note you want the link written in, then insert it.']]);
      const link = await record(() =>
        view.send({ type: 'linkMention', filePath: mention.filePath, line: mention.line, startColumn: mention.startColumn }),
      );
      // The stand-in note has changed since, so nothing is written.
      assert.deepStrictEqual(link, [['document', '/notes/standup.md']]);
      const linkAll = await record(() => view.send({ type: 'linkAllMentions' }));
      assert.deepStrictEqual(linkAll[0], ['document', '/notes/atlas.md']);
    } finally {
      sidebar.dispose();
    }
  });

  test('after an index update it is not shown, checks a click against the index as it is now', async () => {
    const { sidebar, view, states, entryOf, visits, updateIndex } = await openSidebar();
    try {
      const mention = states().at(-1)?.links?.mentions[0];
      assert.ok(mention);
      view.setVisible(false);
      const sent = states().length;
      updateIndex(UPDATED);
      await settle();
      assert.strictEqual(states().length, sent, 'a hidden sidebar is sent nothing');

      const calls = await record(async () => {
        // Standup is no longer related, links here no more, and names nothing.
        await view.send({ type: 'openSource', filePath: '/notes/standup.md', line: 1 });
        await view.send({ type: 'openSource', filePath: '/notes/standup.md', line: 2 });
        await view.send({ type: 'insertLink', filePath: '/notes/standup.md', line: 1 });
        await view.send({ type: 'linkMention', filePath: mention.filePath, line: mention.line, startColumn: mention.startColumn });
      });
      assert.deepStrictEqual(calls, []);

      // Relay is related now, though the page was never sent it.
      const relay = await record(() => view.send({ type: 'openSource', filePath: '/notes/relay.md', line: 1 }));
      assert.deepStrictEqual(relay, [['document', '/notes/relay.md'], ['open', '/notes/relay.md', false, false]]);
      assert.deepStrictEqual(visits(), { [entryOf('/notes/relay.md') as string]: 1 });
      const insert = await record(() => view.send({ type: 'insertLink', filePath: '/notes/relay.md', line: 1 }));
      assert.deepStrictEqual(insert, [['info', 'Open the note you want the link written in, then insert it.']]);
    } finally {
      sidebar.dispose();
    }
  });
});
