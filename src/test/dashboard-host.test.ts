import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService } from '../services/navigationService';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import {
  DashboardController,
  DashboardControllerOptions,
  DashboardNavigation,
} from '../ui/webview/pages/dashboard/dashboardController';
import { ThemePreview } from '../ui/webview/themePreview';
import { withConfigurationEvents } from './configurationEvents';
import { FakeSurface, recordSurface } from './fakeWebview';
import { captureTimingLog } from './timingLog';
import { createPreferences } from './preferenceServices';
import { createTaskWrites } from './taskWrites';

/** An in-memory store for the preferences. */
function createStore() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key: string, value: unknown) => void values.set(key, value),
  };
}

/** A note with an entry and ten open tasks, enough for Try next to suggest the Task board. */
function createIndex(): WorkspaceIndex {
  const tasks = Array.from({ length: 10 }, (_, at) => `- [ ] Task ${at + 1}`).join('\n');
  const files = [
    parseMarkdown('/notes/atlas.md', `# Atlas #project/relay\nSome words.\n${tasks}\n`),
    parseMarkdown('/notes/plain.md', 'Nothing to see here.\n'),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

/**
 * Where Home sent the reader, in order; a quick add containing "refused" is
 * not added, and one containing "read-only" fails as a read-only disk would.
 */
function createNavigation(): DashboardNavigation & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    openTag: (tagKey) => void opened.push(`tag ${tagKey}`),
    openSearch: (query) => void opened.push(`search ${query}`),
    openTaskBoard: (query) => void opened.push(`board ${query ?? ''}`),
    openDailyNote: () => void opened.push('today'),
    quickAdd: (text) => {
      opened.push(`add ${text}`);
      if (text.includes('read-only')) {
        throw new Error('EROFS: read-only file system');
      }
      return !text.includes('refused');
    },
    createHubNote: (tagKey) => void opened.push(`hub ${tagKey}`),
  };
}

/** Try next's ledger, keeping what it was told. */
function createLedger() {
  const told: string[] = [];
  const changes = new vscode.EventEmitter<void>();
  return {
    told,
    retired: () => new Set<string>(),
    snoozed: () => ({}),
    retire: async (key: string) => void told.push(`retire ${key}`),
    snooze: async (key: string) => void told.push(`snooze ${key}`),
    onDidChange: changes.event,
    fire: () => changes.fire(),
  };
}

/**
 * Home over two notes, attached to a fake panel in front: what the page is
 * sent, where it sends the reader, and whether it is the active source.
 * `scan.hasIndexed` false opens it during the first scan, with no notes.
 */
function openHome(scan: { hasIndexed: boolean } = { hasIndexed: true }) {
  let index = scan.hasIndexed ? createIndex() : buildWorkspaceIndex(new Map());
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    get hasIndexed() {
      return scan.hasIndexed;
    },
    getSnapshot: () => index,
    onDidUpdate: (listener: () => void) => updates.event(listener),
    getParkedRules: () => ({ tags: ['#parked'], hasFolders: false, isParkedPath: () => false }),
  } as unknown as DashboardControllerOptions['indexer'];
  const preferences = createPreferences(createStore() as never);
  const navigation = createNavigation();
  const ledger = createLedger();
  const controller = new DashboardController({
    indexer,
    preferences,
    extensionUri: vscode.Uri.file('/ext'),
    navigation,
    tryNext: ledger,
    writes: createTaskWrites(),
    navigationService: new NavigationService(),
  });
  const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  host.attach(surface);
  type State = { type: 'state'; data: { parkedTags: string[]; widgets?: unknown[]; viewState: { mode: string }; tagColumns: number } };
  return {
    controller,
    host,
    surface,
    preferences,
    navigation,
    ledger,
    entry: [...index.sections.keys()][0],
    send: (message: unknown) => surface.webview.send(message),
    states: () => surface.webview.postedOf<State>('state'),
    updateIndex: () => {
      index = createIndex();
      updates.fire();
    },
    dispose: () => {
      host.dispose();
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
    const editor = {
      document,
      selection: new vscode.Selection(0, 0, 0, 0),
      revealRange: () =>
        calls.push(['open', document.uri.path, editor.selection.active.line + 1, options.preview, options.viewColumn === vscode.ViewColumn.Beside]),
    };
    return editor;
  };
  try {
    await run();
  } finally {
    [commands.executeCommand, window.showTextDocument, workspace.openTextDocument] = originals;
  }
  return calls;
}

