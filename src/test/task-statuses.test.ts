import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { parseMarkdown } from '../domain/markdown/parser';
import { isTaskLineOf, STATUS_MARKS, STATUS_OR_MIGRATED_MARKS } from '../domain/markdown/lineShapes';
import {
  countTaskProgress,
  DEFAULT_TASK_STATUSES,
  nameTaskStatus,
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
import { nextStatus, readLineStatus, setTaskStatus } from '../domain/tasks/statusWrites';
import { toggleTaskLines } from '../domain/tasks/toggleLines';
import { isClosedTaskLine } from '../domain/markdown/taskSteps';
import { layoutTaskBoard, type TaskBoardOptions } from '../ui/state/taskBoardState';
import { createAgenda } from '../ui/state/agendaState';
import { findTaskLineMarks } from '../ui/state/taskLineMarks';
import { drawTaskStatus } from '../ui/state/drawnStatus';
import { DEFAULT_TASK_POLICY } from '../domain/tasks/taskPolicy';
import {
  countKnownStatusTags,
  countStatusMove,
  findStatusRenames,
  importObsidianStatuses,
  listKeptStatusTags,
  moveLegacyColumnOrder,
  moveLegacyLimits,
  moveStatusTagsInQuery,
  planStatusMove,
  renameStatusInQuery,
} from '../domain/tasks/statusMigration';
import { nameStatusTag, readLegacyStatusTags } from '../domain/tasks/legacyStatusTags';
import { checkStatusList } from '../domain/tasks/statusChecks';

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

  test('leaves out what can\'t be a status, a status with no character among them, and reads a character given twice as the first', () => {
    const statuses = readTaskStatuses([
      { symbol: '?', name: 'Question', type: 'todo' },
      { symbol: '?', name: 'Second', type: 'done' },
      { symbol: '>', name: 'Migrated', type: 'todo' },
      { symbol: ']', name: 'Close', type: 'todo' },
      { symbol: 'ab', name: 'Two', type: 'todo' },
      { symbol: '!', name: '', type: 'todo' },
      { symbol: '!', name: 'Bad type', type: 'urgent' },
      { name: 'No symbol', type: 'onHold' },
      { name: 'Waiting', type: 'onHold', tag: 'waiting' },
      'Blocked',
    ]);
    assert.deepStrictEqual(statuses.map((status) => status.name), ['Todo', 'Question', 'Done', 'Done']);
    assert.ok(statuses.every((status) => !('tag' in status)));
  });

  test('reads deckard.tasks.statuses from settings', () => {
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
    assert.deepStrictEqual(read(['- [ ] a', '- [/] b', '- [x] c', '- [X] d', '- [-] e', '- [=] f', '- [w] g', '- [s] h'].join('\n')), [
      '[ ] Todo todo',
      '[/] In progress inProgress',
      '[x] Done done completed',
      '[X] Done done completed',
      '[-] Cancelled cancelled',
      '[=] Blocked onHold',
      '[w] Waiting onHold',
      '[s] Someday onHold',
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
    '- [w] waiting',
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
    assert.deepStrictEqual(matches('is:open'), ['plain', 'puzzled', 'review', 'started', 'stuck', 'tagged-blocked', 'tagged-doing', 'tagged-done', 'waiting']);
    assert.deepStrictEqual(matches('is:in-progress'), ['started']);
    assert.deepStrictEqual(matches('is:done'), ['finished']);
    assert.deepStrictEqual(matches('is:cancelled'), ['dropped']);
    assert.deepStrictEqual(matches('is:closed'), ['dropped', 'finished']);
    assert.deepStrictEqual(matches('task:open'), matches('is:open'));
  });

  test('status: finds a status by name, by character, and keeps open, done, and any', () => {
    assert.deepStrictEqual(matches('status:blocked'), ['stuck']);
    assert.deepStrictEqual(matches('status:in-progress'), ['started']);
    assert.deepStrictEqual(matches('status:"in progress"'), ['started']);
    assert.deepStrictEqual(matches('status:waiting'), ['waiting']);
    assert.deepStrictEqual(matches('status:todo'), ['plain', 'review', 'tagged-blocked', 'tagged-doing', 'tagged-done']);
    assert.deepStrictEqual(matches('status:[=]'), ['stuck']);
    assert.deepStrictEqual(matches('status:[?]'), ['puzzled']);
    assert.deepStrictEqual(matches('status:unknown'), ['puzzled']);
    assert.deepStrictEqual(matches('status:cancelled'), ['dropped']);
    assert.deepStrictEqual(matches('status:done'), ['finished']);
    assert.deepStrictEqual(matches('status:open'), matches('is:open'));
    assert.strictEqual(matches('status:any').length, 11);
    assert.deepStrictEqual(matches('is:in-progress -status:[/]'), []);
  });

  test('a status tag is a tag like any other: an empty box is Todo whatever it carries', () => {
    const tagged = [...index.tasks.values()].filter((task) => task.title.startsWith('tagged-') || task.title.startsWith('review'));
    assert.deepStrictEqual(tagged.map((task) => task.status), tagged.map(() => ({ symbol: ' ', name: 'Todo', type: 'todo' })));
    assert.deepStrictEqual(tagged.map((task) => nameTaskStatus(task)), tagged.map(() => undefined));
    assert.deepStrictEqual(matches('#status/doing'), ['tagged-doing']);
  });

  test('on hold, blocked, and available read the statuses', () => {
    assert.deepStrictEqual(matches('is:waiting'), ['stuck', 'waiting']);
    assert.deepStrictEqual(matches('is:blocked'), ['stuck']);
    assert.deepStrictEqual(matches('is:available'), ['plain', 'puzzled', 'review', 'started', 'tagged-blocked', 'tagged-doing', 'tagged-done']);
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
        'Blocked 1 status:blocked',
        'In progress 1 status:in-progress',
        'Unknown 1 status:unknown',
        'Waiting 1 status:waiting',
      ],
    );
  });
});

