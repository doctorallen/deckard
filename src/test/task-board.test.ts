import * as assert from 'assert';

import { tokenizeInline } from '../domain/markdown/inline';

import { createPreferences } from './preferenceServices';
import { createTaskBoard, layoutTaskBoard, resolveTaskMove, TaskBoardOptions } from '../ui/state/taskBoardState';
import { isAwaitingIndex } from '../ui/webview/pages/taskBoard/taskBoardController';
import { createQueryContext } from '../domain/query/queryContext';
import { PersistedPreferences, TagReference, Task, TaskBoardGroupBy, WorkspaceIndex } from '../domain/model';
import { DEFAULT_TASK_STATUSES, statusForSymbol } from '../domain/tasks/taskStatuses';

const at = (month: number, day: number): number =>
  new Date(2026, month - 1, day).getTime();

/** Mid-morning on Sunday 2026-09-13. */
const options: TaskBoardOptions = {
  queryContext: createQueryContext(at(9, 13) + 9 * 60 * 60 * 1000),
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

  test('groups by the status in each task\'s box', () => {
    const layout = board(createIndex(), 'status', '', options);
    assert.deepStrictEqual(ids(layout), [
      // Every open status of the list, in its order; Cancelled is hidden.
      ['status:todo', ['call', 'draft']],
      ['status:in-progress', ['audit']],
      ['status:waiting', ['brief']],
      ['status:someday', []],
      ['status:blocked', []],
      ['done', ['ship', 'file']],
    ]);
    assert.deepStrictEqual(layout.columns.map((column) => column.symbol), [' ', '/', 'w', 's', '=', 'x'], 'each header says its character');
    assert.deepStrictEqual(board(createIndex(), 'priority', '', options).columns.map((column) => column.symbol), [undefined, undefined, undefined, undefined, undefined, undefined, undefined], 'only status columns say one');
  });

  test('a long column draws its first hundred cards, and the rest on request', () => {
    const tasks = Array.from({ length: 250 }, (_, number) =>
      createTask(`t${number}`, `- [/] Task ${number}`, {}),
    );
    const done = Array.from({ length: 30 }, (_, number) =>
      createTask(`d${number}`, `- [x] Done ${number}`, { completed: true, status: { symbol: 'x', name: 'Done', type: 'done' }, doneAt: at(9, 1) + number }),
    );
    const index: WorkspaceIndex = {
      files: new Map(), sections: new Map(), tags: new Map(), entities: new Map(), updatedAt: Date.now(),
      tasks: new Map([...tasks, ...done].map((task) => [task.id, task])),
    };
    const doing = (shownColumns?: ReadonlySet<string>) =>
      board(index, 'status', '', { ...options, shownColumns }).columns.find((column) => column.id === 'status:in-progress');
    assert.strictEqual(doing()?.cards.length, 100);
    assert.strictEqual(doing()?.hiddenCount, 150);
    assert.strictEqual(doing(new Set(['status:in-progress']))?.cards.length, 250, 'Show 150 more draws them all');
    assert.strictEqual(doing(new Set(['status:in-progress']))?.hiddenCount, 0);
    const doneColumn = (shownColumns?: ReadonlySet<string>) =>
      board(index, 'status', '', { ...options, shownColumns }).columns.find((column) => column.id === 'done');
    assert.strictEqual(doneColumn()?.cards.length, 20, 'Done keeps its twenty');
    assert.strictEqual(doneColumn(new Set(['done']))?.cards.length, 30);
  });

  test('each card carries what the task is now, for its menu to check', () => {
    const cards = new Map(
      board(createIndex(), 'status', '', options).columns.flatMap((column) => column.cards).map((card) => [card.taskId, card.current]),
    );
    assert.deepStrictEqual(cards.get('audit'), ['status:in-progress', 'priority:high'], 'a date past is not a choice the menu offers');
    assert.deepStrictEqual(cards.get('call'), ['status:todo', 'priority:', 'due:today']);
    assert.deepStrictEqual(cards.get('brief'), ['status:waiting', 'priority:'], 'a far date checks nothing');
    assert.deepStrictEqual(cards.get('draft'), ['status:todo', 'priority:low', 'due:']);
    assert.ok(cards.get('ship')?.includes('done'));
  });

  test('a #status/done tag closes nothing: the task is in the column its box says', () => {
    const index = createIndex();
    const marked = createTask('marked', '- [ ] Marked done by hand #status/done', {});
    index.tasks.set(marked.id, marked);
    const layout = board(index, 'status', '', options);
    assert.deepStrictEqual(layout.columns.filter((column) => column.label === 'Done').length, 1, 'one column reads Done');
    assert.ok(layout.columns.find((column) => column.id === 'status:todo')?.cards.some((card) => card.taskId === 'marked'));
    assert.ok(!layout.columns.find((column) => column.id === 'done')?.cards.some((card) => card.taskId === 'marked'));
  });

  test('the gear orders the status columns and hides them, by name', () => {
    const layout = board(createIndex(), 'status', '', { ...options, columnOrder: ['Waiting', 'Gone'], hiddenColumns: ['someday', 'cancelled'] });
    assert.deepStrictEqual(layout.columns.map((column) => column.label), ['Waiting', 'Todo', 'In progress', 'Blocked', 'Done']);
    const index = createIndex();
    index.tasks.set('dropped', createTask('dropped', '- [-] Drop it ❌ 2026-09-11', { status: { symbol: '-', name: 'Cancelled', type: 'cancelled' }, cancelledAt: at(9, 11) }));
    const all = board(index, 'status', '', { ...options, hiddenColumns: [] });
    assert.deepStrictEqual(all.columns.slice(-2).map((column) => [column.id, column.symbol, column.cards.map((card) => card.taskId)]), [
      ['done', 'x', ['ship', 'file']],
      ['cancelled', '-', ['dropped']],
    ], 'Cancelled follows Done when the gear shows it');
    const preferred = createTaskBoard({ index, preferences: preferencesWith({ taskBoardColumnOrder: ['Blocked'], taskBoardHiddenColumns: [] }), search: { query: '' }, options });
    assert.deepStrictEqual(preferred.columns.map((column) => column.id).slice(0, 2), ['status:blocked', 'status:todo'], 'the board reads the gear\'s preferences');
    assert.strictEqual(preferred.columns.at(-1)?.id, 'cancelled');
  });

  test('a character no status names is a column of its own, after the statuses', () => {
    const index = createIndex();
    index.tasks.set('ask', createTask('ask', '- [?] Ask about the lens', {}));
    const layout = board(index, 'status', '', options);
    const unknown = layout.columns.find((column) => column.id === 'status:unknown-63');
    assert.deepStrictEqual([unknown?.label, unknown?.symbol, unknown?.cards.map((card) => card.taskId)], ['Unknown', '?', ['ask']]);
    assert.strictEqual(layout.columns.indexOf(unknown as never), layout.columns.length - 2, 'last before Done');
    assert.strictEqual(resolveTaskMove(index.tasks.get('call') as Task, 'status:unknown-63', options).kind, 'edit');
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
    assert.deepStrictEqual(card.titleTokens, [
      { kind: 'text', text: 'Read ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'the brief' }] },
      { kind: 'text', text: ', ' },
      { kind: 'code', text: 'notes.md' },
      { kind: 'text', text: ', and ' },
      { kind: 'link', url: 'https://example.com', children: [{ kind: 'text', text: 'the spec' }] },
      // Raw HTML in a task line stays text.
      { kind: 'text', text: ' <b>now</b>' },
    ]);
    assert.match(card.title, /\*\*the brief\*\*/, 'the plain title is kept for search');
    assert.deepStrictEqual(card.titleTokens, tokenizeInline(card.title), 'and its tokens, for the page to draw');
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
      // Every status the gear lists, each with its open tasks.
      columns: [
        { id: 'status:todo', name: 'Todo', symbol: ' ', shown: true, openTasks: 2 },
        { id: 'status:in-progress', name: 'In progress', symbol: '/', shown: true, openTasks: 1 },
        { id: 'status:waiting', name: 'Waiting', symbol: 'w', shown: true, openTasks: 1 },
        { id: 'status:someday', name: 'Someday', symbol: 's', shown: true, openTasks: 0 },
        { id: 'status:blocked', name: 'Blocked', symbol: '=', shown: true, openTasks: 0 },
        { id: 'done', name: 'Done', symbol: 'x', shown: true, openTasks: 0, fixed: true },
        { id: 'cancelled', name: 'Cancelled', symbol: '-', shown: false, openTasks: 0 },
      ],
      parentTag: false,
    });
    const hidden = createTaskBoard({ index: createIndex(), preferences: preferencesWith({ taskBoardHiddenColumns: ['Waiting'] }), search: { query: '' }, options });
    assert.deepStrictEqual(hidden.settings.columns[2], { id: 'status:waiting', name: 'Waiting', symbol: 'w', shown: false, openTasks: 1 }, 'a hidden status still counts its open tasks');
    assert.strictEqual(hidden.taskCount, 6, 'and the board\'s total counts them');
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
    assert.deepStrictEqual(row?.cells[0].tokens, [
      { kind: 'text', text: 'Review the ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'shell-camera' }] },
      { kind: 'text', text: ' rig with ' },
      { kind: 'code', text: 'ivo.sh' },
      { kind: 'text', text: ' before ' },
      { kind: 'link', url: 'https://example.com', children: [{ kind: 'text', text: 'the dispatch' }] },
    ]);
    // And keeps the written form, which is what a label and a sort read.
    assert.match(row?.cells[0].text ?? '', /\*\*shell-camera\*\*/);
    assert.deepStrictEqual(row?.cells[0].tokens, tokenizeInline(row?.cells[0].text ?? ''), 'and its tokens, for the page to draw');

    // A title with nothing to render comes back as its own words.
    const plain = table?.rows.find((entry) => entry.taskId === 'call');
    assert.deepStrictEqual(plain?.cells[0].tokens, [{ kind: 'text', text: plain?.cells[0].text }]);
  });

  test('a mostly overdue column keeps red for its worst third, and takes a limit', () => {
    const doing = Array.from({ length: 8 }, (_, number) =>
      createTask(`d${number}`, `- [/] Task ${number}`, {
        // Six overdue, the oldest first; two not dated.
        dueAt: number < 6 ? at(9, 1 + number) : undefined,
      }),
    );
    const index = createIndex();
    doing.forEach((task) => index.tasks.set(task.id, task));
    const layout = layoutTaskBoard({ index, tasks: doing, requestedGroupBy: 'status', options: { ...options, limits: { 'in-progress': 3, 'status:todo': 2 } } });
    const column = layout.columns.find((each) => each.id === 'status:in-progress');
    assert.strictEqual(column?.overdueCount, 6);
    assert.strictEqual(column?.limit, 3, 'a limit by status');
    assert.strictEqual(layout.columns.find((each) => each.id === 'status:todo')?.limit, 2, 'or by column');
    const tones = Object.fromEntries(column!.cards.map((card) => [card.taskId, card.overdueTone ?? '']));
    assert.deepStrictEqual(tones, { d0: 'full', d1: 'full', d2: 'quiet', d3: 'quiet', d4: 'quiet', d5: 'quiet', d6: '', d7: '' });

    // At half or less, every overdue card keeps the red.
    const half = layoutTaskBoard({ index, tasks: doing.slice(4), requestedGroupBy: 'status', options });
    const halfColumn = half.columns.find((each) => each.id === 'status:in-progress');
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
    assert.strictEqual(apply('audit', 'status:in-progress'), 'unchanged');
    assert.strictEqual(apply('draft', 'priority:high'), '- [ ] Draft notes ⏫');
    assert.strictEqual(apply('call', 'due:tomorrow'), '- [ ] Call Ren 📅 2026-09-14');
    assert.strictEqual(apply('call', 'due:later'), 'refused');
    // A day of the Tasks view's Upcoming names one date.
    assert.strictEqual(apply('call', 'due:2026-09-17'), '- [ ] Call Ren 📅 2026-09-17');
    assert.strictEqual(apply('call', 'due:2026-09-13'), 'unchanged');
    const label = resolveTaskMove(task('call'), 'due:2026-09-17', options);
    assert.strictEqual(label.kind === 'edit' ? label.label : label.kind, 'Due Thu 2026-09-17');
    // Moving a finished task out of Done reopens it in the same edit, as
    // its status's character.
    assert.strictEqual(apply('ship', 'status:in-progress'), '- [/] Ship it');
  });
});

function createIndex(): WorkspaceIndex {
  const tasks: Task[] = [
    createTask('audit', '- [/] Audit the feed 📅 2026-09-12 ⏫', {
      dueAt: at(9, 12),
      dueText: '2026-09-12',
      priority: 'high',
    }),
    createTask('call', '- [ ] Call Ren 📅 2026-09-13', {
      dueAt: at(9, 13),
      dueText: '2026-09-13',
    }),
    createTask('brief', '- [w] Brief the team 📅 2026-09-18', {
      dueAt: at(9, 18),
      dueText: '2026-09-18',
    }),
    createTask('draft', '- [ ] Draft notes 🔽', { priority: 'low' }),
    createTask('ship', '- [x] Ship it ✅ 2026-09-12', {
      completed: true,
      status: { symbol: 'x', name: 'Done', type: 'done' },
      doneAt: at(9, 12),
    }),
    createTask('file', '- [x] File it ✅ 2026-09-10', {
      completed: true,
      status: { symbol: 'x', name: 'Done', type: 'done' },
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
    status: statusForSymbol(DEFAULT_TASK_STATUSES, sourceLineText.charAt(3)),
    sourceLineText,
    ...values,
  };
}
