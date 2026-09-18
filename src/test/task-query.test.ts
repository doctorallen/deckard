import * as assert from 'assert';

import { evaluateQuery } from '../core/query/queryEvaluator';
import { parseQuery } from '../core/query/queryParser';
import { Section, Task, WorkspaceIndex } from '../core/types';

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
    const results = evaluateQuery(index, parsed.node);
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
    return evaluateQuery(index, parsed.node)
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
    startLine: 1,
    endLine: 2,
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
