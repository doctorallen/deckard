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
type StateOf = { type: 'state'; data: { query: { text: string } } };

/**
 * The Task Board over one note, attached to a fake panel in front: what the
 * page is sent, the tags it opens, the active search it makes itself, and a
 * task write that waits until a test lets it finish.
 */
function openBoard() {
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
    tasks: { toggle: (...args: unknown[]) => new Promise(() => void toggles.push(args)) },
  } as unknown as TaskBoardControllerOptions['writes'];
  const controller = new TaskBoardController({
    indexer,
    preferences,
    openTag: async (tagKey) => void openedTags.push(tagKey),
    activeSearch,
    writes,
    exports: {} as never,
    navigation: new NavigationService(),
    source,
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
    opened.push(document.uri.fsPath);
    return { document, revealRange: () => undefined };
  };
  try {
    await run();
  } finally {
    [window.showTextDocument, workspace.openTextDocument] = originals;
  }
  return opened;
}

suite('Task Board host', () => {
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
});
