import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { parseMarkdown } from '../domain/markdown/parser';
import { isTaskLineOf, STATUS_MARKS, STATUS_OR_MIGRATED_MARKS } from '../domain/markdown/lineShapes';
import {
  countTaskProgress,
  DEFAULT_TASK_STATUSES,
  nameTaskStatus,
  readTaskStatus,
  readTaskStatuses,
  readTaskStatusSettings,
  statusForSymbol,
  type TaskStatusDefinition,
} from '../domain/tasks/taskStatuses';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { buildSearchFacets } from '../domain/search/facets';
import { nextStatus, readLineStatus, setTaskStatus, type StatusWriteMode } from '../domain/tasks/statusWrites';
import { toggleTaskLines } from '../domain/tasks/toggleLines';
import { isClosedTaskLine } from '../domain/markdown/taskSteps';

/** Each task's character, name, type, and whether it is done, as the parser read it. */
function read(content: string, taskStatuses?: readonly TaskStatusDefinition[]): string[] {
  return parseMarkdown('note.md', content, undefined, { taskStatuses }).tasks.map(
    (task) => `[${task.status.symbol}] ${task.status.name} ${task.status.type}${task.completed ? ' completed' : ''}`,
  );
}

suite('Task statuses: the list', () => {
  test('reads as Deckard\'s own when the setting names none', () => {
    assert.deepStrictEqual(readTaskStatuses(undefined), DEFAULT_TASK_STATUSES);
    assert.deepStrictEqual(readTaskStatuses([]), DEFAULT_TASK_STATUSES);
    assert.deepStrictEqual(readTaskStatuses('not a list'), DEFAULT_TASK_STATUSES);
  });

  test('are the defaults deckard.tasks.statuses shows in Settings', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      contributes: { configuration: Array<{ properties: Record<string, { default?: unknown }> }> };
    };
    const setting = manifest.contributes.configuration.find((section) => section.properties['deckard.tasks.statuses']);
    assert.deepStrictEqual(setting?.properties['deckard.tasks.statuses'].default, DEFAULT_TASK_STATUSES);
  });

  test('always has Todo and Done, their types fixed, and keeps X as Done', () => {
    const statuses = readTaskStatuses([
      { symbol: '/', name: 'Doing', type: 'inProgress' },
      { symbol: ' ', name: 'Open', type: 'done' },
    ]);
    assert.deepStrictEqual(
      statuses.map((status) => `${status.symbol}:${status.name}:${status.type}`),
      ['/:Doing:inProgress', ' :Open:todo', 'x:Done:done', 'X:Done:done'],
    );
  });

  test('leaves out what can\'t be a status, and reads a character or a tag given twice as the first', () => {
    const statuses = readTaskStatuses([
      { symbol: '?', name: 'Question', type: 'todo' },
      { symbol: '?', name: 'Second', type: 'done' },
      { symbol: '>', name: 'Migrated', type: 'todo' },
      { symbol: ']', name: 'Close', type: 'todo' },
      { symbol: 'ab', name: 'Two', type: 'todo' },
      { symbol: '!', name: '', type: 'todo' },
      { symbol: '!', name: 'Bad type', type: 'urgent' },
      { name: 'No symbol or tag', type: 'onHold' },
      { name: 'Waiting', type: 'onHold', tag: '#Waiting' },
      { name: 'Paused', type: 'onHold', tag: 'waiting' },
      'Blocked',
    ]);
    assert.deepStrictEqual(statuses.map((status) => status.name), ['Todo', 'Question', 'Waiting', 'Done', 'Done']);
    assert.strictEqual(statuses[2].tag, 'waiting');
  });

  test('reads deckard.tasks.onHoldStatuses as on-hold statuses no status stands for', () => {
    const statuses = readTaskStatuses(undefined, ['waiting', 'on-call', 'not a tag!']);
    assert.deepStrictEqual(statuses.at(-1), { name: 'On call', type: 'onHold', tag: 'on-call' });
    assert.strictEqual(statuses.filter((status) => status.tag === 'waiting').length, 1);
    const settings = new Map<string, unknown>([['tasks.statuses', [{ symbol: '/', name: 'Doing', type: 'inProgress' }]]]);
    assert.deepStrictEqual(
      readTaskStatusSettings({ get: <T>(key: string) => settings.get(key) as T | undefined }).map((status) => status.name),
      ['Todo', 'Doing', 'Done', 'Done'],
    );
  });

  test('a character no status names is an Unknown to do', () => {
    assert.deepStrictEqual(statusForSymbol(DEFAULT_TASK_STATUSES, '?'), { symbol: '?', name: 'Unknown', type: 'todo' });
    assert.deepStrictEqual(statusForSymbol(DEFAULT_TASK_STATUSES, '='), { symbol: '=', name: 'Blocked', type: 'onHold' });
  });
});

