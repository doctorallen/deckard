import * as assert from 'assert';

import { createPreferences } from './preferenceServices';
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
} from '../ui/webview/messages';
import { isAwaitingIndex } from '../ui/webview/pages/taskBoard/taskBoardController';
import { createQueryContext } from '../domain/query/queryContext';

const at = (month: number, day: number): number =>
  new Date(2026, month - 1, day).getTime();

/** Mid-morning on Sunday 2026-09-13. */
const options: TaskBoardOptions = {
  queryContext: createQueryContext(at(9, 13) + 9 * 60 * 60 * 1000),
  statusNamespace: 'status',
  statuses: ['todo', 'doing'],
  format: 'emoji',
};

/** Preferences as a fresh install has them, with the board's own choices. */
function preferencesWith(values: Partial<PersistedPreferences>): PersistedPreferences {
  const store = createPreferences({
    get: () => undefined,
    keys: () => [],
    update: async () => undefined,
  } as never);
  const value = { ...store.reader.value, ...values };
  store.repository.dispose();
  return value;
}

/** The Task Board page, grouped and searched as given. */
function board(
  index: WorkspaceIndex,
  groupBy: TaskBoardGroupBy,
  query: string,
  boardOptions: TaskBoardOptions,
): ReturnType<typeof createTaskBoard> {
  return createTaskBoard({
    index,
    preferences: preferencesWith({ taskBoardGroup: groupBy }),
    search: { query },
    options: boardOptions,
  });
}

