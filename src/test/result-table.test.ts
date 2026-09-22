import * as assert from 'assert';

import {
  compareTasksByColumn,
  createTaskCells,
  DEFAULT_TASK_COLUMNS,
  parseTaskColumns,
  TableTask,
} from '../ui/state/resultTable';

const at = (month: number, day: number): number =>
  new Date(2026, month - 1, day).getTime();
const now = at(9, 13) + 10 * 60 * 60 * 1000;

function task(values: Partial<TableTask> & { title: string }): TableTask {
  return { completed: false, fileName: 'tasks.md', line: 1, ...values };
}

suite('Result table', () => {
  test('reads a columns= value, title first whatever was written', () => {
    assert.deepStrictEqual(parseTaskColumns('due, for, note'), {
      columns: ['title', 'due', 'assignee', 'note'],
      unknown: [],
    });
    assert.deepStrictEqual(
      parseTaskColumns('priority,title,priority,colour'),
      { columns: ['title', 'priority'], unknown: ['colour'] },
      'a column named twice is one column, and an unknown one is reported',
    );
    assert.deepStrictEqual(parseTaskColumns('').columns, ['title']);
    assert.deepStrictEqual(DEFAULT_TASK_COLUMNS[0], 'title');
  });

  test('makes a cell for each column, saying what state it is in', () => {
    const cells = createTaskCells(
      task({
        title: 'Chase it',
        dueAt: at(9, 10),
        dueText: '2026-09-10',
        priority: 'high',
        assignee: '@dana',
        status: 'doing',
        tags: ['#project/atlas', '@dana'],
        dependsOn: ['a1'],
        line: 12,
      }),
      ['title', 'due', 'priority', 'assignee', 'status', 'tags', 'note', 'blockedBy', 'scheduled'],
      now,
    );
    assert.deepStrictEqual(
      cells.map((cell) => cell.text),
      ['Chase it', '2026-09-10', 'high', '@dana', 'doing', '#project/atlas @dana', 'tasks.md:12', 'a1', ''],
    );
    assert.strictEqual(cells[1].kind, 'overdue', 'a past due date on an open task');
    assert.strictEqual(cells[6].kind, 'muted', 'where it lives is quieter than what it is');
    assert.strictEqual(
      createTaskCells(task({ title: 'Done', completed: true, dueAt: at(9, 10) }), ['due'], now)[0].kind,
      undefined,
      'a finished task is not overdue',
    );
  });

  test('sorts by a column, with the empty cells last either way', () => {
    const tasks = [
      task({ title: 'b', dueAt: at(9, 20), priority: 'low' }),
      task({ title: 'a' }),
      task({ title: 'c', dueAt: at(9, 10), priority: 'highest' }),
    ];
    const order = (column: 'due' | 'priority' | 'title', direction: 'asc' | 'desc') =>
      [...tasks].sort(compareTasksByColumn({ column, direction })).map((entry) => entry.title);
    assert.deepStrictEqual(order('due', 'asc'), ['c', 'b', 'a']);
    assert.deepStrictEqual(order('due', 'desc'), ['b', 'c', 'a'], 'no date is last, not first');
    assert.deepStrictEqual(order('priority', 'asc'), ['c', 'b', 'a'], 'highest priority leads');
    assert.deepStrictEqual(order('title', 'desc'), ['c', 'b', 'a']);
  });
});
