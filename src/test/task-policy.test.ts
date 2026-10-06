import * as assert from 'assert';

import {
  DEFAULT_TASK_POLICY,
  needsNewDate,
  readLineStatus,
  readStatusNamespace,
} from '../domain/tasks/taskPolicy';
import { createAgenda } from '../ui/state/agendaState';
import { createQueryContext } from '../domain/query/queryContext';
import { Task, WorkspaceIndex } from '../domain/model';

const at = (month: number, day: number): number => new Date(2026, month - 1, day).getTime();
/** Mid-morning on Friday 2026-09-25. */
const now = at(9, 25) + 10 * 60 * 60 * 1000;

suite('Task policy', () => {
  test('a task 30 days overdue is Overdue, and at 31 it needs a new date', () => {
    assert.strictEqual(DEFAULT_TASK_POLICY.needsNewDateAfterDays, 30, 'the setting default');
    assert.strictEqual(needsNewDate(at(8, 26), now, DEFAULT_TASK_POLICY), false, '30 days');
    assert.strictEqual(needsNewDate(at(8, 25), now, DEFAULT_TASK_POLICY), true, '31 days');
    assert.strictEqual(needsNewDate(undefined, now, DEFAULT_TASK_POLICY), false);
    assert.strictEqual(
      needsNewDate(at(1, 1), now, { needsNewDateAfterDays: 0 }),
      false,
      '0 keeps every overdue task in Overdue',
    );
  });

  test('the Tasks view folds what needs a new date last, and 0 draws it as before', () => {
    const index = createIndex([
      createTask({ id: 'recent', dueAt: at(9, 20) }),
      createTask({ id: 'thirty', dueAt: at(8, 26) }),
      createTask({ id: 'old', dueAt: at(7, 1) }),
      createTask({ id: 'undated' }),
    ]);
    const groups = createAgenda(index, createQueryContext(now), { upcomingDays: 7 });
    assert.deepStrictEqual(
      groups.map((group) => [group.id, group.entries.map((entry) => entry.task.id)]),
      [
        ['overdue', ['recent', 'thirty']],
        ['nodate', ['undated']],
        ['needsdate', ['old']],
      ],
    );
    assert.strictEqual(groups[2].label, 'Needs a new date');
    assert.deepStrictEqual(groups[2].entries[0].details, ['was due Wed 2026-07-01', 'tasks.md']);

    assert.deepStrictEqual(
      createAgenda(
        index,
        createQueryContext(now, { taskPolicy: { needsNewDateAfterDays: 0 } }),
        { upcomingDays: 7 },
      ).map((group) => group.id),
      ['overdue', 'nodate'],
    );
  });

  test('reads the status written on the task line, in the namespace set', () => {
    const task = createTask({
      id: 'a',
      associationTagGroups: [[{ key: '#status/waiting', label: '#status/waiting' } as never]],
    });
    assert.strictEqual(readLineStatus(task, DEFAULT_TASK_POLICY.statusNamespace), 'waiting');
    assert.strictEqual(readLineStatus(task, 'state'), '');
  });

  test('reads the status namespace once, for every view: trimmed, checked, and lowercased', () => {
    const read = (value: unknown) =>
      readStatusNamespace({ get: <T>(_key: string, fallback: T) => (value === undefined ? fallback : value) as T });
    assert.strictEqual(read(undefined), 'status');
    assert.strictEqual(read('Stage'), 'stage', 'tags are matched lowercased, so it is written lowercased');
    assert.strictEqual(read('  phase_2 '), 'phase_2');
    for (const value of ['', '  ', '#status', 'two words', '9lives', null, ['stage'], 7]) {
      assert.strictEqual(read(value), 'status', JSON.stringify(value));
    }
  });
});

function createIndex(tasks: Task[]): WorkspaceIndex {
  return {
    files: new Map(),
    sections: new Map(),
    tasks: new Map(tasks.map((task) => [task.id, task])),
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createTask(values: Partial<Task> & { id: string }): Task {
  return {
    filePath: 'notes/tasks.md',
    title: values.id,
    completed: false,
    tags: [],
    tagLabels: {},
    lineNumber: 1,
    checkboxColumn: 3,
    status: { symbol: ' ', name: 'Todo', type: 'todo' },
    sourceLineText: '- [ ] task',
    ...values,
  };
}
