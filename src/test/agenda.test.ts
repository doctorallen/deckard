import * as assert from 'assert';

import { Task, WorkspaceIndex } from '../core/types';
import { createAgenda } from '../ui/state/agendaState';

const at = (month: number, day: number): number =>
  new Date(2026, month - 1, day).getTime();

/** Mid-morning on Sunday 2026-09-13. */
const now = at(9, 13) + 10 * 60 * 60 * 1000;

suite('Agenda', () => {
  test('groups open tasks into overdue, today, and upcoming', () => {
    const groups = createAgenda(
      createIndex([
        createTask({ id: 'overdue', dueAt: at(9, 10) }),
        createTask({ id: 'due-today', dueAt: at(9, 13), priority: 'low' }),
        createTask({ id: 'scheduled', scheduledAt: at(9, 11), priority: 'high' }),
        createTask({ id: 'not-started', scheduledAt: at(9, 12), startAt: at(9, 15) }),
        createTask({ id: 'upcoming', dueAt: at(9, 18) }),
        createTask({ id: 'too-far', dueAt: at(9, 30) }),
        createTask({ id: 'done', dueAt: at(9, 10), completed: true }),
        createTask({ id: 'undated' }),
      ]),
      now,
      7,
    );

    assert.deepStrictEqual(
      groups.map((group) => [group.id, group.entries.map((entry) => entry.task.id)]),
      [
        ['overdue', ['overdue']],
        // Today puts the more important task first.
        ['today', ['scheduled', 'due-today']],
        ['upcoming', ['not-started', 'upcoming']],
      ],
    );
    assert.deepStrictEqual(groups[1].entries[0].details, [
      'scheduled Fri 2026-09-11',
      'high priority',
      'tasks.md',
    ]);
    assert.deepStrictEqual(groups[2].entries[0].details, [
      'starts Tue 2026-09-15',
      'tasks.md',
    ]);
  });

  test('says which open task blocks another', () => {
    const groups = createAgenda(
      createIndex([
        createTask({ id: 'first', dependencyId: 'a1' }),
        createTask({ id: 'second', dueAt: at(9, 13), dependsOn: ['a1'] }),
      ]),
      now,
      7,
    );
    assert.deepStrictEqual(groups[0].entries[0].details, [
      'due today',
      'blocked by a1',
      'tasks.md',
    ]);
  });

  test('is empty when no open task has a date in range', () => {
    assert.deepStrictEqual(
      createAgenda(createIndex([createTask({ id: 'undated' })]), now, 7),
      [],
    );
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
