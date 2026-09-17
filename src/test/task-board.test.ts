import * as assert from 'assert';

import { PreferencesStore } from '../core/storage/preferences';
import {
  PersistedPreferences,
  TagReference,
  Task,
  TaskBoardGroupBy,
  WorkspaceIndex,
} from '../core/types';
import {
  createTaskBoard,
  layoutTaskBoard,
  resolveTaskMove,
  setTaskStatusTag,
  TaskBoardOptions,
} from '../ui/state/taskBoardState';
import {
  parseDashboardMessage,
  parseSidebarMessage,
  parseTaskBoardMessage,
} from '../ui/webview/messages';

const at = (month: number, day: number): number =>
  new Date(2026, month - 1, day).getTime();

/** Mid-morning on Sunday 2026-09-13. */
const options: TaskBoardOptions = {
  now: at(9, 13) + 9 * 60 * 60 * 1000,
  statusNamespace: 'status',
  statuses: ['todo', 'doing'],
  format: 'emoji',
};

/** Preferences as a fresh install has them, with the board's own choices. */
function preferencesWith(values: Partial<PersistedPreferences>): PersistedPreferences {
  const store = new PreferencesStore({
    get: () => undefined,
    keys: () => [],
    update: async () => undefined,
  } as never);
  const value = { ...store.value, ...values };
  store.dispose();
  return value;
}

/** The Task Board page, grouped and searched as given. */
function board(
  index: WorkspaceIndex,
  groupBy: TaskBoardGroupBy,
  query: string,
  boardOptions: TaskBoardOptions,
): ReturnType<typeof createTaskBoard> {
  return createTaskBoard(
    index,
    preferencesWith({ taskBoardGroup: groupBy }),
    { query },
    boardOptions,
  );
}

