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