suite('Task statuses: reading a note', () => {
  test('every default character is a task of its status', () => {
    assert.deepStrictEqual(read(['- [ ] a', '- [/] b', '- [x] c', '- [X] d', '- [-] e', '- [=] f'].join('\n')), [
      '[ ] Todo todo',
      '[/] In progress inProgress',
      '[x] Done done completed',
      '[X] Done done completed',
      '[-] Cancelled cancelled',
      '[=] Blocked onHold',
    ]);
  });

  test('an unknown character is a task to do; [>], a fenced box, and a link are not tasks', () => {
    const content = [
      '- [?] Ask about swag',
      '- [>] Moved to Friday',
      '- [/]no gap',
      '- [a](https://example.com) a link',
      '```',
      '- [/] An example in code',
      '```',
    ].join('\n');
    assert.deepStrictEqual(read(content), ['[?] Unknown todo']);
  });

  test('a nonTask character stays text, counted as a checkbox line', () => {
    const statuses = readTaskStatuses([{ symbol: 'P', name: 'Pro', type: 'nonTask' }]);
    const file = parseMarkdown('note.md', '- [P] Fast #idea\n- [ ] Ship it\n', undefined, { taskStatuses: statuses });
    assert.deepStrictEqual(file.tasks.map((task) => task.title), ['Ship it']);
    assert.strictEqual(file.otherCheckboxes, 1);
    assert.ok(file.sections.some((section) => section.tags.includes('#idea')), 'the line is a tagged entry');
    assert.strictEqual(parseMarkdown('note.md', '- [/] Doing\n').otherCheckboxes, undefined);
  });

  test('a ❌ date is the cancelled date', () => {
    const [task] = parseMarkdown('note.md', '- [-] Order the banner ❌ 2026-10-02\n').tasks;
    assert.strictEqual(task.title, 'Order the banner');
    assert.strictEqual(new Date(task.cancelledAt ?? 0).getDate(), 2);
    assert.strictEqual(task.completed, false);
  });

  test('counts what Obsidian Tasks counts in a vault of bulleted tasks', () => {
    // Obsidian Tasks reads any character between the brackets as a task;
    // this vault, written as Obsidian users write, holds 9 of them.
    const vault = [
      '# Week',
      '- [ ] Plan',
      '- [x] Book the room',
      '  - [X] Confirm',
      '- [/] Draft',
      '- [-] Banner',
      '* [?] Swag',
      '+ [!] Urgent',
      '- [=] Waiting on legal',
      '\t- [b] Bookmark',
      '- [>] Migrated, which Deckard keeps as its own',
      '- plain item',
      '- [ ]',
    ].join('\n');
    assert.strictEqual(parseMarkdown('week.md', vault).tasks.length, 9);
  });

  test('the shared shapes take any status, and [>] only where asked', () => {
    assert.strictEqual(isTaskLineOf('- [/] Draft', { indent: 'whitespace', marks: STATUS_MARKS }), true);
    assert.strictEqual(isTaskLineOf('- [a](link)', { indent: 'whitespace', marks: STATUS_MARKS }), false);
    assert.strictEqual(isTaskLineOf('- [ ]word', { indent: 'whitespace', marks: STATUS_MARKS }), true);
    assert.strictEqual(isTaskLineOf('- [>] Moved', { indent: 'whitespace', marks: STATUS_MARKS }), false);
    assert.strictEqual(isTaskLineOf('- [>] Moved', { indent: 'whitespace', marks: STATUS_OR_MIGRATED_MARKS }), true);
  });
});

/** A workspace of one note, its tasks each named by their words. */
function indexOf(lines: readonly string[]) {
  return buildWorkspaceIndex(new Map([['work.md', parseMarkdown('work.md', lines.join('\n'))]]));
}

