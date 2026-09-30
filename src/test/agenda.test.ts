import * as assert from 'assert';

import { Task, WorkspaceIndex } from '../core/types';
import {
  createAgenda,
  normalizeAgendaQuery,
  selectAgendaTasks,
} from '../ui/state/agendaState';
import * as vscode from 'vscode';

import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { createTaskGlance } from '../ui/state/dashboardState';
import { AgendaNode, AgendaTreeProvider, groupColumnId, OVERDUE_ROWS } from '../ui/views/agendaTree';
import { createQueryContext } from '../domain/query/queryContext';
import { createTaskWrites } from './taskWrites';

const at = (month: number, day: number): number =>
  new Date(2026, month - 1, day).getTime();

/** Mid-morning on Sunday 2026-09-13. */
const now = at(9, 13) + 10 * 60 * 60 * 1000;

suite('Agenda', () => {
  test('lists the most recently slipped overdue task first, with ranks still leading', () => {
    const groups = createAgenda(
      createIndex([
        createTask({ id: 'week-ago', dueAt: at(9, 6) }),
        createTask({ id: 'yesterday', dueAt: at(9, 12) }),
        createTask({ id: 'ranked', dueAt: at(9, 1) }),
        createTask({ id: 'three-days', dueAt: at(9, 10) }),
      ]),
      createQueryContext(now),
      { upcomingDays: 7, taskOrder: ['ranked'] },
    );
    assert.deepStrictEqual(
      groups[0].entries.map((entry) => entry.task.id),
      ['ranked', 'yesterday', 'three-days', 'week-ago'],
    );
  });

  test('is:today finds exactly the Today group, and the tiles count as the Tasks view does', () => {
    const index = createIndex([
      createTask({ id: 'overdue', dueAt: at(9, 10) }),
      createTask({ id: 'due-today', dueAt: at(9, 13) }),
      createTask({ id: 'scheduled', scheduledAt: at(9, 11) }),
      createTask({ id: 'not-started', scheduledAt: at(9, 12), startAt: at(9, 15) }),
      createTask({ id: 'late-but-scheduled', dueAt: at(9, 12), scheduledAt: at(9, 13) }),
      createTask({ id: 'upcoming', dueAt: at(9, 18) }),
      createTask({ id: 'done', dueAt: at(9, 13), completed: true }),
    ]);
    const today = createAgenda(index, createQueryContext(now), { upcomingDays: 7 })
      .find((group) => group.id === 'today')
      ?.entries.map((entry) => entry.task.id)
      .sort();
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const matched = evaluateQuery(index, parseQuery('is:today').node, createQueryContext(Date.now())).tasks.map((task) => task.id).sort();
      assert.deepStrictEqual(matched, today);
      const glance = createTaskGlance(index, '', createQueryContext(now));
      assert.deepStrictEqual(
        [glance.overdue, glance.today, glance.open],
        [2, 2, 6],
      );
      assert.strictEqual(
        createTaskGlance(index, '#project/atlas', createQueryContext(now)).todayQuery,
        '(#project/atlas) AND is:today',
        'scoped by the agenda search, so the tile and its page agree',
      );
    } finally {
      Date.now = realNow;
    }
  });

  test('splits Upcoming into a group per day when asked', () => {
    const index = createIndex([
      createTask({ id: 'tomorrow', dueAt: at(9, 14) }),
      createTask({ id: 'monday', dueAt: at(9, 14) + 0, scheduledAt: undefined, lineNumber: 2 }),
      createTask({ id: 'thursday', dueAt: at(9, 17) }),
      createTask({ id: 'starts', startAt: at(9, 17), lineNumber: 3 }),
    ]);
    const byDay = createAgenda(index, createQueryContext(now), { upcomingDays: 7, upcomingByDay: true });
    assert.deepStrictEqual(
      byDay.map((group) => [group.id, group.label, group.entries.map((entry) => entry.task.id)]),
      [
        ['upcoming:2026-09-14', 'Tomorrow', ['tomorrow', 'monday']],
        ['upcoming:2026-09-17', 'Thu Sep 17', ['thursday', 'starts']],
      ],
    );
    assert.deepStrictEqual(
      createAgenda(index, createQueryContext(now), { upcomingDays: 7 }).map((group) => group.id),
      ['upcoming'],
      'one Upcoming unless asked',
    );
    assert.strictEqual(groupColumnId('upcoming:2026-09-17', 'due'), 'due:2026-09-17');
  });

  test('ends with what was done today, when asked, whatever the grouping', () => {
    const index = createIndex([
      createTask({ id: 'open', dueAt: at(9, 13) }),
      createTask({ id: 'done-today', completed: true, doneAt: at(9, 13), lineNumber: 2 }),
      createTask({ id: 'done-later-line', completed: true, doneAt: at(9, 13), lineNumber: 5 }),
      createTask({ id: 'done-yesterday', completed: true, doneAt: at(9, 12) }),
      createTask({ id: 'done-undated', completed: true }),
    ]);
    const ids = (groups: ReturnType<typeof createAgenda>) =>
      groups.map((group) => [group.id, group.entries.map((entry) => entry.task.id)]);
    assert.deepStrictEqual(ids(createAgenda(index, createQueryContext(now), { upcomingDays: 7, doneToday: true })), [
      ['today', ['open']],
      ['donetoday', ['done-later-line', 'done-today']],
    ]);
    assert.deepStrictEqual(
      ids(createAgenda(index, createQueryContext(now), { upcomingDays: 7, doneToday: true, groupBy: 'priority' })).pop(),
      ['donetoday', ['done-later-line', 'done-today']],
    );
    assert.deepStrictEqual(ids(createAgenda(index, createQueryContext(now), { upcomingDays: 7 })), [['today', ['open']]]);
    assert.strictEqual(groupColumnId('donetoday', 'due'), 'done', 'a task dropped there is completed');
  });

  test('the Tasks view draws five overdue tasks, then Show N more, and acts on all', async () => {
    // Counted back from today, as the view counts: from a fixed date, the
    // oldest slipped past 30 days and into Needs a new date as time went on.
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
    const tasks = Array.from({ length: 17 }, (_, day) =>
      createTask({ id: `late-${day}`, dueAt: yesterday - day * 24 * 60 * 60 * 1000 }),
    );
    const index = createIndex(tasks);
    const updates = new vscode.EventEmitter<WorkspaceIndex>();
    const provider = new AgendaTreeProvider(
      {
        onDidUpdate: updates.event,
        getTask: (taskId) => index.tasks.get(taskId),
      },
      createTaskWrites(),
    );
    try {
      updates.fire(index);
      const [overdue] = await provider.getChildren();
      assert.strictEqual(overdue.kind, 'group');
      const rows = await provider.getChildren(overdue);
      assert.strictEqual(rows.length, OVERDUE_ROWS + 1);
      const more = rows[rows.length - 1] as Extract<AgendaNode, { kind: 'more' }>;
      assert.strictEqual(more.kind, 'more');
      assert.strictEqual(provider.getTreeItem(more).label, 'Show 12 more');
      assert.strictEqual(provider.getTreeItem(more).command?.command, 'deckard.agenda.showMore');
      assert.strictEqual(provider.getTreeItem(overdue).description, '17', 'the group still counts all');
      assert.strictEqual(provider.tasksFor(overdue).length, 17, 'Reschedule All covers every one');
      assert.deepStrictEqual(provider.tasksFor(more), []);

      provider.showMore('overdue');
      const [again] = await provider.getChildren();
      assert.strictEqual((await provider.getChildren(again)).length, 17);
    } finally {
      provider.dispose();
      updates.dispose();
    }
  });

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
      createQueryContext(now),
      { upcomingDays: 7 },
    );

    assert.deepStrictEqual(
      groups.map((group) => [group.id, group.entries.map((entry) => entry.task.id)]),
      [
        ['overdue', ['overdue']],
        // Today puts the more important task first.
        ['today', ['scheduled', 'due-today']],
        ['upcoming', ['not-started', 'upcoming']],
        // Past the horizon is still a date; no date at all comes last.
        ['later', ['too-far']],
        ['nodate', ['undated']],
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
      createQueryContext(now),
      { upcomingDays: 7 },
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
      createAgenda(index, createQueryContext(now), { upcomingDays: 7, groupBy }).map((group) => [
        group.label,
        group.entries.map((entry) => entry.task.id),
      ]);

    assert.deepStrictEqual(
      grouped('priority'),
      [
        ['⏫ High', ['overdue']],
        ['No priority', ['due-today', 'upcoming', 'undated']],
      ],
      'a group is marked the way its tasks are, and the unmarked one is last',
    );
    assert.deepStrictEqual(grouped('status'), [
      // The busiest group first, and the tasks carrying no status last.
      ['Doing', ['due-today']],
      ['No status', ['overdue', 'upcoming', 'undated']],
    ]);
    assert.deepStrictEqual(grouped('assignee'), [
      ['@dana', ['due-today', 'upcoming']],
      ['Nobody named', ['overdue', 'undated']],
    ]);
  });

  test('puts the tasks a reader ranked at the top of their group', () => {
    const index = createIndex([
      createTask({ id: 'first-due', dueAt: at(9, 14) }),
      createTask({ id: 'later', dueAt: at(9, 16) }),
      createTask({ id: 'last-due', dueAt: at(9, 18) }),
    ]);
    assert.deepStrictEqual(
      createAgenda(index, createQueryContext(now), { upcomingDays: 7 })[0].entries.map((entry) => entry.task.id),
      ['first-due', 'later', 'last-due'],
      'by date until a reader says otherwise',
    );
    assert.deepStrictEqual(
      createAgenda(index, createQueryContext(now), { upcomingDays: 7, taskOrder: ['last-due', 'later'] })[0]
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

  test('is empty when every task is done', () => {
    assert.deepStrictEqual(
      createAgenda(
        createIndex([createTask({ id: 'done', completed: true })]),
        createQueryContext(now),
        { upcomingDays: 7 },
      ),
      [],
    );
  });

  test('keeps a search the way the view reads it', () => {
    assert.strictEqual(normalizeAgendaQuery('is:open'), '', 'the board opens on what the view always means');
    assert.strictEqual(normalizeAgendaQuery('  is:open AND is:mine '), 'is:mine');
    assert.strictEqual(normalizeAgendaQuery('is:mine AND is:open'), 'is:mine AND is:open', 'only the leading one is implied');
    assert.strictEqual(normalizeAgendaQuery('#project/atlas'), '#project/atlas');
  });

  test('lists the tasks it is given, and no others', () => {
    const index = createIndex([
      createTask({ id: 'mine', dueAt: at(9, 13), assignee: '@dana' }),
      createTask({ id: 'theirs', dueAt: at(9, 13), assignee: '@ren-kade' }),
      createTask({ id: 'nobodys' }),
    ]);
    const ids = (query: string) =>
      createAgenda(index, createQueryContext(now), {
        tasks: selectAgendaTasks(index, query, createQueryContext(Date.now())).tasks,
        upcomingDays: 7,
      }).flatMap((group) => group.entries.map((entry) => entry.task.id));
    assert.deepStrictEqual(ids(''), ['mine', 'theirs', 'nobodys'], 'empty is everything');
    assert.deepStrictEqual(ids('assignee = @dana'), ['mine']);
    assert.deepStrictEqual(
      ids('has:due OR has:scheduled OR has:start'),
      ['mine', 'theirs'],
      'the query is how the undated ones are left out',
    );
    const broken = selectAgendaTasks(index, 'due >', createQueryContext(Date.now()));
    assert.strictEqual(broken.tasks.length, 3, 'a query that does not parse hides nothing');
    assert.ok(broken.error, 'and says why');
  });

  test('ends with the undated tasks, a to-do list of their own', () => {
    const groups = createAgenda(
      createIndex([
        createTask({ id: 'due-today', dueAt: at(9, 13) }),
        createTask({ id: 'undated' }),
        createTask({ id: 'undated-important', priority: 'high' }),
        createTask({ id: 'undated-done', completed: true }),
        createTask({ id: 'too-far', dueAt: at(9, 30) }),
        createTask({ id: 'waiting', scheduledAt: at(9, 1), startAt: at(10, 15) }),
      ]),
      createQueryContext(now),
      { upcomingDays: 7 },
    );

    assert.deepStrictEqual(
      groups.map((group) => [
        group.label,
        group.entries.map((entry) => entry.task.id),
      ]),
      [
        ['Today', ['due-today']],
        // Past the horizon, by the date each waits for: the one not started
        // until October is placed by its start, not the schedule it missed.
        ['Later', ['too-far', 'waiting']],
        // Last, and a to-do list within itself: what was marked leads.
        ['No date', ['undated-important', 'undated']],
      ],
    );
    assert.deepStrictEqual(groups[1].entries[1].details, [
      'starts Thu 2026-10-15',
      'tasks.md',
    ]);
    assert.deepStrictEqual(
      groups[2].entries[1].details,
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
      createAgenda(index, createQueryContext(now), { upcomingDays: 7, groupBy: 'assignee' }).map(
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
