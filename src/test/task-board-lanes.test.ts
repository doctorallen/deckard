import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { PersistedPreferences, Task, WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { isLaneAxisFor, listLaneAxes, refuseCellMove, type LaneBoardRules } from '../domain/tasks/boardLanes';
import { combineTaskMoves, type TaskMove } from '../domain/tasks/boardMoves';
import type { TaskBoardSnapshot } from '../ui/protocol/taskBoard';
import { createTaskBoard, layoutTaskBoard, resolveCellMove, type TaskBoardOptions } from '../ui/state/taskBoardState';
import { narrowTaskBoardMessage } from '../ui/webview/pages/taskBoard/messages';
import { createPreferences } from './preferenceServices';

/** Noon on Monday 2026-09-21. */
const NOW = new Date(2026, 8, 21, 12).getTime();
const options: TaskBoardOptions = { queryContext: createQueryContext(NOW), format: 'emoji' };

/** A team's work: tasks by status, priority, team, and person, some done. */
function createIndex(): WorkspaceIndex {
  const lines = [
    '# Ledger migration #initiative/ledger-migration',
    '- [ ] Draft the cutover plan #team/payments ⏫',
    '- [/] Move the rates table #team/rates',
    '- [ ] Review the schema #team/payments #team/rates 🔽',
    '- [w] Wait on the vendor [assignee:: @dana]',
    '- [ ] Write the runbook 📅 2026-09-14',
    '- [x] Freeze the old ledger #team/payments ✅ 2026-09-18',
  ];
  return buildWorkspaceIndex(new Map([['notes/ledger.md', parseMarkdown('notes/ledger.md', lines.join('\n'))]]));
}

/** Preferences as a fresh install has them, with the board's own choices. */
function preferencesWith(values: Partial<PersistedPreferences>): PersistedPreferences {
  const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
  try {
    return { ...store.reader.value, taskBoardLayout: 'board', ...values };
  } finally {
    store.repository.dispose();
  }
}

/** The Task Board page as the host would build it, with `values` chosen. */
function boardWith(index: WorkspaceIndex, values: Partial<PersistedPreferences>): TaskBoardSnapshot {
  return createTaskBoard({ index, preferences: preferencesWith(values), search: { query: '' }, options });
}

/** The task whose title begins with `words`. */
function taskNamed(index: WorkspaceIndex, words: string): Task {
  const task = [...index.tasks.values()].find((candidate) => candidate.title.startsWith(words));
  assert.ok(task, `a task "${words}"`);
  return task;
}

/** Each lane's cells, as the titles of the cards in each, by column id; empty cells left out. */
function cellsOf(board: TaskBoardSnapshot): Record<string, Record<string, string[]>> {
  return Object.fromEntries((board.lanes ?? []).map((lane) => [
    lane.id,
    Object.fromEntries(lane.cells.filter((cell) => cell.cards.length > 0).map((cell) => [cell.id, cell.cards.map((card) => card.title.split(' #')[0].replace(/ [⏫🔽📅].*$/u, ''))])),
  ]));
}

suite('Task board lanes', () => {
  test('Lanes offers every axis but Group’s, and Tag… always', () => {
    assert.deepStrictEqual(listLaneAxes('status'), ['priority', 'due', 'assignee', 'tag']);
    assert.deepStrictEqual(listLaneAxes('priority'), ['status', 'due', 'assignee', 'tag']);
    assert.deepStrictEqual(listLaneAxes('assignee'), ['status', 'priority', 'due', 'tag']);
    assert.deepStrictEqual(listLaneAxes('tag'), ['status', 'priority', 'due', 'assignee', 'tag'], 'another namespace');
    assert.strictEqual(isLaneAxisFor({ by: 'status' }, { by: 'priority' }), true);
    assert.strictEqual(isLaneAxisFor({ by: 'status' }, { by: 'status' }), false);
    assert.strictEqual(isLaneAxisFor({ by: 'tag', namespace: 'team' }, { by: 'tag', namespace: 'Team' }), false, 'the same namespace');
    assert.strictEqual(isLaneAxisFor({ by: 'tag', namespace: 'team' }, { by: 'tag', namespace: 'initiative' }), true);
  });

  test('lanes by priority: a row per priority, a cell in every column, Done’s tasks in their lane', () => {
    const board = boardWith(createIndex(), { taskBoardGroup: 'status', taskBoardLanes: 'priority' });
    assert.strictEqual(board.lanesBy, 'priority');
    assert.deepStrictEqual(board.lanes?.map((lane) => lane.id), ['priority:highest', 'priority:high', 'priority:medium', 'priority:', 'priority:low', 'priority:lowest']);
    const columns = board.columns.map((column) => column.id);
    assert.deepStrictEqual(columns, ['status:todo', 'status:in-progress', 'status:waiting', 'status:someday', 'status:blocked', 'done']);
    assert.ok(board.columns.every((column) => column.cards.length === 0), 'every card is in a cell');
    assert.ok(board.lanes?.every((lane) => lane.cells.map((cell) => cell.id).join() === columns.join()), 'every lane has every column, in order');
    assert.deepStrictEqual(cellsOf(board), {
      'priority:highest': {},
      'priority:high': { 'status:todo': ['Draft the cutover plan'] },
      'priority:medium': {},
      'priority:': {
        'status:todo': ['Write the runbook'],
        'status:in-progress': ['Move the rates table'],
        'status:waiting': ['Wait on the vendor'],
        done: ['Freeze the old ledger'],
      },
      'priority:low': { 'status:todo': ['Review the schema'] },
      'priority:lowest': {},
    });
    const card = board.lanes?.[1].cells[0].cards[0];
    assert.ok(card && !card.details.some((detail) => /priority/.test(detail)), 'a card does not say the priority its lane says');
  });

  test('lanes by tag: a task with two of the namespace’s tags is in both, No team last', () => {
    const board = boardWith(createIndex(), { taskBoardGroup: 'status', taskBoardLanes: 'tag', taskBoardLanesNamespace: 'team' });
    assert.strictEqual(board.lanesNamespace, 'team');
    assert.deepStrictEqual(board.lanes?.map((lane) => [lane.id, lane.label]), [['tag:team/payments', 'Payments'], ['tag:team/rates', 'Rates'], ['tag:team/', 'No team']]);
    const cells = cellsOf(board);
    assert.deepStrictEqual(cells['tag:team/payments']['status:todo'], ['Draft the cutover plan', 'Review the schema']);
    assert.deepStrictEqual(cells['tag:team/rates']['status:todo'], ['Review the schema']);
    assert.deepStrictEqual(cells['tag:team/payments'].done, ['Freeze the old ledger']);
    const review = board.lanes?.[1].cells[0].cards.find((card) => card.title.startsWith('Review'));
    assert.ok(review?.details.includes('also in Payments'), 'a card says the other lane it is in');
    assert.ok(review?.current.includes('tag:team/rates'), 'its menu checks its lanes');
  });

  test('lanes by status: Done and Cancelled are lanes, and a closed task is where they meet its column', () => {
    const board = boardWith(createIndex(), { taskBoardGroup: 'priority', taskBoardLanes: 'status' });
    assert.deepStrictEqual(board.lanes?.map((lane) => lane.id), ['status:todo', 'status:in-progress', 'status:waiting', 'status:someday', 'status:blocked', 'done']);
    assert.deepStrictEqual(cellsOf(board).done, { done: ['Freeze the old ledger'] });
    const moved = board.lanes?.[1].cells.find((cell) => cell.id === 'priority:')?.cards[0];
    assert.ok(moved && !moved.details.includes('In progress'), 'a card does not say the status its lane says');
  });

  test('lanes by the columns’ own axis, by tag with no namespace, or on the Dashboard are none', () => {
    const index = createIndex();
    assert.strictEqual(boardWith(index, { taskBoardGroup: 'priority', taskBoardLanes: 'priority' }).lanes, undefined);
    assert.strictEqual(boardWith(index, { taskBoardGroup: 'tag', taskBoardGroupNamespace: 'team', taskBoardLanes: 'tag', taskBoardLanesNamespace: 'team' }).lanes, undefined);
    assert.strictEqual(boardWith(index, { taskBoardLanes: 'tag' }).lanes, undefined);
    const crossed = boardWith(index, { taskBoardGroup: 'tag', taskBoardGroupNamespace: 'team', taskBoardLanes: 'tag', taskBoardLanesNamespace: 'initiative' });
    assert.deepStrictEqual(crossed.lanes?.map((lane) => lane.id), ['tag:initiative/ledger-migration', 'tag:initiative/']);
    // The Dashboard lays out its board with no lanes (D6).
    const dashboard = layoutTaskBoard({ index, tasks: [...index.tasks.values()], requestedGroupBy: 'status', options });
    assert.strictEqual(dashboard.lanes, undefined);
    assert.ok(dashboard.columns.some((column) => column.cards.length > 0));
  });

  test('a lane’s cells keep their column’s rules: the Done limit, Overdue taking no drop', () => {
    const lines = ['# Done', ...Array.from({ length: 25 }, (_, i) => `- [x] Closed ${i} #team/payments ✅ 2026-09-${String(10 + (i % 9)).padStart(2, '0')}`), '- [ ] Late 📅 2026-09-14 #team/payments'];
    const index = buildWorkspaceIndex(new Map([['notes/done.md', parseMarkdown('notes/done.md', lines.join('\n'))]]));
    const board = boardWith(index, { taskBoardGroup: 'due', taskBoardLanes: 'tag', taskBoardLanesNamespace: 'team' });
    const payments = board.lanes?.[0];
    const done = payments?.cells.find((cell) => cell.id === 'done');
    assert.strictEqual(done?.cards.length, 20);
    assert.strictEqual(done?.hiddenCount, 5);
    const overdue = payments?.cells.find((cell) => cell.id === 'due:overdue');
    assert.strictEqual(overdue?.droppable, false);
    assert.strictEqual(overdue?.cards.length, 1);
  });

  test('a cell refuses a card it cannot take, and says why', () => {
    const rules: LaneBoardRules = {
      columns: [
        { id: 'due:overdue', label: 'Overdue', droppable: false },
        { id: 'due:today', label: 'Today', droppable: true },
        { id: 'done', label: 'Done', droppable: true },
      ],
      lanes: [
        { id: 'tag:team/payments', label: 'payments', droppable: true },
        { id: 'tag:team/rates', label: 'rates', droppable: true },
      ],
    };
    const from = { column: 'due:today', lane: 'tag:team/payments' };
    assert.strictEqual(refuseCellMove(from, from, rules), undefined, 'its own cell');
    assert.strictEqual(refuseCellMove(from, { column: 'due:today', lane: 'tag:team/rates' }, rules), undefined);
    assert.match(String(refuseCellMove(from, { column: 'due:overdue', lane: 'tag:team/payments' }, rules)), /range of days/);
    assert.strictEqual(refuseCellMove({ column: 'due:overdue', lane: 'tag:team/payments' }, { column: 'due:overdue', lane: 'tag:team/rates' }, rules), undefined, 'Overdue refuses another column’s card, not its own between lanes');
    assert.strictEqual(refuseCellMove(from, { column: 'done', lane: 'tag:team/payments' }, rules), undefined);
    assert.strictEqual(refuseCellMove(from, { column: 'done', lane: 'tag:team/rates' }, rules), 'Done takes a card only from its own lane.');
    assert.strictEqual(refuseCellMove(from, { column: 'gone', lane: 'tag:team/rates' }, rules), 'That cell is no longer on the board.');

    const byStatus: LaneBoardRules = {
      columns: [{ id: 'priority:high', label: 'High', droppable: true }, { id: 'done', label: 'Done', droppable: true }],
      lanes: [{ id: 'status:todo', label: 'Todo', droppable: true }, { id: 'done', label: 'Done', droppable: true }],
    };
    const todo = { column: 'priority:high', lane: 'status:todo' };
    assert.strictEqual(refuseCellMove(todo, { column: 'done', lane: 'done' }, byStatus), undefined, 'completed where Done meets Done');
    assert.strictEqual(refuseCellMove(todo, { column: 'priority:high', lane: 'done' }, byStatus), 'Drop it in the Done column to complete it.');
    assert.strictEqual(refuseCellMove(todo, { column: 'done', lane: 'status:todo' }, byStatus), 'Drop it in the Done lane to complete it.');
  });

  test('two moves are one: either refusal refuses both, a completion shares no edit', () => {
    const edit = (label: string, mark: string): TaskMove => ({ kind: 'edit', label, edit: (line) => `${line} ${mark}` });
    const both = combineTaskMoves(edit('In progress', 'a'), edit('#team/rates', 'b'));
    assert.strictEqual(both.kind, 'edit');
    assert.strictEqual(both.kind === 'edit' && both.label, 'In progress, #team/rates');
    assert.strictEqual(both.kind === 'edit' && both.edit('- [ ] X'), '- [ ] X a b', 'the column’s edit, then the lane’s');
    assert.strictEqual(combineTaskMoves({ kind: 'unchanged' }, edit('High', 'b')).kind, 'edit');
    assert.strictEqual(combineTaskMoves(edit('High', 'a'), { kind: 'refused', reason: 'no' }).kind, 'refused');
    assert.strictEqual(combineTaskMoves({ kind: 'complete' }, { kind: 'complete' }).kind, 'complete');
    assert.strictEqual(combineTaskMoves({ kind: 'complete' }, edit('High', 'b')).kind, 'refused');
  });

  test('a card dropped in another cell writes its column’s edit and its lane’s as one', () => {
    const index = createIndex();
    const write = (title: string, move: Parameters<typeof resolveCellMove>[1]): string => {
      const task = taskNamed(index, title);
      const resolved = resolveCellMove(task, move, options, index);
      assert.strictEqual(resolved.kind, 'edit', resolved.kind === 'refused' ? resolved.reason : resolved.kind);
      return resolved.kind === 'edit' ? resolved.edit(task.sourceLineText) : '';
    };
    assert.strictEqual(
      write('Draft the cutover', { column: 'status:in-progress', from: 'status:todo', lane: 'tag:team/rates', fromLane: 'tag:team/payments' }),
      '- [/] Draft the cutover plan #team/rates ⏫',
    );
    assert.strictEqual(
      write('Draft the cutover', { column: 'status:todo', from: 'status:todo', lane: 'tag:team/rates', fromLane: 'tag:team/payments' }),
      '- [ ] Draft the cutover plan #team/rates ⏫',
      'within its column, only its lane changes',
    );
    assert.strictEqual(
      write('Freeze the old', { column: 'status:in-progress', from: 'done', lane: 'tag:team/rates', fromLane: 'tag:team/payments' }),
      '- [/] Freeze the old ledger #team/rates',
      'reopened by its column, its status kept by its lane',
    );
    assert.strictEqual(
      write('Write the runbook', { column: 'priority:high', from: 'priority:', lane: 'assignee:@sam', fromLane: 'assignee:' }),
      '- [ ] Write the runbook 📅 2026-09-14 ⏫ 👤 @sam',
    );
    const cutover = taskNamed(index, 'Draft the cutover');
    assert.strictEqual(resolveCellMove(cutover, { column: 'done', from: 'status:todo', lane: 'tag:team/rates', fromLane: 'tag:team/payments' }, options, index).kind, 'refused');
    assert.strictEqual(resolveCellMove(cutover, { column: 'done', from: 'priority:high', lane: 'done', fromLane: 'status:todo' }, options, index).kind, 'complete', 'Done where it meets Done completes it once');
    assert.strictEqual(resolveCellMove(cutover, { column: 'status:todo', from: 'status:todo', lane: 'tag:team/payments', fromLane: 'tag:team/payments' }, options, index).kind, 'unchanged');
  });

  test('the lane messages are checked', () => {
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setBoardLanes', lanes: 'priority' }), { type: 'setBoardLanes', lanes: 'priority' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setBoardLanes', lanes: 'none' }), { type: 'setBoardLanes', lanes: 'none' });
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setBoardLanes', lanes: 'tag', namespace: 'Team' }), { type: 'setBoardLanes', lanes: 'tag', namespace: 'team' });
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardLanes', lanes: 'tag' }), undefined, 'by tag names its namespace');
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setBoardLanes', lanes: 'colour' }), undefined);
    assert.deepStrictEqual(
      narrowTaskBoardMessage({ type: 'moveTask', taskId: 't', column: 'status:todo', from: 'status:todo', lane: 'tag:team/rates', fromLane: 'tag:team/payments', requestId: 3 }),
      { type: 'moveTask', taskId: 't', column: 'status:todo', from: 'status:todo', lane: 'tag:team/rates', fromLane: 'tag:team/payments', requestId: 3 },
    );
    assert.strictEqual(narrowTaskBoardMessage({ type: 'moveTask', taskId: 't', column: 'done', lane: '' }), undefined);
    assert.strictEqual(narrowTaskBoardMessage({ type: 'moveTask', taskId: 't', column: 'done', fromLane: 'tag:team/rates' }), undefined, 'a lane left goes with a lane entered');
  });

  test('Lanes is remembered with Group, and Group by the lanes’ axis takes them away', async () => {
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      await store.taskLayout.setTaskBoardLanes('tag', 'Team');
      assert.strictEqual(store.reader.value.taskBoardLanes, 'tag');
      assert.strictEqual(store.reader.value.taskBoardLanesNamespace, 'team');
      await store.taskLayout.setTaskBoardGroup('priority');
      assert.strictEqual(store.reader.value.taskBoardLanes, 'tag', 'another axis keeps them');
      await store.taskLayout.setTaskBoardGroup('tag', 'team');
      assert.strictEqual(store.reader.value.taskBoardLanes, undefined, 'the same namespace takes them away');
      await store.taskLayout.setTaskBoardLanes('due');
      assert.strictEqual(store.reader.value.taskBoardLanes, 'due');
      await store.taskLayout.setTaskBoardLanes(undefined);
      assert.strictEqual(store.reader.value.taskBoardLanes, undefined, 'None');
    } finally {
      store.repository.dispose();
    }
  });
});