suite('Task statuses: what the types mean, and searching', () => {
  const index = indexOf([
    '# Work',
    '- [ ] plain',
    '- [/] started',
    '- [ ] tagged-doing #status/doing',
    '- [x] finished ✅ 2026-10-01',
    '- [-] dropped ❌ 2026-10-02',
    '- [=] stuck',
    '- [ ] tagged-blocked #status/blocked',
    '- [ ] tagged-waiting #status/waiting',
    '- [?] puzzled',
    '- [ ] tagged-done #status/done',
    '- [ ] review #status/review',
  ]);
  const now = new Date(2026, 9, 5).getTime();
  const matches = (query: string): string[] => {
    const parsed = parseQuery(query);
    assert.deepStrictEqual(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), [], query);
    return evaluateQuery(index, parsed.node, createQueryContext(now)).tasks.map((task) => task.title.split(' ')[0]).sort();
  };

  test('is: goes by type: open, in progress, done, cancelled, and closed', () => {
    assert.deepStrictEqual(matches('is:open'), ['plain', 'puzzled', 'review', 'started', 'stuck', 'tagged-blocked', 'tagged-doing', 'tagged-done', 'tagged-waiting']);
    assert.deepStrictEqual(matches('is:in-progress'), ['started', 'tagged-doing']);
    assert.deepStrictEqual(matches('is:done'), ['finished']);
    assert.deepStrictEqual(matches('is:cancelled'), ['dropped']);
    assert.deepStrictEqual(matches('is:closed'), ['dropped', 'finished']);
    assert.deepStrictEqual(matches('task:open'), matches('is:open'));
  });

  test('status: finds a status by name, by character, and keeps open, done, and any', () => {
    assert.deepStrictEqual(matches('status:blocked'), ['stuck', 'tagged-blocked']);
    assert.deepStrictEqual(matches('status:in-progress'), ['started', 'tagged-doing']);
    assert.deepStrictEqual(matches('status:"in progress"'), ['started', 'tagged-doing']);
    assert.deepStrictEqual(matches('status:[=]'), ['stuck']);
    assert.deepStrictEqual(matches('status:[?]'), ['puzzled']);
    assert.deepStrictEqual(matches('status:unknown'), ['puzzled']);
    assert.deepStrictEqual(matches('status:cancelled'), ['dropped']);
    assert.deepStrictEqual(matches('status:done'), ['finished']);
    assert.deepStrictEqual(matches('status:open'), matches('is:open'));
    assert.strictEqual(matches('status:any').length, 11);
    assert.deepStrictEqual(matches('is:in-progress -status:[/]'), ['tagged-doing']);
  });

  test('a done tag closes nothing, and a tag no status names leaves the box\'s status', () => {
    const [done] = [...index.tasks.values()].filter((task) => task.title.startsWith('tagged-done'));
    assert.deepStrictEqual(readTaskStatus(done, DEFAULT_TASK_STATUSES, 'status'), { symbol: ' ', name: 'Todo', type: 'todo' });
    const [review] = [...index.tasks.values()].filter((task) => task.title.startsWith('review'));
    assert.strictEqual(readTaskStatus(review, DEFAULT_TASK_STATUSES, 'status').name, 'Todo');
    assert.strictEqual(nameTaskStatus(review, DEFAULT_TASK_STATUSES, 'status'), 'Review');
  });

  test('on hold, blocked, and available read the statuses', () => {
    assert.deepStrictEqual(matches('is:waiting'), ['stuck', 'tagged-blocked', 'tagged-waiting']);
    assert.deepStrictEqual(matches('is:blocked'), ['stuck', 'tagged-blocked']);
    assert.deepStrictEqual(matches('is:available'), ['plain', 'puzzled', 'review', 'started', 'tagged-doing', 'tagged-done']);
  });

  test('the cancelled date is a field of its own, looking back', () => {
    assert.deepStrictEqual(matches('has:cancelled'), ['dropped']);
    assert.deepStrictEqual(matches('cancelled = 2026-10-02'), ['dropped']);
    assert.deepStrictEqual(matches('no:cancelled AND is:closed'), ['finished']);
  });

  test('cancelled tasks count on neither side of progress', () => {
    const tasks = [...index.tasks.values()];
    assert.deepStrictEqual(countTaskProgress(tasks), { done: 1, total: 10 });
    const steps = parseMarkdown('steps.md', ['- [ ] Ship', '  - [x] Build', '  - [-] Rewrite', '  - [ ] Test'].join('\n')).tasks[0].steps;
    assert.deepStrictEqual({ total: steps?.total, done: steps?.done, next: steps?.next }, { total: 2, done: 1, next: 'Test' });
  });

  test('Refine offers each open status found, and cancelled tasks, as chips', () => {
    const tasks = [...index.tasks.values()];
    const [facet] = buildSearchFacets(index, { sections: [], files: [], tasks }, 'is:task', { now }).filter((found) => found.id === 'status');
    assert.deepStrictEqual(
      facet.values.map((value) => `${value.label} ${value.count} ${value.clause}`),
      [
        'Open 9 is:open',
        'Done 1 is:done',
        'Cancelled 1 is:cancelled',
        'Blocked 2 status:blocked',
        'In progress 2 status:in-progress',
        'Unknown 1 status:unknown',
        'Waiting 1 status:waiting',
      ],
    );
  });
});

