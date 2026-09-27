import * as assert from 'assert';

import {
  getTaskPolicy,
  needsNewDate,
  readLineStatus,
  setTaskPolicy,
} from '../core/taskPolicy';
import { Task, WorkspaceIndex } from '../core/types';
import { createAgenda } from '../ui/state/agendaState';

const at = (month: number, day: number): number => new Date(2026, month - 1, day).getTime();
/** Mid-morning on Friday 2026-09-25. */
const now = at(9, 25) + 10 * 60 * 60 * 1000;

suite('Task policy', () => {
  teardown(() => setTaskPolicy());

  test('a task 30 days overdue is Overdue, and at 31 it needs a new date', () => {
    assert.strictEqual(getTaskPolicy().needsNewDateAfterDays, 30, 'the setting default');
    assert.strictEqual(needsNewDate(at(8, 26), now), false, '30 days');
    assert.strictEqual(needsNewDate(at(8, 25), now), true, '31 days');
    assert.strictEqual(needsNewDate(undefined, now), false);
    setTaskPolicy({ needsNewDateAfterDays: 0 });
    assert.strictEqual(needsNewDate(at(1, 1), now), false, '0 keeps every overdue task in Overdue');
  });

  test('the Tasks view folds what needs a new date last, and 0 draws it as before', () => {
    const index = createIndex([
      createTask({ id: 'recent', dueAt: at(9, 20) }),
      createTask({ id: 'thirty', dueAt: at(8, 26) }),
      createTask({ id: 'old', dueAt: at(7, 1) }),
      createTask({ id: 'undated' }),
    ]);
    const groups = createAgenda(index, now, { upcomingDays: 7 });
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

    setTaskPolicy({ needsNewDateAfterDays: 0 });
    assert.deepStrictEqual(
      createAgenda(index, now, { upcomingDays: 7 }).map((group) => group.id),
      ['overdue', 'nodate'],
    );
  });

  test('reads the status written on the task line, in the namespace set', () => {
    const task = createTask({
      id: 'a',
      associationTagGroups: [[{ key: '#status/waiting', label: '#status/waiting' } as never]],
    });
    assert.strictEqual(readLineStatus(task), 'waiting');
    setTaskPolicy({ statusNamespace: 'state' });
    assert.strictEqual(readLineStatus(task), '');
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
    checkboxValue: ' ',
    sourceLineText: '- [ ] task',
    ...values,
  };
}
