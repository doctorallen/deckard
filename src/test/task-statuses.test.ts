import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { parseMarkdown } from '../domain/markdown/parser';
import { isTaskLineOf, STATUS_MARKS, STATUS_OR_MIGRATED_MARKS } from '../domain/markdown/lineShapes';
import {
  DEFAULT_TASK_STATUSES,
  readTaskStatuses,
  readTaskStatusSettings,
  statusForSymbol,
  type TaskStatusDefinition,
} from '../domain/tasks/taskStatuses';

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