suite('Task statuses: writing one', () => {
  const statuses = DEFAULT_TASK_STATUSES;
  const named = (name: string) => statuses.find((status) => status.name === name) as TaskStatusDefinition;
  const write = (line: string, name: string, writeAs: StatusWriteMode = 'match') =>
    setTaskStatus(line, line.indexOf('[') + 1, {
      to: named(name),
      namespace: 'status',
      writeAs,
      doneDate: '2026-10-05',
      cancelledDate: '2026-10-05',
    });

  test('match writes the character on a plain line and the tag on a tagged one', () => {
    assert.strictEqual(write('- [ ] Draft', 'In progress'), '- [/] Draft');
    assert.strictEqual(write('- [ ] Draft #status/todo', 'In progress'), '- [ ] Draft #status/doing');
    assert.strictEqual(write('- [/] Draft', 'Blocked'), '- [=] Draft');
    assert.strictEqual(write('- [/] Draft', 'Todo'), '- [ ] Draft');
  });

  test('checkbox always writes the character, taking the tag away; tag always the tag', () => {
    assert.strictEqual(write('- [ ] Draft #status/doing', 'Blocked', 'checkbox'), '- [=] Draft');
    assert.strictEqual(write('- [/] Draft', 'In progress', 'tag'), '- [ ] Draft #status/doing');
  });

  test('a status with no character is its tag in an empty box', () => {
    assert.strictEqual(write('- [/] Draft', 'Waiting', 'checkbox'), '- [ ] Draft #status/waiting');
    assert.strictEqual(write('- [ ] Draft #status/doing', 'Someday'), '- [ ] Draft #status/someday');
  });

  test('done and cancelled are their characters, with their dates, one replacing the other', () => {
    assert.strictEqual(write('- [/] Ship #status/doing', 'Done'), '- [x] Ship #status/doing ✅ 2026-10-05');
    assert.strictEqual(write('- [x] Ship ✅ 2026-10-01', 'Cancelled'), '- [-] Ship ❌ 2026-10-05');
    assert.strictEqual(write('- [-] Ship ❌ 2026-10-02', 'Todo'), '- [ ] Ship');
    assert.strictEqual(write('- [-] Ship ❌ 2026-10-02', 'Cancelled'), '- [-] Ship ❌ 2026-10-02');
  });

  test('a line reads its status as the index does, and the workflow steps by next', () => {
    assert.deepStrictEqual(readLineStatus('- [ ] Plan #status/waiting', 2 + 1, statuses, 'status'), { symbol: ' ', name: 'Waiting', type: 'onHold' });
    assert.strictEqual(nextStatus({ symbol: '/', name: 'In progress', type: 'inProgress' }, statuses)?.symbol, 'x');
    assert.strictEqual(nextStatus({ symbol: 'x', name: 'Done', type: 'done' }, statuses)?.symbol, ' ');
    assert.strictEqual(nextStatus({ symbol: ' ', name: 'Waiting', type: 'onHold' }, statuses), undefined);
    assert.strictEqual(nextStatus({ symbol: '?', name: 'Unknown', type: 'todo' }, statuses), undefined);
  });

  test('Toggle Task Done completes any status that is not done, and reopens as [ ], its tag gone', () => {
    const options = { addDoneDate: false, format: 'emoji' as const, eol: '\n', statusNamespace: 'status' };
    const lines = [
      { line: 0, text: '- [/] Draft' },
      { line: 1, text: '- [-] Banner' },
      { line: 2, text: '- [x] Room' },
    ];
    assert.deepStrictEqual(toggleTaskLines(lines, 0, options).lines.map((line) => line.after), ['- [x] Draft', '- [x] Banner']);
    assert.deepStrictEqual(
      toggleTaskLines([{ line: 0, text: '- [x] Draft #status/doing' }], 0, options).lines.map((line) => line.after),
      ['- [ ] Draft'],
    );
  });

  test('a step is closed when its status is done or cancelled', () => {
    assert.strictEqual(isClosedTaskLine('  - [-] Rewrite'), true);
    assert.strictEqual(isClosedTaskLine('  - [x] Build'), true);
    assert.strictEqual(isClosedTaskLine('  - [/] Test'), false);
  });

  test('no file outside the line shapes spells out the checkbox marks', () => {
    const root = path.join(__dirname, '..', '..', 'src');
    const found: string[] = [];
    const walk = (folder: string): void => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const at = path.join(folder, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'test') {
            walk(at);
          }
        } else if (/\.tsx?$/.test(entry.name) && entry.name !== 'lineShapes.ts') {
          const text = fs.readFileSync(at, 'utf8');
          if (/\[ ?xX\]|marks: ' xX|'xX'/.test(text)) {
            found.push(path.relative(root, at));
          }
        }
      }
    };
    walk(root);
    assert.deepStrictEqual(found, [], 'a task line is recognized by STATUS_MARKS or STATUS_CHARACTER, so a new status is a task everywhere');
  });
});
