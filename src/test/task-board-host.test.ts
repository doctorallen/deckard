import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService } from '../services/navigationService';
import type { SearchSource } from '../ui/webview/activeSearch';
import { ActiveSearch } from '../ui/webview/activeSearch';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { TaskBoardController, TaskBoardControllerOptions } from '../ui/webview/pages/taskBoard/taskBoardController';
import { ThemePreview } from '../ui/webview/themePreview';
import { withConfigurationEvents } from './configurationEvents';
import { FakeSurface, recordSurface } from './fakeWebview';
import { createPreferences } from './preferenceServices';
import { REPOSITORY_ROOT } from './pageWebview';

/** An in-memory store for the preferences. */
function createStore() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key: string, value: unknown) => void values.set(key, value),
  };
}

/** A note with a heading, a task that is being done, and one that is not. */
const NOTE = '# Atlas #project/atlas\n- [ ] Send the audit #status/doing\n- [ ] Call Ren\n';

/** The state messages a page was sent, oldest first. */
type StateOf = { type: 'state'; data: { query: { text: string }; tasksViewMode?: { listed: boolean } } };

/**
 * The Task Board over one note, attached to a fake panel in front: what the
 * page is sent, the tags it opens, the active search it makes itself, and a
 * task write that waits until a test lets it finish. `exports` plans its
 * Export, and plans none by default.
 */
function openBoard(exports: unknown = {}) {
  let index: WorkspaceIndex = buildWorkspaceIndex(
    new Map([['/notes/atlas.md', parseMarkdown('/notes/atlas.md', NOTE)]]),
  );
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getUnreadable: () => [],
    onDidUpdate: (listener: () => void) => updates.event(listener),
  } as unknown as TaskBoardControllerOptions['indexer'];
  const preferences = createPreferences(createStore() as never);
  const openedTags: string[] = [];
  const activeSearch = new ActiveSearch();
  const source: SearchSource = { getRefineState: () => undefined, applySearch: async () => undefined };
  const toggles: unknown[] = [];
  const writes = {
    // A write that never comes back, so the board stays awaiting its index.
    tasks: { readNextStatus: () => undefined, toggle: (...args: unknown[]) => new Promise(() => void toggles.push(args)) },
  } as unknown as TaskBoardControllerOptions['writes'];
  const controller = new TaskBoardController({
    indexer,
    preferences,
    openTag: async (tagKey) => void openedTags.push(tagKey),
    activeSearch,
    writes,
    exports: exports as never,
    navigation: new NavigationService(),
    source,
    extensionUri: vscode.Uri.file(REPOSITORY_ROOT),
  });
  const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  host.attach(surface);
  const taskId = (title: string) => [...index.tasks.values()].find((task) => task.title.startsWith(title))?.id ?? '';
  return {
    controller,
    host,
    surface,
    preferences,
    activeSearch,
    source,
    openedTags,
    toggles,
    taskId,
    states: () => surface.webview.postedOf<StateOf>('state'),
    send: (message: unknown) => surface.webview.send(message),
    updateIndex: () => {
      index = buildWorkspaceIndex(new Map([['/notes/atlas.md', parseMarkdown('/notes/atlas.md', NOTE)]]));
      updates.fire();
    },
    dispose: () => {
      host.dispose();
      activeSearch.dispose();
    },
  };
}

/**
 * Runs `run` with the notes it opens recorded rather than opened, and
 * returns them, in order.
 */
async function recordOpens(run: () => Promise<void>): Promise<string[]> {
  const window = vscode.window as unknown as Record<string, unknown>;
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const originals = [window.showTextDocument, workspace.openTextDocument];
  const opened: string[] = [];
  workspace.openTextDocument = async (uri: vscode.Uri) => ({ uri, lineCount: 40 });
  window.showTextDocument = async (document: { uri: vscode.Uri }) => {
    opened.push(document.uri.path);
    return { document, revealRange: () => undefined };
  };
  try {
    await run();
  } finally {
    [window.showTextDocument, workspace.openTextDocument] = originals;
  }
  return opened;
}

/** What a stand-in `deckard.tasks.viewQuery` holds at each level a reader sets it. */
interface AgendaQueryLevels {
  user?: string;
  workspace?: string;
}

/**
 * Runs `run` with `deckard.tasks.viewQuery` read from and written to `levels`
 * rather than the settings, and with the information messages recorded
 * rather than shown. Every other setting is read as it is. Returns what was
 * written, as `[key, value, target]`, and the messages, in order.
 */
