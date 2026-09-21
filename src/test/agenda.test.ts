import * as assert from 'assert';

import { Task, WorkspaceIndex } from '../core/types';
import { createAgenda } from '../ui/state/agendaState';
import { groupColumnId } from '../ui/views/agendaTree';

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

  test('groups by priority, status, or person, over the same tasks', () => {
    const index = createIndex([
      createTask({ id: 'overdue', dueAt: at(9, 10), priority: 'high' }),
      createTask({
        id: 'due-today',
        dueAt: at(9, 13),
        assignee: '@dana',
        associationTagGroups: [[{ key: '#status/doing', label: '#status/doing' }]],
      }),
      createTask({ id: 'upcoming', dueAt: at(9, 18), assignee: '@dana' }),
      createTask({ id: 'undated' }),
    ]);
    const grouped = (groupBy: 'priority' | 'status' | 'assignee') =>
      createAgenda(index, now, 7, groupBy).map((group) => [
        group.label,
        group.entries.map((entry) => entry.task.id),
      ]);

    assert.deepStrictEqual(
      grouped('priority'),
      [
        ['⏫ High', ['overdue']],
        ['No priority', ['due-today', 'upcoming']],
      ],
      'a group is marked the way its tasks are, and the unmarked one is last',
    );
    assert.deepStrictEqual(grouped('status'), [
      // The busiest group first, and the tasks carrying no status last.
      ['Doing', ['due-today']],
      ['No status', ['overdue', 'upcoming']],
    ]);
    assert.deepStrictEqual(grouped('assignee'), [
      ['@dana', ['due-today', 'upcoming']],
      ['Nobody named', ['overdue']],
    ]);
  });

  test('puts the tasks a reader ranked at the top of their group', () => {
    const index = createIndex([
      createTask({ id: 'first-due', dueAt: at(9, 14) }),
      createTask({ id: 'later', dueAt: at(9, 16) }),
      createTask({ id: 'last-due', dueAt: at(9, 18) }),
    ]);
    assert.deepStrictEqual(
      createAgenda(index, now, 7)[0].entries.map((entry) => entry.task.id),
      ['first-due', 'later', 'last-due'],
      'by date until a reader says otherwise',
    );
    assert.deepStrictEqual(
      createAgenda(index, now, 7, 'due', 'status', ['last-due', 'later'])[0]
        .entries.map((entry) => entry.task.id),
      ['last-due', 'later', 'first-due'],
      'the ranked ones lead, and the rest keep their own order',
    );
  });

  test('knows which groups a dropped task can join', () => {
    assert.strictEqual(groupColumnId('priority:high', 'priority'), 'priority:high');
    assert.strictEqual(groupColumnId('priority:none', 'priority'), 'priority:');
    assert.strictEqual(groupColumnId('doing', 'status'), 'status:doing');
    assert.strictEqual(groupColumnId('none', 'status'), 'status:');
    assert.strictEqual(groupColumnId('today', 'due'), 'due:today');
    // Overdue and Upcoming cover a range of days, so neither names one edit.
    assert.strictEqual(groupColumnId('overdue', 'due'), undefined);
    assert.strictEqual(groupColumnId('upcoming', 'due'), undefined);
    // No date means three dates cleared, which is not one edit either.
    assert.strictEqual(groupColumnId('nodate', 'due'), undefined);
    assert.strictEqual(
      groupColumnId('@dana', 'assignee'),
      'assignee:@dana',
      'a person group is the board column that writes the 👤 field',
    );
    assert.strictEqual(groupColumnId('none', 'assignee'), 'assignee:');
  });

  test('is empty when no open task has a date in range', () => {
    assert.deepStrictEqual(
      createAgenda(createIndex([createTask({ id: 'undated' })]), now, 7),
      [],
    );
  });

  test('ends with the undated tasks when they are asked for', () => {
    const groups = createAgenda(
      createIndex([
        createTask({ id: 'due-today', dueAt: at(9, 13) }),
        createTask({ id: 'undated' }),
        createTask({ id: 'undated-important', priority: 'high' }),
        createTask({ id: 'undated-done', completed: true }),
        createTask({ id: 'too-far', dueAt: at(9, 30) }),
      ]),
      now,
      7,
      'due',
      'status',
      [],
      true,
    );

    assert.deepStrictEqual(
      groups.map((group) => [
        group.label,
        group.entries.map((entry) => entry.task.id),
      ]),
      [
        ['Today', ['due-today']],
        // Last, and a to-do list within itself: what was marked leads. A
        // dated task out past the horizon is still the horizon's business.
        ['No date', ['undated-important', 'undated']],
      ],
    );
    assert.deepStrictEqual(
      groups[1].entries[1].details,
      ['tasks.md'],
      'no date to read means no date said',
    );
  });

  test('carries the undated tasks into the other groupings', () => {
    const index = createIndex([
      createTask({ id: 'due-today', dueAt: at(9, 13), assignee: '@dana' }),
      createTask({ id: 'undated', assignee: '@dana' }),
    ]);
    assert.deepStrictEqual(
      createAgenda(index, now, 7, 'assignee', 'status', [], true).map(
        (group) => [group.label, group.entries.map((entry) => entry.task.id)],
      ),
      [['@dana', ['due-today', 'undated']]],
      'the undated task follows the dated ones inside its group',
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