suite('Dashboard host', () => {
  test('is kept running while hidden, for arranging Home and its search box, and opens on its loading line', () => {
    // Q1 of docs/implementation/20-webviews.md: the Dashboard keeps retain,
    // so a search half built in Home's box and a widget's open gear outlive
    // a hide. Its snapshot takes 394 ms to build on 5,000 notes, over Q3's
    // 50 ms, so it is posted, never carried in the page's HTML.
    const home = openHome();
    try {
      assert.strictEqual(home.controller.options.retainContextWhenHidden, true);
      assert.strictEqual(home.controller.options.readsInertState, undefined);
      assert.strictEqual(home.controller.options.embedsSnapshot, undefined);
    } finally {
      home.dispose();
    }
  });

  test('an edit to the theme and the agenda at once resets the HTML before either sends a snapshot', () => {
    const { result: home, fire } = withConfigurationEvents(() => openHome());
    try {
      const events = recordSurface(home.surface);
      fire('deckard.theme', 'deckard.agenda.query');
      assert.deepStrictEqual(events, ['html', 'post state', 'post state']);
    } finally {
      home.dispose();
    }
  });

  test('takes its turn as Home, and times its snapshot, posted, as Dashboard, as it always has', () => {
    const home = openHome();
    try {
      assert.strictEqual(home.controller.name, 'Home');
      assert.deepStrictEqual(captureTimingLog(() => home.host.refresh()), ['Dashboard: N ms']);
    } finally {
      home.dispose();
    }
  });

  test('sends its snapshot with the parked tags, and Home\'s widgets only while Home is shown', async () => {
    const home = openHome();
    try {
      home.host.refresh();
      assert.strictEqual(home.states().length, 1);
      assert.deepStrictEqual(home.states()[0].data.parkedTags, ['#parked']);
      assert.ok(Array.isArray(home.states()[0].data.widgets));

      await home.send({ type: 'setDashboardMode', mode: 'browse' });
      const [, browse] = home.states();
      assert.strictEqual(browse.data.viewState.mode, 'browse', 'the tab is redrawn before it is saved');
      assert.strictEqual(browse.data.widgets, undefined);
      assert.strictEqual(home.preferences.reader.value.dashboardViewState.mode, 'browse');

      await home.send({ type: 'setDashboardColumns', section: 'tags', columns: 4 });
      assert.ok(home.states().some((state) => state.data.tagColumns === 4));
      assert.strictEqual(home.preferences.reader.value.dashboardTagColumns, 4);
    } finally {
      home.dispose();
    }
  });

  test('two quick tab or column choices end on the last, with no flip back', async () => {
    const home = openHome();
    try {
      // The page does not wait for one save before sending the next choice.
      const before = home.states().length;
      await Promise.all([
        home.send({ type: 'setDashboardMode', mode: 'browse' }),
        home.send({ type: 'setDashboardMode', mode: 'home' }),
      ]);
      const modes = home.states().slice(before).map((state) => state.data.viewState.mode);
      assert.deepStrictEqual(modes.slice(modes.indexOf('home')).filter((mode) => mode !== 'home'), [], `${modes}`);
      assert.strictEqual(home.preferences.reader.value.dashboardViewState.mode, 'home');

      const next = home.states().length;
      await Promise.all([
        home.send({ type: 'setDashboardColumns', section: 'tags', columns: 3 }),
        home.send({ type: 'setDashboardColumns', section: 'tags', columns: 4 }),
      ]);
      const columns = home.states().slice(next).map((state) => state.data.tagColumns);
      assert.deepStrictEqual(columns.slice(columns.indexOf(4)).filter((count) => count !== 4), [], `${columns}`);
      assert.strictEqual(home.preferences.reader.value.dashboardTagColumns, 4);
    } finally {
      home.dispose();
    }
  });

  test('is sent nothing during the first scan, so an empty index never says there are no notes', async () => {
    const scan = { hasIndexed: false };
    const home = openHome(scan);
    try {
      home.host.refresh();
      // A preference saved while the scan runs would redraw Home.
      await home.preferences.display.setTagSortMode('count');
      assert.strictEqual(home.states().length, 0, 'Home stays on its loading line');

      scan.hasIndexed = true;
      home.updateIndex();
      const states = home.states() as unknown as Array<{ data: { totalNoteCount: number } }>;
      assert.strictEqual(states.length, 1);
      assert.ok(states[0].data.totalNoteCount > 0, 'drawn from the scanned notes');
    } finally {
      home.dispose();
    }
  });

  test('is sent nothing while hidden, one snapshot when shown, and one when shown on a new day', () => {
    const home = openHome();
    try {
      home.host.refresh();
      home.surface.setVisible(false);
      home.updateIndex();
      assert.strictEqual(home.states().length, 1, 'nothing is sent while hidden');
      home.surface.setVisible(true);
      assert.strictEqual(home.states().length, 2, 'the update it missed');
      home.surface.setVisible(false);
      home.surface.setVisible(true);
      assert.strictEqual(home.states().length, 2, 'nothing new, the same day');
      // The widgets were built yesterday.
      (home.controller as unknown as { publishedOn: number }).publishedOn -= 24 * 60 * 60 * 1000;
      home.surface.setVisible(false);
      home.surface.setVisible(true);
      assert.strictEqual(home.states().length, 3, 'Today has turned');
    } finally {
      home.dispose();
    }
  });

  test('answers a quick add with the text it was sent, whether or not it was added', async () => {
    const home = openHome();
    try {
      await home.send({ type: 'quickAdd', text: ' Call Ren ' });
      await home.send({ type: 'quickAdd', text: 'refused task' });
      assert.deepStrictEqual(home.navigation.opened, ['add Call Ren', 'add refused task']);
      assert.deepStrictEqual(home.surface.webview.postedOf('quickAddResult'), [
        { type: 'quickAddResult', text: ' Call Ren ', added: true },
        { type: 'quickAddResult', text: 'refused task', added: false },
      ]);
    } finally {
      home.dispose();
    }
  });

  test('answers a quick add that fails, so the page gives the task back', async () => {
    const home = openHome();
    try {
      // The failure still reaches the log, as any handler's does.
      await assert.rejects(home.send({ type: 'quickAdd', text: 'read-only task' }), /read-only/);
      assert.deepStrictEqual(home.surface.webview.postedOf('quickAddResult'), [
        { type: 'quickAddResult', text: 'read-only task', added: false },
      ]);
    } finally {
      home.dispose();
    }
  });

  test('opens an entry and counts its visit, opens a task\'s line, and nothing else', async () => {
    const home = openHome();
    try {
      const calls = await record(async () => {
        await home.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 1, beside: true });
        await home.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 3, pin: true });
        await home.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 2 });
        await home.send({ type: 'openSource', filePath: '/notes/plain.md', line: 1 });
        await home.send({ type: 'openNote', filePath: '/notes/plain.md' });
        await home.send({ type: 'openNote', filePath: '/notes/missing.md' });
      });
      // A row's line opens as a preview, kept with Keep; a note opens kept.
      assert.deepStrictEqual(calls, [
        ['open', '/notes/atlas.md', 1, true, true],
        ['open', '/notes/atlas.md', 3, false, false],
        ['open', '/notes/plain.md', 1, false, false],
      ]);
      assert.deepStrictEqual(home.preferences.reader.value.sectionAccessCounts, { [home.entry]: 1 });
    } finally {
      home.dispose();
    }
  });

  test('opens a tag the index has, as the reader may have written it, and its hub', async () => {
    const home = openHome();
    try {
      await home.send({ type: 'openTag', tagKey: 'Project/Relay' });
      await home.send({ type: 'openTag', tagKey: '#gone' });
      await home.send({ type: 'createTagHub', tagKey: '#project/relay' });
      await home.send({ type: 'createTagHub', tagKey: '#gone' });
      await home.send({ type: 'openSearch', query: ' #project/relay ' });
      await home.send({ type: 'openTaskBoard' });
      await home.send({ type: 'openDailyNote' });
      assert.deepStrictEqual(home.navigation.opened, [
        'tag #project/relay',
        'hub #project/relay',
        'search #project/relay',
        'board ',
        'today',
      ]);
      assert.deepStrictEqual(home.preferences.reader.value.recentQueries, ['#project/relay']);
    } finally {
      home.dispose();
    }
  });

  test('runs the command each link and tag menu asks for', async () => {
    const home = openHome();
    try {
      const calls = await record(async () => {
        await home.send({ type: 'chooseTheme' });
        await home.send({ type: 'openView', view: 'stats' });
        await home.send({ type: 'openView', view: 'walkthrough' });
        await home.send({ type: 'openWhatsNew' });
        await home.send({ type: 'parkTag', tagKey: '#project/relay' });
        await home.send({ type: 'unparkTag', tagKey: '#parked' });
      });
      assert.deepStrictEqual(calls, [
        ['deckard.chooseTheme'],
        ['deckard.showStats'],
        ['deckard.openWalkthrough'],
        ['deckard.openWhatsNew'],
        ['deckard.parkTag', '#project/relay'],
        ['deckard.unparkTag', '#parked'],
      ]);
    } finally {
      home.dispose();
    }
  });

  test('acts on Try next by the key it would suggest now, and redraws when told', async () => {
    const home = openHome();
    try {
      home.host.refresh();
      const calls = await record(async () => {
        await home.send({ type: 'runTryNext', key: 'weeklyReview' });
        await home.send({ type: 'runTryNext', key: 'taskBoard' });
        await home.send({ type: 'snoozeTryNext', key: 'taskBoard' });
        await home.send({ type: 'retireTryNext', key: 'anything' });
      });
      assert.deepStrictEqual(calls, [['deckard.showTaskBoard']]);
      assert.deepStrictEqual(home.ledger.told, ['snooze taskBoard', 'retire anything']);
      home.ledger.fire();
      assert.strictEqual(home.states().length, 2);
    } finally {
      home.dispose();
    }
  });

  test('acts on nothing it does not accept', async () => {
    const home = openHome();
    try {
      const calls = await record(async () => {
        await home.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 0 });
        await home.send({ type: 'openTag', tagKey: '' });
        await home.send({ type: 'quickAdd', text: 'a\nb' });
        await home.send({ type: 'openView', view: 'settings' });
        await home.send({ type: 'setTaskFilter', filter: 'all' });
        await home.send({ type: 'toggleTask', taskId: 'a', completed: 'yes' });
      });
      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(home.navigation.opened, []);
      assert.deepStrictEqual(home.surface.webview.posted, []);
    } finally {
      home.dispose();
    }
  });
});
