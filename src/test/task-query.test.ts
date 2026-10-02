import * as assert from 'assert';

import { createQueryContext, QueryContextSettings } from '../domain/query/queryContext';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { Section, Task, WorkspaceIndex } from '../domain/model';

/** Local midnight `days` from today, so relative windows stay meaningful. */
function inDays(days: number): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

suite('Task metadata queries', () => {
  const index = createIndex();
  const matches = (query: string): string[] => {
    const parsed = parseQuery(query);
    assert.deepStrictEqual(
      parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      [],
      query,
    );
    const results = evaluateQuery(index, parsed.node, createQueryContext(Date.now()));
    return [
      ...results.tasks.map((task) => task.id),
      ...results.sections.map((section) => section.id),
    ].sort();
  };

  test('finds tasks by due date', () => {
    assert.deepStrictEqual(matches('due < today'), ['late']);
    assert.deepStrictEqual(matches('due = today'), ['today']);
    assert.deepStrictEqual(matches('due = 7d'), ['soon', 'today']);
    assert.deepStrictEqual(matches('due > 7d'), ['later']);
    assert.deepStrictEqual(matches('due = none'), ['undated']);
    assert.deepStrictEqual(matches('due != none'), [
      'late',
      'later',
      'soon',
      'today',
    ]);
  });

  test('is:needs-date finds only what is past the line, and is:overdue still finds it', () => {
    index.tasks.set(
      'stale',
      createTask({ id: 'stale', dueAt: inDays(-45) }),
    );
    try {
      assert.deepStrictEqual(matches('is:needs-date'), ['stale']);
      assert.deepStrictEqual(matches('is:needsdate'), ['stale']);
      assert.deepStrictEqual(matches('is:overdue'), ['late', 'stale']);
    } finally {
      index.tasks.delete('stale');
    }
  });

  test('is:waiting means waiting on someone, and is:available what can start now', () => {
    const extra = [
      createTask({
        id: 'marked-waiting',
        associationTagGroups: [[{ key: '#status/waiting' } as never]],
      }),
      createTask({ id: 'for-dana', assignee: '#person/dana' }),
      createTask({
        id: 'someday',
        associationTagGroups: [[{ key: '#status/someday' } as never]],
      }),
      createTask({ id: 'not-started', startAt: inDays(4) }),
      createTask({ id: 'started', startAt: inDays(0) }),
      createTask({ id: 'blocked', dependsOn: ['x1'] }),
      createTask({ id: 'blocker', dependencyId: 'x1' }),
      createTask({ id: 'finished', completed: true, assignee: '#person/dana' }),
    ];
    // A new index, since what blocks what is worked out once per index.
    const local: WorkspaceIndex = {
      ...index,
      tasks: new Map([...index.tasks, ...extra.map((task): [string, Task] => [task.id, task])]),
    };
    const matches = (query: string, settings: QueryContextSettings = {}): string[] => {
      const parsed = parseQuery(query);
      assert.deepStrictEqual(parsed.diagnostics, [], query);
      const results = evaluateQuery(local, parsed.node, createQueryContext(Date.now(), settings));
      return [
        ...results.tasks.map((task) => task.id),
        ...results.sections.map((section) => section.id),
      ].sort();
    };
    assert.deepStrictEqual(matches('is:waiting'), ['for-dana', 'marked-waiting']);
    assert.notDeepStrictEqual(matches('is:waiting'), matches('is:blocked'), 'no longer a second is:blocked');
    assert.deepStrictEqual(matches('is:blocked'), ['blocked']);
    assert.deepStrictEqual(matches('is:available'), [
      'blocker', 'for-dana', 'late', 'later', 'soon', 'started', 'today', 'undated',
    ]);
    assert.deepStrictEqual(matches('is:actionable'), matches('is:available'));
    assert.deepStrictEqual(
      matches('is:waiting', { identity: '@dana' }),
      ['marked-waiting'],
      'what is for me is not waiting on anyone',
    );
    assert.ok(
      matches('is:available', { identity: '@dana', taskPolicy: { onHoldStatuses: ['waiting'] } }).includes('someday'),
      'the statuses on hold come from the setting',
    );
  });

  test('finds tasks by scheduled date and priority', () => {
    assert.deepStrictEqual(matches('scheduled <= today'), ['undated']);
    assert.deepStrictEqual(matches('priority > medium'), ['soon', 'undated']);
    assert.deepStrictEqual(matches('priority = none'), ['late']);
    assert.deepStrictEqual(matches('priority <= low'), ['later']);
  });

  test('never lists notes for a task-only condition', () => {
    assert.deepStrictEqual(matches('due != today'), ['late', 'later', 'soon']);
  });

  test('compares a relative window by its far end', () => {
    assert.deepStrictEqual(matches('updated > 7d'), ['recent']);
    assert.deepStrictEqual(matches('updated < 7d'), ['old']);
  });

  test('explains values a task field cannot take', () => {
    const messages = (query: string): string[] =>
      parseQuery(query).diagnostics.map((diagnostic) => diagnostic.message);
    assert.match(messages('priority = urgent')[0] ?? '', /priority accepts/);
    assert.match(messages('due > none')[0] ?? '', /none/);
    assert.match(messages('due = someday')[0] ?? '', /due accepts/);
  });
});