suite('Task statuses: writing one', () => {
  const statuses = DEFAULT_TASK_STATUSES;
  const named = (name: string) => statuses.find((status) => status.name === name) as TaskStatusDefinition;
  const write = (line: string, name: string) =>
    setTaskStatus(line, line.indexOf('[') + 1, {
      to: named(name),
      doneDate: '2026-10-05',
      cancelledDate: '2026-10-05',
    });

  test('every status is written as its character, and a tag on the line stays a tag', () => {
    assert.strictEqual(write('- [ ] Draft', 'In progress'), '- [/] Draft');
    assert.strictEqual(write('- [ ] Draft #status/todo', 'In progress'), '- [/] Draft #status/todo');
    assert.strictEqual(write('- [/] Draft', 'Blocked'), '- [=] Draft');
    assert.strictEqual(write('- [/] Draft', 'Waiting'), '- [w] Draft');
    assert.strictEqual(write('- [w] Draft', 'Someday'), '- [s] Draft');
    assert.strictEqual(write('- [/] Draft', 'Todo'), '- [ ] Draft');
  });

  test('done and cancelled are their characters, with their dates, one replacing the other', () => {
    assert.strictEqual(write('- [/] Ship #status/doing', 'Done'), '- [x] Ship #status/doing ✅ 2026-10-05');
    assert.strictEqual(write('- [x] Ship ✅ 2026-10-01', 'Cancelled'), '- [-] Ship ❌ 2026-10-05');
    assert.strictEqual(write('- [-] Ship ❌ 2026-10-02', 'Todo'), '- [ ] Ship');
    assert.strictEqual(write('- [-] Ship ❌ 2026-10-02', 'Cancelled'), '- [-] Ship ❌ 2026-10-02');
  });

  test('a line reads its status as the index does, and the workflow steps by next', () => {
    assert.deepStrictEqual(readLineStatus('- [ ] Plan #status/waiting', 2 + 1, statuses), { symbol: ' ', name: 'Todo', type: 'todo' });
    assert.deepStrictEqual(readLineStatus('- [w] Plan', 2 + 1, statuses), { symbol: 'w', name: 'Waiting', type: 'onHold' });
    assert.strictEqual(nextStatus({ symbol: '/', name: 'In progress', type: 'inProgress' }, statuses)?.symbol, 'x');
    assert.strictEqual(nextStatus({ symbol: 'x', name: 'Done', type: 'done' }, statuses)?.symbol, ' ');
    assert.strictEqual(nextStatus({ symbol: 'w', name: 'Waiting', type: 'onHold' }, statuses)?.symbol, ' ');
    assert.strictEqual(nextStatus({ symbol: '?', name: 'Unknown', type: 'todo' }, statuses), undefined);
  });

  test('Toggle Task Done completes any status that is not done, and reopens as [ ], a tag kept', () => {
    const options = { format: 'emoji' as const, eol: '\n' };
    const noon = new Date(2026, 8, 25, 12).getTime();
    const lines = [
      { line: 0, text: '- [/] Draft' },
      { line: 1, text: '- [-] Banner' },
      { line: 2, text: '- [x] Room' },
    ];
    assert.deepStrictEqual(toggleTaskLines(lines, noon, options).lines.map((line) => line.after), ['- [x] Draft ✅ 2026-09-25', '- [x] Banner ✅ 2026-09-25']);
    assert.deepStrictEqual(
      toggleTaskLines([{ line: 0, text: '- [x] Draft #status/doing' }], 0, options).lines.map((line) => line.after),
      ['- [ ] Draft #status/doing'],
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

suite('Task statuses: the board and the Tasks view', () => {
  const index = indexOf([
    '# Work',
    '- [ ] plain',
    '- [/] started',
    '- [ ] tagged #status/doing',
    '- [=] stuck',
    '- [?] puzzled',
    '- [w] waiting',
    '- [x] finished',
    '- [-] dropped',
  ]);
  const options: TaskBoardOptions = {
    queryContext: createQueryContext(new Date(2026, 9, 5).getTime()),
    format: 'emoji',
  };
  const titleOf = (taskId: string): string => (index.tasks.get(taskId)?.title ?? '').split(' ')[0];
  const columns = (layoutOptions: TaskBoardOptions) =>
    layoutTaskBoard({ index, tasks: [...index.tasks.values()], requestedGroupBy: 'status', options: layoutOptions }).columns.map((column) => [
      column.label,
      column.cards.map((card) => `${titleOf(card.taskId)}${card.details.length && card.details[0].startsWith('Unknown') ? ` (${card.details[0]})` : ''}`),
    ]);

  test('columns are the list\'s open statuses, a character places a card, and one no status names has a column of its own', () => {
    assert.deepStrictEqual(columns(options), [
      ['Todo', ['plain', 'tagged']],
      ['In progress', ['started']],
      ['Waiting', ['waiting']],
      ['Someday', []],
      ['Blocked', ['stuck']],
      ['Unknown', ['puzzled']],
      ['Done', ['finished']],
    ]);
  });

  test('a Cancelled column follows Done when the gear shows it', () => {
    assert.deepStrictEqual(columns({ ...options, hiddenColumns: [] }).slice(-2), [
      ['Done', ['finished']],
      ['Cancelled', ['dropped']],
    ]);
  });

  test('the Tasks view groups by the same columns, in the board\'s order, hidden ones too', () => {
    const groups = (statusOrder?: string[]) =>
      createAgenda(index, createQueryContext(new Date(2026, 9, 5).getTime()), { upcomingDays: 7, groupBy: 'status', ...(statusOrder ? { statusOrder } : {}) })
        .map((group) => [group.id, group.label, group.entries.map((entry) => entry.task.title.split(' ')[0])]);
    assert.deepStrictEqual(groups(), [
      ['todo', 'Todo', ['plain', 'tagged']],
      ['in-progress', 'In progress', ['started']],
      ['waiting', 'Waiting', ['waiting']],
      ['blocked', 'Blocked', ['stuck']],
      ['unknown-63', 'Unknown [?]', ['puzzled']],
    ]);
    assert.deepStrictEqual(groups(['Blocked', 'Waiting']).map((group) => group[0]), ['blocked', 'waiting', 'todo', 'in-progress', 'unknown-63']);
  });
});

suite('Task statuses: how a status is drawn', () => {
  const context = createQueryContext(new Date(2026, 9, 5).getTime());

  test('the editor marks an in-progress box, a cancelled task\'s words, and a character no status names', () => {
    const marks = findTaskLineMarks(['- [/] Draft 📅 2026-10-01', '- [-] Banner', '- [?] Swag', '- [ ] Plain'], context, { dim: false, hints: true });
    assert.deepStrictEqual(marks.inProgress, [{ line: 0, start: 2, end: 5 }]);
    assert.deepStrictEqual(marks.cancelled, [{ line: 1, start: 6, end: 12 }]);
    assert.deepStrictEqual(marks.unknown, [{ line: 2, start: 2, end: 5, symbol: '?' }]);
    assert.deepStrictEqual(marks.hints.map((hint) => hint.line), [0], 'an in-progress task is open, so its date speaks up');
  });

  test('a page draws a status only when it is neither a plain to do nor done', () => {
    const [plain, started, waiting, dropped, puzzled, done, stuck] = parseMarkdown(
      'note.md',
      ['- [ ] a', '- [/] b', '- [w] c', '- [-] d', '- [?] e', '- [x] f', '- [=] g'].join('\n'),
    ).tasks;
    const draw = (task: Parameters<typeof drawTaskStatus>[0]) => drawTaskStatus(task, DEFAULT_TASK_POLICY);
    assert.strictEqual(draw(plain), undefined);
    assert.strictEqual(draw(done), undefined);
    assert.deepStrictEqual(draw(started), { name: 'In progress', type: 'inProgress' });
    assert.deepStrictEqual(draw(waiting), { name: 'Waiting', type: 'onHold' });
    assert.deepStrictEqual(draw(dropped), { name: 'Cancelled', type: 'cancelled' });
    assert.deepStrictEqual(draw(puzzled), { name: 'Unknown', type: 'todo', unknown: '?' });
    assert.deepStrictEqual(draw(stuck), { name: 'Blocked', type: 'onHold', icon: 'blocked' });
  });
});

suite('Task statuses: moving over, importing, and editing', () => {
  test('the move puts a tag with a character into its box, takes a stale tag away, and keeps the rest', () => {
    const file = parseMarkdown('work.md', [
      '- [ ] Draft #status/doing',
      '- [x] Ship #status/doing ✅ 2026-10-01',
      '- [ ] Legal #status/waiting',
      '- [ ] Review #status/review',
      '- [ ] Old #status/done',
      '- [ ] Plain',
    ].join('\n'));
    const legacy = readLegacyStatusTags(undefined, undefined);
    const lines = planStatusMove(file.tasks, { statuses: DEFAULT_TASK_STATUSES, legacy, doneDate: '2026-10-06' });
    assert.deepStrictEqual(lines.map((line) => [line.group, line.after, line.known]), [
      ['character', '- [/] Draft', true],
      ['stale', '- [x] Ship ✅ 2026-10-01', true],
      ['character', '- [w] Legal', true],
      ['kept', '- [ ] Review #status/review', false],
      ['done', '- [x] Old ✅ 2026-10-06', true],
    ]);
    assert.deepStrictEqual(countStatusMove(lines), { character: 2, stale: 1, done: 1, kept: 1 });
  });

  test('the move reads what each tag meant from the old settings, and keeps a tag the list has no character for', () => {
    const legacy = readLegacyStatusTags('Stage', [
      { name: 'Review', type: 'onHold', tag: 'review', symbol: 'r' },
      { name: 'Waiting', type: 'onHold', tag: 'waiting' },
      { name: 'Done', type: 'done', tag: 'finished', symbol: 'x' },
    ]);
    assert.strictEqual(legacy.namespace, 'stage');
    // Waiting, written with no character, gives its tag none: the list now
    // has no status for it until one is given a character.
    assert.deepStrictEqual([...legacy.characters], [['review', 'r'], ['todo', ' '], ['doing', '/'], ['someday', 's'], ['blocked', '=']]);
    assert.deepStrictEqual([...legacy.types], [['review', 'onHold'], ['waiting', 'onHold'], ['todo', 'todo'], ['doing', 'inProgress'], ['someday', 'onHold'], ['blocked', 'onHold']]);
    const file = parseMarkdown('work.md', ['- [ ] Look #stage/review', '- [ ] Wait #stage/waiting', '- [ ] Plain #stage/todo', '- [ ] Other #status/doing'].join('\n'));
    const statuses = readTaskStatuses([{ symbol: ' ', name: 'Todo', type: 'todo' }, { symbol: 'r', name: 'Review', type: 'onHold' }]);
    assert.deepStrictEqual(planStatusMove(file.tasks, { statuses, legacy }).map((line) => [line.group, line.after]), [
      ['character', '- [r] Look'],
      ['kept', '- [ ] Wait #stage/waiting'],
      ['stale', '- [ ] Plain'],
    ]);
  });

  test('the notice counts the tags the move knows, and Give It a Character offers the ones it keeps', () => {
    const file = parseMarkdown('work.md', [
      '- [ ] Draft #status/doing',
      '- [ ] Look #status/review',
      '- [ ] Again #status/review',
      '- [ ] Old #status/done',
      '- [x] Ship #status/doing',
      '- [ ] Odd #status/on-call',
    ].join('\n'));
    const lines = planStatusMove(file.tasks, { statuses: DEFAULT_TASK_STATUSES, legacy: readLegacyStatusTags(undefined, undefined) });
    assert.strictEqual(countKnownStatusTags(lines), 3, 'doing twice, and done; review and on-call were never Deckard\'s');
    assert.deepStrictEqual(listKeptStatusTags(lines), [{ tag: 'review', count: 2 }, { tag: 'on-call', count: 1 }]);
    assert.strictEqual(nameStatusTag('on-call'), 'On call');
  });

  test('searches that name a status tag search by its status', () => {
    const legacy = readLegacyStatusTags(undefined, undefined);
    const move = (query: string) => moveStatusTagsInQuery(query, legacy, DEFAULT_TASK_STATUSES);
    assert.strictEqual(move('#project/x -#status/doing'), '#project/x -status:in-progress');
    assert.strictEqual(move('(#status/waiting OR tag:#status/someday) AND tag:status/blocked'), '(status:waiting OR status:someday) AND status:blocked');
    assert.strictEqual(move('#Status/Done'), 'status:done');
    assert.strictEqual(move('#status/review status/doing #status/doing-now'), '#status/review status/doing #status/doing-now', 'a tag no status stands for, and words, stay');
    const staged = readLegacyStatusTags('stage', undefined);
    assert.strictEqual(moveStatusTagsInQuery('#stage/doing #status/doing', staged, DEFAULT_TASK_STATUSES), 'status:in-progress #status/doing');
  });

  test('the old board settings move into the gear\'s choices and the limits\' keys', () => {
    const legacy = readLegacyStatusTags(undefined, undefined);
    assert.deepStrictEqual(moveLegacyColumnOrder(['todo', 'doing', 'waiting', 'review', 'blocked', 'in-progress'], legacy, DEFAULT_TASK_STATUSES), ['Todo', 'In progress', 'Waiting', 'Blocked']);
    assert.strictEqual(moveLegacyColumnOrder('todo', legacy, DEFAULT_TASK_STATUSES), undefined);
    assert.deepStrictEqual(moveLegacyLimits({ doing: 3, 'priority:high': 5, review: 2 }, legacy, DEFAULT_TASK_STATUSES), { 'in-progress': 3, 'priority:high': 5, review: 2 });
    assert.strictEqual(moveLegacyLimits({ 'in-progress': 3 }, legacy, DEFAULT_TASK_STATUSES), undefined, 'nothing to move');
  });

  test('a vault\'s Obsidian Tasks statuses import as they are, with Waiting and Someday where the vault has neither', () => {
    const imported = importObsidianStatuses({
      statusSettings: {
        coreStatuses: [
          { symbol: ' ', name: 'Todo', nextStatusSymbol: 'x', type: 'TODO' },
          { symbol: 'x', name: 'Done', nextStatusSymbol: ' ', type: 'DONE' },
        ],
        customStatuses: [
          { symbol: '/', name: 'In Progress', nextStatusSymbol: 'x', type: 'IN_PROGRESS' },
          { symbol: 'P', name: 'Pro', nextStatusSymbol: 'C', type: 'NON_TASK' },
          { symbol: '?', name: 'Question', type: 'MYSTERY' },
        ],
      },
    });
    assert.deepStrictEqual(
      imported?.map((status) => `${status.symbol}:${status.name}:${status.type}:${status.next ?? ''}`),
      [' :Todo:todo:x', 'x:Done:done: ', '/:In Progress:inProgress:x', 'P:Pro:nonTask:C', 'w:Waiting:onHold: ', 's:Someday:onHold: ', 'X:Done:done: '],
    );
    const own = importObsidianStatuses({
      statusSettings: { coreStatuses: [{ symbol: ' ', name: 'Todo', type: 'TODO' }], customStatuses: [{ symbol: 'w', name: 'Win', type: 'TODO' }, { symbol: 'z', name: 'Someday', type: 'ON_HOLD' }] },
    });
    assert.deepStrictEqual(own?.map((status) => `${status.symbol}:${status.name}`), [' :Todo', 'w:Win', 'z:Someday', 'x:Done', 'X:Done']);
    assert.strictEqual(importObsidianStatuses({}), undefined);
  });

  test('a rename is found by character, and carried into searches by name', () => {
    const before = DEFAULT_TASK_STATUSES;
    const after = before.map((status) => (status.symbol === '/' ? { ...status, name: 'Doing' } : status));
    const renames = findStatusRenames(before, after);
    assert.deepStrictEqual(renames, [{ from: 'In progress', to: 'Doing' }]);
    assert.strictEqual(renameStatusInQuery('status:in-progress #project/x', renames[0]), 'status:doing #project/x');
    assert.strictEqual(renameStatusInQuery('status = "in progress" OR -status:blocked', renames[0]), 'status = doing OR -status:blocked');
    assert.strictEqual(renameStatusInQuery('status:[/]', renames[0]), 'status:[/]', 'a character finds it whatever it is called');
  });

  test('the editor checks a list as it is typed', () => {
    const problems = (statuses: Parameters<typeof checkStatusList>[0], workflow = false) =>
      checkStatusList(statuses, workflow).map((problem) => `${problem.row} ${problem.severity}: ${problem.text}`);
    assert.deepStrictEqual(problems([{ symbol: '/', name: '', type: 'inProgress' }, { name: 'Loose', type: 'onHold' }]), [
      '0 error: Give it a name.',
      '1 error: Give it a character.',
    ]);
    assert.deepStrictEqual(problems([{ symbol: '/', name: 'One', type: 'todo' }, { symbol: '/', name: 'Two', type: 'todo' }]), ['1 error: [/] is already One\'s character.']);
    assert.match(problems([{ symbol: 'o', name: 'Open', type: 'todo' }])[0], /warning: status:open already means every open task/);
    assert.deepStrictEqual(
      problems([{ symbol: 'x', name: 'Done', type: 'done', next: '-' }, { symbol: '-', name: 'Cancelled', type: 'cancelled', next: '?' }], true),
      [
        '0 warning: A click on a done task should open it again, to do or in progress; [-] is Cancelled.',
        '1 error: No status has the character [?] that a click moves it to.',
      ],
    );
  });
});