suite('Task board', () => {
  const ids = (board: ReturnType<typeof createTaskBoard>): Array<[string, string[]]> =>
    board.columns.map((column) => [
      column.id,
      column.cards.map((card) => card.taskId),
    ]);

  test('groups by the status written on each task line', () => {
    assert.deepStrictEqual(ids(board(createIndex(), 'status', '', options)), [
      ['status:', ['call']],
      ['status:todo', ['draft']],
      ['status:doing', ['audit']],
      // A status found on a task but not configured gets its own column.
      ['status:review', ['brief']],
      ['done', ['ship', 'file']],
    ]);
  });

  test('groups by priority and by due date', () => {
    assert.deepStrictEqual(ids(board(createIndex(), 'priority', '', options)), [
      ['priority:highest', []],
      ['priority:high', ['audit']],
      ['priority:medium', []],
      ['priority:', ['call', 'brief']],
      ['priority:low', ['draft']],
      ['priority:lowest', []],
      ['done', ['ship', 'file']],
    ]);

    const due = board(createIndex(), 'due', '', options);
    assert.deepStrictEqual(ids(due), [
      ['due:overdue', ['audit']],
      ['due:today', ['call']],
      ['due:tomorrow', []],
      ['due:week', ['brief']],
      ['due:later', []],
      ['due:', ['draft']],
      ['done', ['ship', 'file']],
    ]);
    assert.deepStrictEqual(
      due.columns.map((column) => column.droppable),
      [false, true, true, false, false, true, true],
    );
    assert.strictEqual(due.columns[0].cards[0].overdue, true);
  });

  test('limits Done and narrows the board with a query', () => {
    const limited = board(createIndex(), 'status', '', { ...options, doneLimit: 1 });
    const done = limited.columns[limited.columns.length - 1];
    assert.deepStrictEqual(done.cards.map((card) => card.taskId), ['ship']);
    assert.strictEqual(done.hiddenCount, 1);

    const filtered = board(createIndex(), 'status', 'priority >= high', options);
    assert.strictEqual(filtered.taskCount, 1);
  });

  test('lays out a page’s own selection of tasks', () => {
    const index = createIndex();
    const chosen = ['draft', 'ship'].map((id) => index.tasks.get(id) as Task);
    const board = layoutTaskBoard(index, chosen, 'status', options);
    assert.strictEqual(board.taskCount, 2);
    assert.deepStrictEqual(
      board.columns
        .filter((column) => column.cards.length > 0)
        .map((column) => column.id),
      ['status:todo', 'done'],
    );
  });

  test('renders a card title as Markdown, as the task list does', () => {
    const index = createIndex();
    const task = createTask(
      'read',
      '- [ ] Read **the brief**, `notes.md`, and [the spec](https://example.com) <b>now</b> #project/atlas',
      {},
    );
    index.tasks.set(task.id, task);
    const card = board(index, 'status', '', options)
      .columns.flatMap((column) => column.cards)
      .find((candidate) => candidate.taskId === 'read');
    assert.ok(card);
    assert.match(card.renderedTitle, /<strong>the brief<\/strong>/);
    assert.match(card.renderedTitle, /<code>notes\.md<\/code>/);
    assert.match(card.renderedTitle, /<a href="https:\/\/example\.com">the spec<\/a>/);
    // Raw HTML in a task line stays text.
    assert.doesNotMatch(card.renderedTitle, /<b>/);
    assert.match(card.title, /\*\*the brief\*\*/, 'the plain title is kept for search');
  });

  test('searches tasks with the shared search box, and keeps one that does not parse', () => {
    const searched = board(createIndex(), 'status', 'priority >= high', options);
    assert.strictEqual(searched.query.text, 'priority >= high');
    assert.deepStrictEqual(searched.query.matchCounts, { notes: 0, tasks: 1 });
    assert.strictEqual(searched.query.isAdvanced, true);

    const invalid = createTaskBoard(
      createIndex(),
      preferencesWith({}),
      { query: 'priority >= high', invalidQuery: 'priority >=' },
      options,
    );
    assert.strictEqual(invalid.query.text, 'priority >=');
    assert.ok(invalid.query.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
    assert.strictEqual(invalid.taskCount, 1, 'the applied search still chooses the tasks');

    // Refine counts only what could narrow these tasks.
    const tagged = board(createIndex(), 'status', 'is:open', options);
    assert.ok(tagged.query.facets.every((facet) => facet.values.every((value) => value.count < 4)));
  });

  test('lists the searched tasks when shown as a list, with the settings it edits', () => {
    const listed = createTaskBoard(
      createIndex(),
      preferencesWith({ taskBoardLayout: 'list', taskBoardTaskFilter: 'completed' }),
      { query: '' },
      options,
    );
    assert.strictEqual(listed.layout, 'list');
    assert.deepStrictEqual(listed.columns, []);
    assert.deepStrictEqual(listed.tasks?.map((item) => item.task.id).sort(), ['file', 'ship']);
    assert.deepStrictEqual(listed.taskCounts, { all: 6, active: 4, completed: 2 });
    assert.deepStrictEqual(listed.settings, { statuses: ['todo', 'doing'], statusNamespace: 'status' });
    assert.strictEqual(board(createIndex(), 'status', '', options).tasks, undefined);
  });

  test('accepts the Task Board’s layout, list, and settings messages', () => {
    assert.deepStrictEqual(
      parseTaskBoardMessage({ type: 'setTaskLayout', layout: 'list' }),
      { type: 'setTaskLayout', layout: 'list' },
    );
    assert.strictEqual(parseTaskBoardMessage({ type: 'setTaskLayout', layout: 'grid' }), undefined);
    assert.deepStrictEqual(
      parseTaskBoardMessage({ type: 'setTaskFilter', filter: 'completed' }),
      { type: 'setTaskFilter', filter: 'completed' },
    );
    assert.deepStrictEqual(
      parseTaskBoardMessage({ type: 'setTaskSort', mode: 'created' }),
      { type: 'setTaskSort', mode: 'created' },
    );
    assert.deepStrictEqual(
      parseTaskBoardMessage({ type: 'reorderTasks', taskIds: ['b', 'a'] }),
      { type: 'reorderTasks', taskIds: ['b', 'a'] },
    );
    assert.deepStrictEqual(
      parseTaskBoardMessage({ type: 'setBoardStatuses', statuses: ['todo', 'in-review'] }),
      { type: 'setBoardStatuses', statuses: ['todo', 'in-review'] },
    );
    assert.strictEqual(
      parseTaskBoardMessage({ type: 'setBoardStatuses', statuses: ['to do'] }),
      undefined,
      'a status that cannot be a tag is refused',
    );
    assert.deepStrictEqual(
      parseTaskBoardMessage({ type: 'setBoardStatusNamespace', namespace: 'stage' }),
      { type: 'setBoardStatusNamespace', namespace: 'stage' },
    );
    assert.strictEqual(
      parseTaskBoardMessage({ type: 'setBoardStatusNamespace', namespace: '1stage' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseTaskBoardMessage({ type: 'moveTask', taskId: 'a', column: 'status:doing' }),
      { type: 'moveTask', taskId: 'a', column: 'status:doing' },
    );
    assert.strictEqual(
      parseTaskBoardMessage({ type: 'moveTask', taskId: 'a', column: '' }),
      undefined,
    );
  });

  test('no longer takes task messages on the Dashboard', () => {
    for (const message of [
      { type: 'setDashboardTaskLayout', layout: 'board' },
      { type: 'setBoardGroup', groupBy: 'due' },
      { type: 'moveTask', taskId: 'a', column: 'status:doing' },
      { type: 'setTaskFilter', filter: 'all' },
      { type: 'setTaskTags', tagKeys: ['work'] },
      { type: 'reorderTasks', taskIds: ['a'] },
      { type: 'setDashboardMode', mode: 'tasks' },
    ]) {
      assert.strictEqual(parseDashboardMessage(message), undefined, message.type);
    }
  });

  test('opens from the sidebar toolbar', () => {
    assert.deepStrictEqual(parseSidebarMessage({ type: 'openTaskBoard' }), {
      type: 'openTaskBoard',
    });
  });

  test('changes a status tag where it is written', () => {
    assert.strictEqual(
      setTaskStatusTag('- [ ] Plan #status/todo #project/x', 3, 'status', 'doing'),
      '- [ ] Plan #status/doing #project/x',
    );
    assert.strictEqual(
      setTaskStatusTag('- [ ] Plan 📅 2026-09-20', 3, 'status', 'doing'),
      '- [ ] Plan 📅 2026-09-20 #status/doing',
    );
    assert.strictEqual(
      setTaskStatusTag('- [ ] Plan #status/todo #status/doing', 3, 'status', undefined),
      '- [ ] Plan',
    );
  });

  test('turns a drop into an edit of the task line', () => {
    const index = createIndex();
    const task = (id: string): Task => index.tasks.get(id) as Task;
    const apply = (id: string, column: string): string | undefined => {
      const move = resolveTaskMove(task(id), column, options);
      return move.kind === 'edit' ? move.edit(task(id).sourceLineText) : move.kind;
    };

    assert.strictEqual(apply('call', 'done'), 'complete');
    assert.strictEqual(apply('audit', 'status:doing'), 'unchanged');
    assert.strictEqual(apply('draft', 'priority:high'), '- [ ] Draft notes #status/todo ⏫');
    assert.strictEqual(apply('call', 'due:tomorrow'), '- [ ] Call Ren 📅 2026-09-14');
    assert.strictEqual(apply('call', 'due:later'), 'refused');
    // Moving a finished task out of Done reopens it in the same edit.
    assert.strictEqual(apply('ship', 'status:doing'), '- [ ] Ship it #status/doing');
  });
});

function createIndex(): WorkspaceIndex {
  const tasks: Task[] = [
    createTask('audit', '- [ ] Audit the feed #status/doing 📅 2026-09-12 ⏫', {
      dueAt: at(9, 12),
      dueText: '2026-09-12',
      priority: 'high',
    }),
    createTask('call', '- [ ] Call Ren 📅 2026-09-13', {
      dueAt: at(9, 13),
      dueText: '2026-09-13',
    }),
    createTask('brief', '- [ ] Brief the team #status/review 📅 2026-09-18', {
      dueAt: at(9, 18),
      dueText: '2026-09-18',
    }),
    createTask('draft', '- [ ] Draft notes #status/todo 🔽', { priority: 'low' }),
    createTask('ship', '- [x] Ship it ✅ 2026-09-12', {
      completed: true,
      checkboxValue: 'x',
      doneAt: at(9, 12),
    }),
    createTask('file', '- [x] File it ✅ 2026-09-10', {
      completed: true,
      checkboxValue: 'x',
      doneAt: at(9, 10),
    }),
  ];
  return {
    files: new Map(),
    sections: new Map(),
    tasks: new Map(tasks.map((task) => [task.id, task])),
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createTask(id: string, sourceLineText: string, values: Partial<Task>): Task {
  const tags: TagReference[] = [...sourceLineText.matchAll(/#[\w/-]+/g)].map(
    (match) => ({ key: match[0], label: match[0] }),
  );
  return {
    id,
    filePath: 'notes/tasks.md',
    title: sourceLineText.slice(6),
    completed: false,
    tags: tags.map((tag) => tag.key),
    tagLabels: Object.fromEntries(tags.map((tag) => [tag.key, tag.label])),
    associationTagGroups: [tags],
    lineNumber: 1,
    checkboxColumn: 3,
    checkboxValue: ' ',
    sourceLineText,
    ...values,
  };
}