suite('Task dependency queries', () => {
  const index = createDependencyIndex();
  const matches = (query: string): string[] => {
    const parsed = parseQuery(query);
    assert.deepStrictEqual(
      parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
      [],
      query,
    );
    return evaluateQuery(index, parsed.node, createQueryContext(Date.now()))
      .tasks.map((task) => task.id)
      .sort();
  };

  test('finds the tasks an open task is waiting for', () => {
    assert.deepStrictEqual(matches('is:blocked'), ['waiting']);
    assert.deepStrictEqual(matches('is:blocking'), ['blocker']);
  });

  test('a finished blocker frees the task that waited for it', () => {
    assert.deepStrictEqual(matches('is:blocked is:open'), ['waiting']);
    assert.ok(!matches('is:blocked').includes('released'));
    assert.ok(!matches('is:blocking').includes('finished'));
  });

  test('a completed task neither blocks nor is blocked', () => {
    assert.ok(!matches('is:blocked').includes('done-waiting'));
  });

  test('reads the markers themselves apart from the edges between them', () => {
    assert.deepStrictEqual(matches('has:id'), [
      'blocker',
      'finished',
      'orphan',
    ]);
    assert.deepStrictEqual(matches('has:dependsOn'), [
      'done-waiting',
      'released',
      'stale',
      'waiting',
    ]);
    assert.deepStrictEqual(matches('no:dependsOn'), [
      'blocker',
      'finished',
      'orphan',
      'plain',
    ]);
  });

  test('a ⛔ naming nothing in the workspace blocks nobody', () => {
    assert.ok(!matches('is:blocked').includes('stale'));
  });

  test('combines with the rest of the language', () => {
    assert.deepStrictEqual(matches('is:blocking OR is:blocked'), [
      'blocker',
      'waiting',
    ]);
    assert.deepStrictEqual(matches('-is:blocked has:dependsOn'), [
      'done-waiting',
      'released',
      'stale',
    ]);
  });

  test('explains a value the dependency shorthands cannot take', () => {
    const messages = (query: string): string[] =>
      parseQuery(query).diagnostics.map((diagnostic) => diagnostic.message);
    assert.match(messages('is:stuck')[0] ?? '', /blocked/);
    assert.match(messages('has:blocker')[0] ?? '', /dependsOn/);
  });
});

function createDependencyIndex(): WorkspaceIndex {
  const tasks: Task[] = [
    // An open pair: `waiting` cannot start until `blocker` is done.
    createTask({ id: 'blocker', dependencyId: 'b1' }),
    createTask({ id: 'waiting', dependsOn: ['b1'] }),
    // The same pair once the blocker is done.
    createTask({ id: 'finished', dependencyId: 'f1', completed: true }),
    createTask({ id: 'released', dependsOn: ['f1'] }),
    // A completed task waiting on an open one is nobody's problem.
    createTask({ id: 'done-waiting', dependsOn: ['b1'], completed: true }),
    // A ⛔ whose name no task in the workspace carries.
    createTask({ id: 'stale', dependsOn: ['gone'] }),
    // A 🆔 no task waits for.
    createTask({ id: 'orphan', dependencyId: 'o1' }),
    createTask({ id: 'plain' }),
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

function createIndex(): WorkspaceIndex {
  const tasks: Task[] = [
    createTask({ id: 'late', dueAt: inDays(-3) }),
    createTask({ id: 'today', dueAt: inDays(0), priority: 'medium' }),
    createTask({ id: 'soon', dueAt: inDays(3), priority: 'high' }),
    createTask({ id: 'later', dueAt: inDays(20), priority: 'low' }),
    createTask({
      id: 'undated',
      scheduledAt: inDays(0),
      priority: 'highest',
    }),
  ];
  const sections: Section[] = [
    createSection({ id: 'recent', updatedAt: inDays(-2) }),
    createSection({ id: 'old', updatedAt: inDays(-30) }),
  ];
  return {
    files: new Map(),
    sections: new Map(sections.map((section) => [section.id, section])),
    tasks: new Map(tasks.map((task) => [task.id, task])),
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createSection(values: Partial<Section> & { id: string }): Section {
  return {
    filePath: 'notes/note.md',
    heading: 'Note',
    headingLevel: 2,
    tags: [],
    tagLabels: {},
    links: [],
    rawContent: '',
    bodyContent: '',
    startLine: 1,
    endLine: 2,
    bodyEndLine: 2,
    ...values,
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