async function withAgendaQuery(
  levels: AgendaQueryLevels,
  run: () => Promise<void>,
): Promise<{ writes: unknown[][]; shown: string[] }> {
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const window = vscode.window as unknown as Record<string, unknown>;
  const getConfiguration = vscode.workspace.getConfiguration;
  const showInformationMessage = window.showInformationMessage;
  const writes: unknown[][] = [];
  const shown: string[] = [];
  workspace.getConfiguration = (section?: string, scope?: vscode.ConfigurationScope) => {
    const real = getConfiguration(section, scope);
    if (section !== 'deckard') {
      return real;
    }
    const isQuery = (key: string) => key === 'tasks.viewQuery';
    return {
      ...real,
      has: (key: string) => (isQuery(key) ? true : real.has(key)),
      get: (key: string, fallback?: unknown) =>
        isQuery(key) ? (levels.workspace ?? levels.user ?? fallback) : real.get(key, fallback),
      inspect: (key: string) =>
        isQuery(key)
          ? { key: 'deckard.tasks.viewQuery', defaultValue: '', globalValue: levels.user, workspaceValue: levels.workspace }
          : real.inspect(key),
      update: async (key: string, value: unknown, target: vscode.ConfigurationTarget) => {
        if (!isQuery(key)) {
          return real.update(key, value, target);
        }
        writes.push([key, value, target]);
        if (target === vscode.ConfigurationTarget.Workspace) {
          levels.workspace = value as string | undefined;
        } else {
          levels.user = value as string | undefined;
        }
      },
    };
  };
  window.showInformationMessage = async (message: string) => void shown.push(message);
  try {
    await run();
  } finally {
    workspace.getConfiguration = getConfiguration;
    window.showInformationMessage = showInformationMessage;
  }
  return { writes, shown };
}

