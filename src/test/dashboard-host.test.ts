import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService } from '../services/navigationService';
import { ActiveHome, HomeSource } from '../ui/webview/activeHome';
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

/** Where Home sent the reader, in order; a quick add containing "refused" is not added. */
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
 */
function openHome() {
  let index = createIndex();
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: (listener: () => void) => updates.event(listener),
    getParkedRules: () => ({ tags: ['#parked'], hasFolders: false, isParkedPath: () => false }),
  } as unknown as DashboardControllerOptions['indexer'];
  const preferences = createPreferences(createStore() as never);
  const navigation = createNavigation();
  const ledger = createLedger();
  const source: HomeSource = { getWidgetChoices: () => [], addWidget: () => undefined, resetWidgets: async () => undefined };
  const activeHome = new ActiveHome();
  const controller = new DashboardController({
    indexer,
    preferences,
    extensionUri: vscode.Uri.file('/ext'),
    navigation,
    tryNext: ledger,
    writes: createTaskWrites(),
    navigationService: new NavigationService(),
    source,
  });
  controller.activeHome = activeHome;
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
    source,
    activeHome,
    entry: [...index.sections.keys()][0],
    send: (message: unknown) => surface.webview.send(message),
    states: () => surface.webview.postedOf<State>('state'),
    updateIndex: () => {
      index = createIndex();
      updates.fire();
    },
    dispose: () => {
      host.dispose();
      activeHome.dispose();
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
        calls.push(['open', document.uri.fsPath, editor.selection.active.line + 1, options.preview, options.viewColumn === vscode.ViewColumn.Beside]),
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

  test('is the active source while its panel is in front, and stays one when disposed of', () => {
    const home = openHome();
    try {
      assert.strictEqual(home.activeHome.active, home.source, 'a panel opened in front');
      home.surface.setVisible(false);
      assert.strictEqual(home.activeHome.active, undefined);
      home.surface.setVisible(true);
      assert.strictEqual(home.activeHome.active, home.source);
      home.surface.dispose();
      assert.strictEqual(home.activeHome.active, undefined, 'a closed panel is not in front');

      const reopened = new FakeSurface();
      home.host.attach(reopened);
      assert.strictEqual(home.activeHome.active, home.source);
      home.host.dispose();
      // Disposing of Home stops its panel's listeners before closing it, so
      // it never says it left the front.
      assert.strictEqual(home.activeHome.active, home.source);
      assert.strictEqual(reopened.closed, true);
    } finally {
      home.dispose();
    }
  });

  test('keeps the widgets + Add widget offers, and tells Related Notes', async () => {
    const home = openHome();
    let changes = 0;
    home.activeHome.onDidChange(() => (changes += 1));
    try {
      await home.send({ type: 'widgetChoices', choices: [{ value: 'stats', label: 'Stats', description: '' }] });
      assert.deepStrictEqual(home.controller.getWidgetChoices(), [{ value: 'stats', label: 'Stats' }]);
      assert.strictEqual(changes, 1);
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
