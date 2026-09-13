import * as assert from 'assert';

import { TagReference, Task, WorkspaceIndex } from '../core/types';
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

suite('Task board', () => {
  const ids = (board: ReturnType<typeof createTaskBoard>): Array<[string, string[]]> =>
    board.columns.map((column) => [
      column.id,
      column.cards.map((card) => card.taskId),
    ]);

  test('groups by the status written on each task line', () => {
    assert.deepStrictEqual(ids(createTaskBoard(createIndex(), 'status', '', options)), [
      ['status:', ['call']],
      ['status:todo', ['draft']],
      ['status:doing', ['audit']],
      // A status found on a task but not configured gets its own column.
      ['status:review', ['brief']],
      ['done', ['ship', 'file']],
    ]);
  });

  test('groups by priority and by due date', () => {
    assert.deepStrictEqual(ids(createTaskBoard(createIndex(), 'priority', '', options)), [
      ['priority:highest', []],
      ['priority:high', ['audit']],
      ['priority:medium', []],
      ['priority:', ['call', 'brief']],
      ['priority:low', ['draft']],
      ['priority:lowest', []],
      ['done', ['ship', 'file']],
    ]);

    const due = createTaskBoard(createIndex(), 'due', '', options);
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
    const limited = createTaskBoard(createIndex(), 'status', '', { ...options, doneLimit: 1 });
    const done = limited.columns[limited.columns.length - 1];
    assert.deepStrictEqual(done.cards.map((card) => card.taskId), ['ship']);
    assert.strictEqual(done.hiddenCount, 1);

    const filtered = createTaskBoard(createIndex(), 'status', 'priority >= high', options);
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

  test('accepts the Dashboard’s layout, grouping, and move messages', () => {
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setDashboardTaskLayout', layout: 'board' }),
      { type: 'setDashboardTaskLayout', layout: 'board' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'setDashboardTaskLayout', layout: 'grid' }),
      undefined,
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'setBoardGroup', groupBy: 'due' }),
      { type: 'setBoardGroup', groupBy: 'due' },
    );
    assert.deepStrictEqual(
      parseDashboardMessage({ type: 'moveTask', taskId: 'a', column: 'status:doing' }),
      { type: 'moveTask', taskId: 'a', column: 'status:doing' },
    );
    assert.strictEqual(
      parseDashboardMessage({ type: 'moveTask', taskId: 'a', column: '' }),
      undefined,
    );
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