suite('Task Board host', () => {
  test('is kept running while hidden, for a card being dragged, and opens on its loading line', () => {
    // Q1 of docs/implementation/20-webviews.md: the board keeps retain.
    const board = openBoard();
    try {
      assert.strictEqual(board.controller.options.retainContextWhenHidden, true);
      assert.strictEqual(board.controller.options.readsInertState, undefined, 'its snapshot is posted, not carried in its HTML');
    } finally {
      board.dispose();
    }
  });

  test('an edit to the theme and the board at once reloads the page before the board is sent', () => {
    const { result: board, fire } = withConfigurationEvents(() => openBoard());
    try {
      const events = recordSurface(board.surface);
      fire('deckard.theme', 'deckard.board.columns');
      assert.deepStrictEqual(events, ['html', 'post state']);
    } finally {
      board.dispose();
    }
  });

  test('sends the board, as the active search, and tells the sidebar each time', () => {
    const board = openBoard();
    try {
      assert.strictEqual(board.activeSearch.active, board.source, 'a board in front is the active search');
      let changes = 0;
      board.activeSearch.onDidChange(() => (changes += 1));
      board.host.refresh();
      assert.strictEqual(board.states().length, 1);
      assert.strictEqual(board.states()[0].data.query.text, 'is:open', 'on its own search');
      assert.strictEqual(changes, 1);
    } finally {
      board.dispose();
    }
  });

  test('a move it cannot make is refused under the move\'s number, then the board is redrawn', async () => {
    const board = openBoard();
    try {
      await board.send({ type: 'moveTask', taskId: 'gone', column: 'status:doing', requestId: 4 });
      await board.send({ type: 'moveTask', taskId: board.taskId('Send the audit'), column: 'status:doing', from: 'status:doing', requestId: 5 });
      await board.send({ type: 'moveTask', taskId: 'gone', column: 'done' });
      assert.deepStrictEqual(
        board.surface.webview.posted.map((message) => {
          const { type, taskId, requestId } = message as { type: string; taskId?: string; requestId?: number };
          return type === 'state' ? type : { type, taskId, requestId };
        }),
        [
          { type: 'moveRefused', taskId: 'gone', requestId: 4 },
          'state',
          { type: 'moveRefused', taskId: board.taskId('Send the audit'), requestId: 5 },
          'state',
          { type: 'moveRefused', taskId: 'gone', requestId: undefined },
          'state',
        ],
      );
      assert.deepStrictEqual(board.surface.webview.postedOf('moveRefused')[2], { type: 'moveRefused', taskId: 'gone' }, 'a move with no number is refused with none');
    } finally {
      board.dispose();
    }
  });

  test('while a write waits for its index, a preferences change does not redraw the board', async () => {
    const board = openBoard();
    try {
      void board.send({ type: 'toggleTask', taskId: board.taskId('Call Ren'), completed: true });
      assert.strictEqual(board.toggles.length, 1, 'the box is written');
      await board.preferences.taskLayout.setTaskSortMode('created');
      assert.strictEqual(board.states().length, 0, 'the index the write started from is not drawn again');
      board.updateIndex();
      assert.strictEqual(board.states().length, 1, 'the index moving on redraws');
      await board.preferences.taskLayout.setTaskSortMode('rank');
      assert.strictEqual(board.states().length, 2, 'and a preferences change redraws again');

      await board.send({ type: 'toggleTask', taskId: 'gone', completed: true });
      assert.strictEqual(board.states().length, 3, 'a box for a task that has gone redraws the board');
      await board.preferences.taskLayout.setTaskSortMode('created');
      assert.strictEqual(board.states().length, 4, 'and waits for nothing');
    } finally {
      board.dispose();
    }
  });

  test('opens only a task\'s own line, and only a tag by the key the index holds', async () => {
    const board = openBoard();
    try {
      const opens = await recordOpens(async () => {
        await board.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 2 });
        await board.send({ type: 'openSource', filePath: '/notes/atlas.md', line: 1 });
        await board.send({ type: 'openSource', filePath: '/notes/missing.md', line: 2 });
      });
      assert.deepStrictEqual(opens, ['/notes/atlas.md'], 'the task\'s line, and not the heading\'s');
      for (const tagKey of ['#project/atlas', 'project/atlas', '#Project/Atlas', '#gone']) {
        await board.send({ type: 'openTag', tagKey });
      }
      assert.deepStrictEqual(board.openedTags, ['#project/atlas']);
    } finally {
      board.dispose();
    }
  });

  test('a search from its box redraws it and is kept, and one that does not parse keeps the last', async () => {
    const board = openBoard();
    try {
      await board.send({ type: 'setBoardQuery', query: 'is:done' });
      assert.strictEqual(board.states().at(-1)?.data.query.text, 'is:done');
      assert.deepStrictEqual(board.preferences.reader.value.recentQueries, ['is:done']);
      await board.send({ type: 'setBoardQuery', query: '(' });
      assert.deepStrictEqual(board.preferences.reader.value.recentQueries, ['is:done'], 'a search that does not parse is not kept');
      const query = board.controller.getRefineState()?.query;
      assert.strictEqual(query?.pending, '(', 'and is shown with its error');
      assert.strictEqual(query?.text, 'is:done', 'over the last search that parsed');
    } finally {
      board.dispose();
    }
  });

  test('hidden, it waits and is sent the board once when shown, and is the active search only in front', async () => {
    const board = openBoard();
    try {
      board.surface.setVisible(false);
      assert.strictEqual(board.activeSearch.active, undefined);
      await board.send({ type: 'showColumnRest', columnId: 'status:doing' });
      assert.strictEqual(board.states().length, 0);
      board.surface.setVisible(true);
      assert.strictEqual(board.states().length, 1);
      assert.strictEqual(board.activeSearch.active, board.source);
      await board.send({ type: 'showColumnRest', columnId: 'done' });
      assert.strictEqual(board.states().length, 2, 'Show N more redraws');
    } finally {
      board.dispose();
    }
  });

  test('reopens on the search it was saved with, and on its own otherwise', () => {
    const board = openBoard();
    try {
      for (const state of [{}, undefined, null, { query: 7 }, 'is:done']) {
        void board.controller.options.restore?.(state);
        assert.strictEqual(board.controller.buildSnapshot().query.text, 'is:open', JSON.stringify(state));
      }
      void board.controller.options.restore?.({ query: 'is:done' });
      assert.strictEqual(board.controller.buildSnapshot().query.text, 'is:done');
    } finally {
      board.dispose();
    }
  });

  test('closed, it forgets the board it drew and stops being the active search', () => {
    const board = openBoard();
    try {
      board.host.refresh();
      board.controller.applyQuery('is:done');
      assert.strictEqual(board.controller.getRefineState()?.query.text, 'is:open', 'Refine shows what was drawn');
      board.surface.dispose();
      assert.strictEqual(board.activeSearch.active, undefined);
      assert.strictEqual(board.controller.getRefineState()?.query.text, 'is:done', 'and, once closed, the search as it stands');
    } finally {
      board.dispose();
    }
  });

  test('exports the notes or the tasks, as the page asks', async () => {
    const planned: unknown[][] = [];
    const nothing = (what: string) => ({ kind: 'nothing', what });
    const board = openBoard({
      fromSearch: (query: string, what: string) => (planned.push(['search', query, what]), nothing(what)),
      fromResults: (what: string, results: { tasks: unknown[] }) => (planned.push(['results', what, results.tasks.length]), nothing(what)),
    });
    const window = vscode.window as unknown as Record<string, unknown>;
    const showInformationMessage = window.showInformationMessage;
    const shown: unknown[] = [];
    window.showInformationMessage = async (message: unknown) => void shown.push(message);
    try {
      await board.send({ type: 'setBoardQuery', query: 'is:open' });
      await board.send({ type: 'exportResults', kind: 'notes' });
      await board.send({ type: 'exportResults', kind: 'tasks' });
      assert.deepStrictEqual(planned, [['search', 'is:open', 'notes'], ['results', 'tasks', 2]]);
      assert.deepStrictEqual(shown, ['There are no notes to export.', 'There are no tasks to export.']);
    } finally {
      window.showInformationMessage = showInformationMessage;
      board.dispose();
    }
  });

  test('acts on nothing it does not accept', async () => {
    const board = openBoard();
    try {
      for (const message of [
        { type: 'moveTask', taskId: 'gone', column: '' },
        { type: 'openHelp', section: 'periodic' },
        { type: 'saveBoardSearch', now: true },
        { type: 'showColumnRest', columnId: '' },
        { type: 'pinNote', filePath: '/notes/atlas.md' },
      ]) {
        await board.send(message);
      }
      assert.deepStrictEqual(board.surface.webview.posted, []);
      assert.deepStrictEqual(board.openedTags, []);
    } finally {
      board.dispose();
    }
  });

  test('a completion it cannot write is refused, then the board is redrawn', async () => {
    const board = openBoard();
    try {
      await board.send({ type: 'toggleTask', taskId: 'gone', completed: true });
      assert.deepStrictEqual(
        board.surface.webview.posted.map((message) => ((message as { type: string }).type === 'state' ? 'state' : message)),
        [{ type: 'toggleRefused', taskId: 'gone', completed: true }, 'state'],
      );
    } finally {
      board.dispose();
    }
  });

  test('is a plain board until it is opened to edit what the Tasks view lists, and Cancel makes it one again', async () => {
    const board = openBoard();
    try {
      await withAgendaQuery({ user: '#project/atlas' }, async () => {
        board.controller.applyQuery('#project/atlas');
        board.host.refresh();
        assert.strictEqual(board.states().at(-1)?.data.tasksViewMode, undefined, 'a search alone does not put it in the mode');
        board.controller.enterTasksViewMode();
        board.host.refresh();
        assert.deepStrictEqual(board.states().at(-1)?.data.tasksViewMode, { listed: true }, 'opened on the search the view lists');
        await board.send({ type: 'setBoardQuery', query: 'is:done' });
        assert.deepStrictEqual(board.states().at(-1)?.data.tasksViewMode, { listed: false }, 'a search run in it stays in it');
        await board.send({ type: 'leaveTasksViewMode' });
        assert.strictEqual(board.states().at(-1)?.data.tasksViewMode, undefined, 'Cancel leaves it');
        assert.strictEqual(board.states().at(-1)?.data.query.text, 'is:done', 'with the search it had');
      }).then(({ writes }) => assert.deepStrictEqual(writes, [], 'and the Tasks view is left alone'));
    } finally {
      board.dispose();
    }
  });

  test('Save to Tasks view writes what the box shows, run or not, where the search in force is set', async () => {
    for (const [levels, target] of [
      [{}, vscode.ConfigurationTarget.Global],
      [{ user: '#project/beta' }, vscode.ConfigurationTarget.Global],
      [{ workspace: '#project/beta' }, vscode.ConfigurationTarget.Workspace],
      [{ user: 'is:mine', workspace: '#project/beta' }, vscode.ConfigurationTarget.Workspace],
    ] as const) {
      const board = openBoard();
      try {
        const { writes, shown } = await withAgendaQuery({ ...levels }, async () => {
          board.controller.enterTasksViewMode();
          board.host.refresh();
          // Typed after the board's own is:open and never run: the board
          // has only searched is:open.
          await board.send({ type: 'saveToTasksView', query: 'is:open AND #project/atlas' });
        });
        const name = JSON.stringify(levels);
        assert.deepStrictEqual(writes, [['tasks.viewQuery', '#project/atlas', target]], `${name}: without the board's own is:open, as the gear's switch writes it`);
        assert.deepStrictEqual(shown, ['The Tasks view lists "#project/atlas" now.'], name);
        assert.deepStrictEqual(board.surface.webview.postedOf('savedToTasksView'), [{ type: 'savedToTasksView', query: '#project/atlas' }], `${name}: the page is told, to say so`);
        const last = board.states().at(-1)?.data;
        assert.strictEqual(last?.query.text, 'is:open AND #project/atlas', `${name}: the board runs what it saved`);
        assert.deepStrictEqual(last?.tasksViewMode, { listed: true }, `${name}: and stays in the mode, saying the view lists it`);
      } finally {
        board.dispose();
      }
    }
  });

  test('Save to Tasks view with is:open alone lists every open task, and a search that does not parse is not saved', async () => {
    const board = openBoard();
    try {
      const { writes, shown } = await withAgendaQuery({ user: '#project/atlas' }, async () => {
        board.controller.enterTasksViewMode();
        await board.send({ type: 'saveToTasksView', query: 'is:open' });
        await board.send({ type: 'saveToTasksView', query: 'is:open AND (' });
      });
      assert.deepStrictEqual(writes, [['tasks.viewQuery', '', vscode.ConfigurationTarget.Global]]);
      assert.deepStrictEqual(shown, ['The Tasks view lists every open task now.']);
      assert.deepStrictEqual(board.surface.webview.postedOf('savedToTasksView'), [{ type: 'savedToTasksView', query: '' }]);
      const last = board.states().at(-1)?.data as { query: { text: string; pending?: string }; tasksViewMode?: unknown } | undefined;
      assert.strictEqual(last?.query.pending, 'is:open AND (', 'the box shows it with its error');
      assert.strictEqual(last?.query.text, 'is:open', 'over the search that parsed');
      assert.deepStrictEqual(last?.tasksViewMode, { listed: false }, 'and does not say the view lists it');
    } finally {
      board.dispose();
    }
  });

  test('Save to Tasks view does nothing on a plain board', async () => {
    const board = openBoard();
    try {
      const { writes } = await withAgendaQuery({}, async () => {
        await board.send({ type: 'saveToTasksView', query: '#project/atlas' });
      });
      assert.deepStrictEqual(writes, []);
      assert.deepStrictEqual(board.surface.webview.postedOf('savedToTasksView'), []);
    } finally {
      board.dispose();
    }
  });

  test('a board kept across a reload in the mode reopens in it, and one closed forgets it', async () => {
    const board = openBoard();
    try {
      await board.controller.options.restore?.({ query: '#project/atlas', tasksViewMode: true });
      board.host.refresh();
      assert.ok(board.states().at(-1)?.data.tasksViewMode, 'kept in the mode');
      board.controller.onDidDetach();
      board.host.refresh();
      assert.strictEqual(board.states().at(-1)?.data.tasksViewMode, undefined, 'a closed board is a plain one when opened again');
      for (const kept of [{ query: 'is:open' }, { query: 'is:open', tasksViewMode: 'yes' }, { tasksViewMode: true }]) {
        await board.controller.options.restore?.(kept);
        board.host.refresh();
        const mode = board.states().at(-1)?.data.tasksViewMode;
        assert.strictEqual(mode !== undefined, kept.tasksViewMode === true, JSON.stringify(kept));
        board.controller.onDidDetach();
      }
    } finally {
      board.dispose();
    }
  });

  test('its Help button opens Help at the Task board', async () => {
    const board = openBoard();
    const commands = vscode.commands as unknown as Record<string, unknown>;
    const executeCommand = commands.executeCommand;
    const calls: unknown[][] = [];
    commands.executeCommand = async (...args: unknown[]) => void calls.push(args);
    try {
      await board.send({ type: 'openHelp' });
      assert.deepStrictEqual(calls, [['deckard.showHelp', 'task-views']]);
    } finally {
      commands.executeCommand = executeCommand;
      board.dispose();
    }
  });
});
