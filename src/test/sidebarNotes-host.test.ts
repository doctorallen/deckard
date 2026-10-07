import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService } from '../services/navigationService';
import type { CalendarMessage } from '../ui/protocol/calendar';
import type { SidebarNotesPageState, SidebarNotesSnapshot } from '../ui/protocol/sidebarNotes';
import { ActiveCalendar } from '../ui/webview/activeCalendar';
import { ActiveNotePage } from '../ui/webview/activeNotePage';
import { ActiveHome } from '../ui/webview/activeHome';
import { ActiveSearch } from '../ui/webview/activeSearch';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { SidebarNotesController } from '../ui/webview/pages/sidebarNotes/sidebarNotesController';
import { SidebarNotesView, SidebarNotesViewOptions } from '../ui/webview/sidebarNotes';
import { ThemePreview } from '../ui/webview/themePreview';
import { withConfigurationEvents } from './configurationEvents';
import { FakeSurface, recordSurface } from './fakeWebview';
import { captureTimingLog } from './timingLog';
import { setTimingLog } from '../shared/timing';
import { createPreferences } from './preferenceServices';
import { pageWebview, REPOSITORY_ROOT } from './pageWebview';
import { indexKeyOf } from './indexKeys';

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
    calls.push(['document', uri.path]);
    return { uri, lineCount: 40, getText: () => '' };
  };
  window.showTextDocument = async (document: { uri: vscode.Uri }, options: { preview: boolean }) => {
    calls.push(['open', document.uri.path, options.preview, 'viewColumn' in options]);
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
    getFilePath: indexKeyOf,
    onDidUpdate: (listener: () => void) => updates.event(listener),
    parse: (uri: vscode.Uri, text: string) => parseMarkdown(indexKeyOf(uri), text),
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
    extensionUri: vscode.Uri.file(REPOSITORY_ROOT),
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

/**
 * Runs `run` with commands recorded rather than run, and returns them in
 * order, each as its name and arguments.
 */
async function recordCommands(run: () => Promise<void>): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const original = commands.executeCommand;
  const calls: unknown[][] = [];
  commands.executeCommand = async (...call: unknown[]) => void calls.push(call);
  try {
    await run();
  } finally {
    commands.executeCommand = original;
  }
  return calls;
}

/**
 * The sidebar's controller, run by a `WebviewHost` on a fake view, with
 * Home and the calendar page able to come to the front: what it is sent,
 * the tags it opens, and what Home and the calendar were asked.
 */
function openController() {
  let index = createIndex(NOTES);
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: indexKeyOf,
    onDidUpdate: (listener: () => void) => updates.event(listener),
    parse: (uri: vscode.Uri, text: string) => parseMarkdown(indexKeyOf(uri), text),
    refresh: async () => undefined,
  } as unknown as SidebarNotesViewOptions['indexer'];
  const preferences = createPreferences(createStore() as never);
  const activeSearch = new ActiveSearch();
  const activeHome = new ActiveHome();
  const activeCalendar = new ActiveCalendar();
  const activeNotePage = new ActiveNotePage();
  const openedTags: string[] = [];
  const themePreview = new ThemePreview();
  const controller = new SidebarNotesController({
    indexer,
    preferences,
    activeSearch,
    activeHome,
    activeCalendar,
    activeNotePage,
    onOpenTag: (tagKey) => void openedTags.push(tagKey),
    extensionVersion: 'test',
    history: { write: async () => ({ applied: false, notes: [] }) } as never,
    themePreview,
    navigation: new NavigationService(),
    extensionUri: vscode.Uri.file(REPOSITORY_ROOT),
  });
  const host = new WebviewHost(controller, { indexer, themePreview });
  const surface = new FakeSurface();
  const asked: unknown[][] = [];
  const home = {
    getWidgetChoices: () => [{ value: 'calendar', label: 'Calendar' }],
    addWidget: (value: string) => void asked.push(['addWidget', value]),
    resetWidgets: async () => void asked.push(['resetWidgets']),
  };
  const calendar = {
    getDay: () => undefined,
    handleDayMessage: async (message: CalendarMessage) => void asked.push(['day', message]),
  };
  const states = () => surface.webview.postedOf<{ type: 'state'; data: SidebarNotesPageState }>('state').map((message) => message.data);
  return {
    host,
    surface,
    preferences,
    activeSearch,
    activeHome,
    activeCalendar,
    activeNotePage,
    home,
    calendar,
    asked,
    openedTags,
    states,
    send: (message: unknown) => surface.webview.send(message),
    updateIndex: (notes: Array<[string, string]>) => {
      index = createIndex(notes);
      updates.fire();
    },
    dispose: () => {
      host.dispose();
      activeSearch.dispose();
      activeHome.dispose();
      activeCalendar.dispose();
      activeNotePage.dispose();
      updates.dispose();
    },
  };
}