suite('Task board', () => {
  test('a redraw waits for the index a write is about to change', () => {
    // The rank carried into the preferences by a write arrives before the
    // index has read the note back; drawn then, a dropped card went back
    // to its old column for a moment.
    assert.strictEqual(isAwaitingIndex(10, { updatedAt: 10 }), true, 'the index has not moved on');
    assert.strictEqual(isAwaitingIndex(10, { updatedAt: 11 }), false, 'it has');
    assert.strictEqual(isAwaitingIndex(undefined, { updatedAt: 10 }), false, 'nothing was written');
  });

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

  test('a long column draws its first hundred cards, and the rest on request', () => {
    const tasks = Array.from({ length: 250 }, (_, number) =>
      createTask(`t${number}`, `- [ ] Task ${number} #status/doing`, {}),
    );
    const done = Array.from({ length: 30 }, (_, number) =>
      createTask(`d${number}`, `- [x] Done ${number}`, { completed: true, checkboxValue: 'x', doneAt: at(9, 1) + number }),
    );
    const index: WorkspaceIndex = {
      files: new Map(), sections: new Map(), tags: new Map(), entities: new Map(), updatedAt: Date.now(),
      tasks: new Map([...tasks, ...done].map((task) => [task.id, task])),
    };
    const doing = (shownColumns?: ReadonlySet<string>) =>
      board(index, 'status', '', { ...options, shownColumns }).columns.find((column) => column.id === 'status:doing');
    assert.strictEqual(doing()?.cards.length, 100);
    assert.strictEqual(doing()?.hiddenCount, 150);
    assert.strictEqual(doing(new Set(['status:doing']))?.cards.length, 250, 'Show 150 more draws them all');
    assert.strictEqual(doing(new Set(['status:doing']))?.hiddenCount, 0);
    const doneColumn = (shownColumns?: ReadonlySet<string>) =>
      board(index, 'status', '', { ...options, shownColumns }).columns.find((column) => column.id === 'done');
    assert.strictEqual(doneColumn()?.cards.length, 20, 'Done keeps its twenty');
    assert.strictEqual(doneColumn(new Set(['done']))?.cards.length, 30);
  });

  test('each card carries what the task is now, for its menu to check', () => {
    const cards = new Map(
      board(createIndex(), 'status', '', options).columns.flatMap((column) => column.cards).map((card) => [card.taskId, card.current]),
    );
    assert.deepStrictEqual(cards.get('audit'), ['status:doing', 'priority:high'], 'a date past is not a choice the menu offers');
    assert.deepStrictEqual(cards.get('call'), ['status:', 'priority:', 'due:today']);
    assert.deepStrictEqual(cards.get('brief'), ['status:review', 'priority:'], 'a far date checks nothing');
    assert.deepStrictEqual(cards.get('draft'), ['status:todo', 'priority:low', 'due:']);
    assert.ok(cards.get('ship')?.includes('done'));
  });

  test('a status named done is the Done column, not a second one', () => {
    const index = createIndex();
    const marked = createTask('marked', '- [ ] Marked done by hand #status/done', {});
    index.tasks.set(marked.id, marked);
    const layout = board(index, 'status', '', options);
    assert.deepStrictEqual(
      layout.columns.filter((column) => column.label === 'Done').length,
      1,
      'one column reads Done',
    );
    const doneColumn = layout.columns[layout.columns.length - 1];
    assert.strictEqual(doneColumn.id, 'done');
    assert.strictEqual(doneColumn.cards[0].taskId, marked.id, 'and the open task marked done heads it');
  });

  test('a configured status named done adds no column beside Done', () => {
    const layout = board(createIndex(), 'status', '', {
      ...options,
      statuses: ['todo', 'doing', 'done'],
    });
    assert.deepStrictEqual(
      layout.columns.map((column) => column.label),
      ['No status', 'Todo', 'Doing', 'Review', 'Done'],
    );
  });

  test('says when almost nothing carries a status, and only then', () => {
    // The fixture writes a status on most of its open tasks.
    assert.strictEqual(board(createIndex(), 'status', '', options).statusHint, undefined);

    // A status is read from the tags written on the task's own line.
    const bare = createIndex();
    for (const task of bare.tasks.values()) {
      const isStatus = (key: string): boolean => key.toLowerCase().startsWith('#status/');
      task.tags = task.tags.filter((key) => !isStatus(key));
      task.associationTagGroups = (task.associationTagGroups ?? []).map((group) =>
        group.filter((tag) => !isStatus(tag.key)),
      );
    }
    const layout = board(bare, 'status', '', options);
    const open = [...bare.tasks.values()].filter((task) => !task.completed).length;
    assert.deepStrictEqual(layout.statusHint, { withoutStatus: open, open });
    assert.strictEqual(
      board(bare, 'due', '', options).statusHint,
      undefined,
      'another grouping has nothing to say',
    );
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
      ['due:needsdate', []],
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
      [false, false, true, true, false, false, true, true],
    );
    assert.strictEqual(due.columns[1].cards[0].overdue, true);
  });

  test('a task more than 30 days overdue has a band of its own, first, and says when it was due', () => {
    const index = createIndex();
    index.tasks.set(
      'lease',
      createTask('lease', '- [ ] Renew the lease 📅 2026-07-01', {
        dueAt: at(7, 1),
        dueText: '2026-07-01',
      }),
    );
    const due = board(index, 'due', '', options);
    const band = due.columns.find((column) => column.id === 'due:needsdate');
    assert.deepStrictEqual(band?.cards.map((card) => card.taskId), ['lease']);
    assert.strictEqual(band?.label, 'Needs a new date');
    assert.strictEqual(band?.cards[0].overdue, false);
    assert.strictEqual(band?.cards[0].stale, true);
    assert.ok(band?.cards[0].details.includes('was due 2026-07-01'), band?.cards[0].details.join(', '));
    assert.strictEqual(resolveTaskMove(index.tasks.get('lease') as Task, 'due:needsdate', options).kind, 'unchanged');
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
    const board = layoutTaskBoard({ index, tasks: chosen, requestedGroupBy: 'status', options });
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

    const invalid = createTaskBoard({
      index: createIndex(),
      preferences: preferencesWith({}),
      search: { query: 'priority >= high', invalidQuery: 'priority >=' },
      options,
    });
    // The box keeps the search that ran as chips, and the typed one pending.
    assert.strictEqual(invalid.query.text, 'priority >= high');
    assert.strictEqual(invalid.query.pending, 'priority >=');
    assert.ok(invalid.query.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
    assert.strictEqual(invalid.taskCount, 1, 'the applied search still chooses the tasks');

    // Refine counts only what could narrow these tasks.
    const tagged = board(createIndex(), 'status', 'is:open', options);
    assert.ok(tagged.query.facets.every((facet) => facet.values.every((value) => value.count < 4)));
  });

  test('lists the searched tasks when shown as a list, with the settings it edits', () => {
    const listed = createTaskBoard({
      index: createIndex(),
      preferences: preferencesWith({ taskBoardLayout: 'list' }),
      search: { query: 'is:done' },
      options,
    });
    assert.strictEqual(listed.layout, 'list');
    assert.deepStrictEqual(listed.columns, []);
    assert.deepStrictEqual(
      listed.tasks?.map((item) => item.task.id).sort(),
      ['file', 'ship'],
      'the list shows what the search found, with no filter of its own',
    );
    assert.deepStrictEqual(listed.taskCounts, { all: 2, active: 0, completed: 2 });
    assert.deepStrictEqual(listed.settings, {
      statuses: ['todo', 'doing'],
      statusNamespace: 'status',
      // Every column the board draws, the unlisted review with them.
      columns: [
        { status: 'todo', openTasks: 1 },
        { status: 'doing', openTasks: 1 },
        { status: 'review', openTasks: 1 },
      ],
    });
    assert.strictEqual(board(createIndex(), 'status', '', options).tasks, undefined);
  });

  test('shows the searched tasks as a table, sorted by a column when asked', () => {
    const tabled = createTaskBoard({
      index: createIndex(),
      preferences: preferencesWith({ taskBoardLayout: 'table' }),
      search: { query: '' },
      options,
    });
    assert.strictEqual(tabled.layout, 'table');
    assert.strictEqual(tabled.tasks, undefined, 'the list is not sent as well');
    assert.deepStrictEqual(
      tabled.table?.columns.map((column) => column.id),
      ['title', 'due', 'priority', 'assignee', 'note'],
      'the default columns until others are chosen',
    );
    assert.strictEqual(tabled.table?.available.length, 14);
    assert.strictEqual(tabled.table?.rows.length, tabled.taskCounts.all);
    assert.ok(
      tabled.table?.rows.every((row) => row.cells.length === 5 && row.cells[0].text),
      'every row has a cell per column and a title',
    );

    const chosen = createTaskBoard({
      index: createIndex(),
      preferences: preferencesWith({
        taskBoardLayout: 'table',
        taskTableColumns: ['title', 'status'],
        taskTableSort: { column: 'title', direction: 'desc' },
      }),
      search: { query: '' },
      options,
    });
    const titles = chosen.table?.rows.map((row) => row.cells[0].text) ?? [];
    assert.deepStrictEqual(titles, [...titles].sort().reverse(), 'sorted by title, last first');
    assert.deepStrictEqual(chosen.table?.columns.map((column) => column.label), ['Task', 'Status']);
    assert.deepStrictEqual(chosen.table?.sort, { column: 'title', direction: 'desc' });
  });

  test('renders a title\'s Markdown in the table, and keeps the plain words too', () => {
    const index = createIndex();
    const marked = createTask(
      'marked',
      '- [ ] Review the **shell-camera** rig with `ivo.sh` before [the dispatch](https://example.com)',
      {},
    );
    index.tasks.set(marked.id, marked);

    const table = createTaskBoard({
      index,
      preferences: preferencesWith({ taskBoardLayout: 'table', taskTableColumns: ['title'] }),
      search: { query: '' },
      options,
    }).table;
    const row = table?.rows.find((entry) => entry.taskId === 'marked');

    // The cell draws the Markdown, as every other surface that shows a task
    // title already does.
    assert.strictEqual(
      row?.cells[0].html,
      'Review the <strong>shell-camera</strong> rig with <code>ivo.sh</code> '
        + 'before <a href="https://example.com">the dispatch</a>',
    );
    // And keeps the written form, which is what a label and a sort read.
    assert.match(row?.cells[0].text ?? '', /\*\*shell-camera\*\*/);

    // A title with nothing to render comes back as its own words.
    const plain = table?.rows.find((entry) => entry.taskId === 'call');
    assert.strictEqual(plain?.cells[0].html, plain?.cells[0].text);
    assert.doesNotMatch(plain?.cells[0].html ?? '', /</, 'no markup to insert');
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

  test('a mostly overdue column keeps red for its worst third, and takes a limit', () => {
    const doing = Array.from({ length: 8 }, (_, number) =>
      createTask(`d${number}`, `- [ ] Task ${number} #status/doing`, {
        // Six overdue, the oldest first; two not dated.
        dueAt: number < 6 ? at(9, 1 + number) : undefined,
        associationTagGroups: [[{ key: '#status/doing', label: '#status/doing' } as TagReference]],
      }),
    );
    const index = createIndex();
    doing.forEach((task) => index.tasks.set(task.id, task));
    const layout = layoutTaskBoard({ index, tasks: doing, requestedGroupBy: 'status', options: { ...options, limits: { doing: 3, 'status:todo': 2 } } });
    const column = layout.columns.find((each) => each.id === 'status:doing');
    assert.strictEqual(column?.overdueCount, 6);
    assert.strictEqual(column?.limit, 3, 'a limit by status');
    assert.strictEqual(layout.columns.find((each) => each.id === 'status:todo')?.limit, 2, 'or by column');
    const tones = Object.fromEntries(column!.cards.map((card) => [card.taskId, card.overdueTone ?? '']));
    assert.deepStrictEqual(tones, { d0: 'full', d1: 'full', d2: 'quiet', d3: 'quiet', d4: 'quiet', d5: 'quiet', d6: '', d7: '' });

    // At half or less, every overdue card keeps the red.
    const half = layoutTaskBoard({ index, tasks: doing.slice(4), requestedGroupBy: 'status', options });
    const halfColumn = half.columns.find((each) => each.id === 'status:doing');
    assert.ok(halfColumn?.cards.filter((card) => card.overdue).every((card) => card.overdueTone === 'full'));

    // The Overdue column is all overdue by definition, so it is left alone.
    const due = layoutTaskBoard({ index, tasks: doing, requestedGroupBy: 'due', options });
    const overdue = due.columns.find((each) => each.id === 'due:overdue');
    assert.strictEqual(overdue?.overdueCount, 0);
    assert.ok(overdue?.cards.every((card) => card.overdueTone === undefined));
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
    // A day of the Tasks view's Upcoming names one date.
    assert.strictEqual(apply('call', 'due:2026-09-17'), '- [ ] Call Ren 📅 2026-09-17');
    assert.strictEqual(apply('call', 'due:2026-09-13'), 'unchanged');
    const label = resolveTaskMove(task('call'), 'due:2026-09-17', options);
    assert.strictEqual(label.kind === 'edit' ? label.label : label.kind, 'Due Thu 2026-09-17');
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