suite('Related Notes controller', () => {
  test('an edit to the theme and the Tasks view\'s search at once resets the HTML and sends the state, and the same pages are not sent again', async () => {
    await closeEditors();
    const { result: page, fire } = withConfigurationEvents(() => openController());
    try {
      page.host.attach(page.surface);
      await settle();
      const events = recordSurface(page.surface);
      fire('deckard.theme', 'deckard.agenda.query');
      assert.deepStrictEqual(events, ['html', 'post state']);
    } finally {
      page.dispose();
    }
  });

  test('tells the pages the sidebar is gone once it has let go of the view, so a redraw that asks for sends nothing', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      await settle();
      const source = { getRefineState: () => undefined, applySearch: async () => undefined };
      page.activeSearch.setActive(source);
      // A search page gives its Refine back when the sidebar goes, and
      // tells the sidebar its results changed.
      page.activeSearch.onDidChangeSidebarVisibility(() => page.activeSearch.notifyChanged(source));
      const sent = page.states().length;
      const lines = captureTimingLog(() => page.host.dispose(), [], 1).filter((line) => line.startsWith('[Related Notes]'));
      assert.deepStrictEqual(lines, ['[Related Notes] Skipped Related Notes refresh because no webview is attached.']);
      assert.strictEqual(page.states().length, sent);
      assert.strictEqual(page.activeSearch.isRefineInSidebar(source), false);
    } finally {
      page.dispose();
    }
  });

  test('takes its turn as Related Notes, and times its ranking with how many it found, as it always has', async () => {
    await closeEditors();
    const page = openController();
    try {
      const lines = captureTimingLog(() => page.host.attach(page.surface));
      assert.deepStrictEqual(lines, [`Related Notes: N ms (${page.states()[0].notes.length} results)`]);
      assert.strictEqual((page.host.controller as { name: string }).name, 'Related Notes');
    } finally {
      page.dispose();
    }
  });

  test('is sent its state when attached and again once published, says the sidebar is open, and says when it goes', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      assert.strictEqual(page.states().length, 1, 'at once');
      await settle();
      assert.strictEqual(page.states().length, 2, 'and once the index is published');
      assert.deepStrictEqual(page.states()[1].parkedTags, [], 'with the tags its menu may unpark');
      const source = { getRefineState: () => undefined, applySearch: async () => undefined };
      assert.strictEqual(page.activeSearch.isRefineInSidebar(source), false);
      page.activeSearch.setActive(source);
      assert.strictEqual(page.activeSearch.isRefineInSidebar(source), true, 'the sidebar is open');
      page.surface.dispose();
      assert.strictEqual(page.activeSearch.isRefineInSidebar(source), false, 'and is not once VS Code lets it go');
    } finally {
      page.dispose();
    }
  });

  test('a hidden sidebar is sent nothing, and is sent its state each time it is shown', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      await settle();
      const sent = page.states().length;
      page.surface.setVisible(false);
      page.updateIndex(UPDATED);
      await page.send({ type: 'ready' });
      assert.strictEqual(page.states().length, sent, 'nothing while hidden');
      page.surface.setVisible(true);
      assert.strictEqual(page.states().length, sent + 1, 'once when shown');
      page.surface.setVisible(false);
      page.surface.setVisible(true);
      assert.strictEqual(page.states().length, sent + 1, 'not again when nothing changed: the view draws its last state from its HTML');
      await page.send({ type: 'ready' });
      assert.strictEqual(page.states().length, sent + 2, 'and is sent it when the page asks');
      assert.deepStrictEqual(page.states()[sent + 1], page.states()[sent], 'the same state, not ranked again');
    } finally {
      page.dispose();
    }
  });

  test('is not kept running while hidden: hidden, its HTML carries the state it last posted, not ranked again', async () => {
    await closeEditors();
    const page = openController();
    try {
      assert.strictEqual(page.host.controller.options.retainContextWhenHidden, false);
      assert.strictEqual(page.host.controller.options.readsInertState, true);
      assert.strictEqual(page.host.controller.options.embedsSnapshot, undefined, 'ranking costs far more than Q3\'s 50 ms, so a shown view is posted its state');
      page.surface.htmlWebview = pageWebview as vscode.Webview;
      page.host.attach(page.surface);
      await settle();
      assert.ok(!String(page.surface.html).includes('id="state"'), 'shown, it opens on its loading line');
      const sent = page.states().length;
      const lines = captureTimingLog(() => page.surface.setVisible(false));
      assert.deepStrictEqual(lines, [], 'nothing is ranked for it');
      assert.strictEqual(page.states().length, sent);
      const carried = /<script type="application\/json" id="state">([^<]*)<\/script>/.exec(String(page.surface.html));
      assert.ok(carried, 'the hidden view\'s HTML carries a state');
      assert.deepStrictEqual(JSON.parse(carried[1]), page.states()[sent - 1], 'the last it posted');
      page.surface.setVisible(true);
      assert.strictEqual(page.states().length, sent, 'shown with nothing changed, it draws that state, and is not ranked or posted again');
    } finally {
      page.dispose();
    }
  });

  test('a reveal ranks once when the editor changed while the view was hidden, and not at all when nothing changed', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.surface.htmlWebview = pageWebview as vscode.Webview;
      page.host.attach(page.surface);
      await settle();
      /** Shows the view, as VS Code does, and the page it loads again says it is ready; what was ranked meanwhile. */
      const reveal = async (): Promise<string[]> => {
        let ready: Promise<void> = Promise.resolve();
        const lines = captureTimingLog(() => {
          page.surface.setVisible(true);
          ready = page.send({ type: 'ready' });
        });
        await ready;
        return lines.filter((line) => line.startsWith('Related Notes:'));
      };
      const sent = page.states().length;
      page.surface.setVisible(false);
      assert.deepStrictEqual(await reveal(), [], 'nothing changed while hidden: nothing is ranked');
      assert.strictEqual(page.states().length, sent + 1, 'the page that says ready is sent its last state');

      page.surface.setVisible(false);
      const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Elsewhere\n' });
      await vscode.window.showTextDocument(document);
      for (let tries = 0; tries < 50 && vscode.window.activeTextEditor?.document !== document; tries += 1) {
        await settle();
      }
      await settle();
      assert.strictEqual((await reveal()).length, 1, 'the editor changed while hidden: ranked once, for the reveal, and not again for ready');
      assert.strictEqual(page.states().length, sent + 3, 'the ranked state, then the same again for the page that says ready');
      assert.deepStrictEqual(page.states()[sent + 2], page.states()[sent + 1]);
    } finally {
      page.dispose();
      await closeEditors();
    }
  });

  test('a page loaded again is sent its state ranked anew once anything the ranking reads has changed', async () => {
    await closeEditors();
    const { result: page, fire } = withConfigurationEvents(() => openController());
    try {
      page.host.attach(page.surface);
      await settle();
      /** How many times the page that says ready, after `change`, is ranked for. */
      const count = async (change: () => unknown): Promise<number> => {
        await change();
        await settle();
        let ready: Promise<void> = Promise.resolve();
        const lines = captureTimingLog(() => {
          ready = page.send({ type: 'ready' });
        });
        await ready;
        return lines.filter((line) => line.startsWith('Related Notes:')).length;
      };
      assert.strictEqual(await count(() => undefined), 0, 'nothing changed');
      assert.strictEqual(await count(() => fire('deckard.display.dateFormat')), 1, 'a setting the ranking reads');
      assert.strictEqual(await count(() => page.preferences.usage.recordSectionAccess('anything')), 1, 'a visit the ranking counts');
      assert.strictEqual(await count(() => page.preferences.display.setHideDailyNotes(true)), 1, 'a preference');
      page.updateIndex(UPDATED);
      assert.strictEqual(await count(() => undefined), 0, 'an index update while shown was sent at once, so ready finds it current');
    } finally {
      page.dispose();
    }
  });

  test('runs the command each button asks for, with what it names', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      const calls = await recordCommands(async () => {
        await page.send({ type: 'openDashboard' });
        await page.send({ type: 'openNotesGraph' });
        await page.send({ type: 'openTaskBoard', query: '#a' });
        await page.send({ type: 'createDailyNote' });
        await page.send({ type: 'openHelp' });
        await page.send({ type: 'activateNotesGraphNode', nodeId: 'note:a', open: true });
        await page.send({ type: 'hoverNotesGraphNode', nodeId: 'note:a' });
        await page.send({ type: 'hoverNotesGraphNode' });
        await page.send({ type: 'parkTag', tagKey: '#a' });
        await page.send({ type: 'unparkTag', tagKey: '#a' });
      });
      assert.deepStrictEqual(calls, [
        ['deckard.showDashboard'],
        ['deckard.showNotesGraph'],
        ['deckard.showTaskBoard'],
        ['deckard.createDailyNote'],
        ['deckard.showHelp'],
        ['deckard.activateNotesGraphNode', 'note:a', true],
        ['deckard.highlightNotesGraphNode', 'note:a'],
        ['deckard.highlightNotesGraphNode', undefined],
        ['deckard.parkTag', '#a'],
        ['deckard.unparkTag', '#a'],
      ]);
    } finally {
      page.dispose();
    }
  });

  test('opens a tag the index has, as the reader may have written it', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      for (const tagKey of ['#project/relay', 'project/relay', '#Project/Relay', '#gone']) {
        await page.send({ type: 'openTag', tagKey });
      }
      assert.deepStrictEqual(page.openedTags, ['#project/relay', '#project/relay', '#project/relay']);
    } finally {
      page.dispose();
    }
  });

  test('writes each display choice and redraws with it', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      await settle();
      const sent = page.states().length;
      await page.send({ type: 'setRelatedNotesSort', mode: 'newest' });
      await page.send({ type: 'setHideDailyNotes', hide: true });
      await page.send({ type: 'setRelatedNotesPreviewLines', lines: 2 });
      await page.send({ type: 'clearEntryRelatedNotes' });
      const value = page.preferences.reader.value;
      assert.deepStrictEqual([value.relatedNotesSortMode, value.hideDailyNotes, value.relatedNotesPreviewLines], ['newest', true, 2]);
      assert.strictEqual(page.states().length, sent + 4, 'each redraws the sidebar');
      assert.deepStrictEqual(
        [page.states()[sent + 2].relatedNotesSortMode, page.states()[sent + 2].hideDailyNotes, page.states()[sent + 2].previewLines],
        ['newest', true, 2],
      );
    } finally {
      page.dispose();
    }
  });

  test('passes Home\'s Customize and the calendar\'s day to the page in front, and nothing while none is', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      await page.send({ type: 'homeAddWidget', value: 'calendar' });
      await page.send({ type: 'homeResetWidgets' });
      await page.send({ type: 'calendarDay', message: { type: 'openDay', date: '2026-09-24' } });
      assert.deepStrictEqual(page.asked, [], 'no page is in front');

      page.activeHome.setActive(page.home);
      assert.strictEqual(page.states().at(-1)?.state, 'customizeHome', 'Home in front redraws the sidebar');
      await page.send({ type: 'homeAddWidget', value: 'calendar' });
      await page.send({ type: 'homeAddWidget', value: 3 });
      await page.send({ type: 'homeResetWidgets' });
      page.activeCalendar.setActive(page.calendar);
      await page.send({ type: 'calendarDay', message: { type: 'openDay', date: '2026-09-24', extra: 1 } });
      await page.send({ type: 'calendarDay', message: { type: 'openDay', date: 'Thursday' } });
      assert.deepStrictEqual(page.asked, [
        ['addWidget', 'calendar'],
        ['resetWidgets'],
        ['day', { type: 'openDay', date: '2026-09-24' }],
      ]);
    } finally {
      page.dispose();
    }
  });

  test('follows the note the note page shows while it is in front, as it follows the editor', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      const source = { location: { filePath: '/notes/atlas.md' } as { filePath: string; line?: number } };
      page.activeNotePage.setActive(source);
      const shown = page.states().at(-1);
      assert.strictEqual(shown?.state, 'ready');
      assert.strictEqual(shown?.activeFileName, 'atlas.md');
      assert.ok(shown?.notes.some((note) => note.filePath === '/notes/standup.md'), 'Standup shares Atlas’s tag');
      assert.strictEqual(shown?.links?.linkedFromNoteCount, 2, 'Standup and Budget link to Atlas');

      source.location = { filePath: '/notes/garden.md', line: 2 };
      page.activeNotePage.notifyChanged(source);
      assert.strictEqual(page.states().at(-1)?.activeFileName, 'garden.md', 'a new note on the page ranks for it');

      page.activeNotePage.release(source);
      assert.strictEqual(page.states().at(-1)?.state, 'noMarkdown', 'with the page gone and no note in the editor, it shows no note');
    } finally {
      page.dispose();
    }
  });

  test('acts on nothing it does not accept', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      await settle();
      const sent = page.surface.webview.posted.length;
      const calls = await recordCommands(async () => {
        await page.send({ type: 'openTaskBoard', extra: undefined, query: 1 });
        await page.send({ type: 'setRelatedNotesSort', mode: 'random' });
        await page.send({ type: 'parkTag', tagKey: '#a', extra: 1 });
        await page.send({ type: 'activateNotesGraphNode', nodeId: '', open: true });
        await page.send({ type: 'toggleTask', taskId: 'a', completed: true });
        await page.send({ type: 'constructor' });
        await page.send('ready');
      });
      // openTaskBoard takes no search from the sidebar, so it still opens.
      assert.deepStrictEqual(calls, [['deckard.showTaskBoard']]);
      assert.strictEqual(page.surface.webview.posted.length, sent);
      assert.deepStrictEqual(page.openedTags, []);
    } finally {
      page.dispose();
    }
  });
  test('carries Deckard\'s pages at its top, every page kept, and a page asked for opens by its command', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      await settle();
      const pages = page.states()[0].pages;
      assert.strictEqual(pages?.style, 'list');
      assert.deepStrictEqual(pages?.pages.map((one) => one.id), ['home', 'board', 'calendar', 'today', 'graph', 'find', 'stats', 'help']);
      const calls = await recordCommands(() => page.send({ type: 'goToPage', page: 'board' }));
      assert.deepStrictEqual(calls, [['deckard.showTaskBoard']]);
      const none = await recordCommands(() => page.send({ type: 'goToPage', page: 'nowhere' }));
      assert.deepStrictEqual(none, [], 'an id that names no page opens nothing');
    } finally {
      page.dispose();
    }
  });

  test('sends the pages again when the reader chooses another look for them, without ranking again', async () => {
    await closeEditors();
    const page = openController();
    try {
      page.host.attach(page.surface);
      await settle();
      const sent = page.states().length;
      const last = page.states()[sent - 1];
      await page.preferences.display.setContextPagesStyle('list');
      assert.strictEqual(page.states().length, sent, 'the same pages are not sent again');
      const lines: string[] = [];
      const keep = (message: string): void => void lines.push(message);
      setTimingLog({ logLevel: 2, trace: keep, debug: keep, info: keep });
      try {
        await page.send({ type: 'setPagesStyle', style: 'icons' });
      } finally {
        setTimingLog(undefined);
      }
      assert.strictEqual(page.preferences.repository.current.contextPagesStyle, 'icons', 'kept in the preferences');
      assert.strictEqual(page.states().length, sent + 1);
      const again = page.states()[sent];
      assert.strictEqual(again.pages?.style, 'icons');
      assert.deepStrictEqual({ ...again, pages: undefined }, { ...last, pages: undefined }, 'the rest as it was');
      assert.deepStrictEqual(lines.filter((line) => line.startsWith('Related Notes:')), [], 'nothing ranked again');
      await page.send({ type: 'setPageShown', page: 'stats', shown: false });
      assert.deepStrictEqual(page.preferences.repository.current.contextPagesHidden, ['stats']);
      const latest = page.states()[page.states().length - 1];
      assert.ok(!latest.pages?.pages.some((one) => one.id === 'stats'), 'Stats is left out');
      assert.strictEqual(latest.pages?.choices?.find((choice) => choice.id === 'stats')?.shown, false, 'and the gear says so');
    } finally {
      page.dispose();
    }
  });
});
