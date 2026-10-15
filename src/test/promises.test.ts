import * as assert from 'assert';

import {
  findPromisedDay,
  findPromises,
  formatPromiseTask,
  PromiseReading,
  promiseLineKey,
  readPromiseLine,
} from '../domain/tasks/promises';
import { MemoryStore } from './preferenceServices';
import { NOT_PROMISES_KEY, NOT_PROMISES_LIMIT, PromiseDismissals } from '../core/storage/promiseDismissals';

/** The moment the note is read at: Wednesday 14 Oct 2026, ten in the morning. */
const now = new Date(2026, 9, 14, 10).getTime();

/** Reading as David, month first, weeks from Sunday. */
const reading: PromiseReading = { now, identity: '@david', dateOptions: { weekStart: 0, numericOrder: 'mdy' } };

/** The day a line promises, or undefined when it is no promise. */
const dueOf = (line: string, with_: Partial<PromiseReading> = {}): string | undefined =>
  readPromiseLine(line, 0, { ...reading, ...with_ })?.due;

suite('Said they would', () => {
  test('reads a line naming one person and a day to come, with the day words where they are', () => {
    const line = '- @sam-okafor says the loader retry fix lands by Friday.';
    const promise = readPromiseLine(line, 3, reading);
    assert.ok(promise);
    assert.strictEqual(promise.line, 3);
    assert.strictEqual(promise.person, '@sam-okafor');
    assert.strictEqual(promise.personKey, '@sam-okafor');
    assert.strictEqual(promise.due, '2026-10-16');
    assert.strictEqual(line.slice(promise.start, promise.end), 'by Friday');
    assert.strictEqual(promise.title, 'Loader retry fix lands');
  });

  test('reads each day phrase a promise is said in', () => {
    const cases: Array<[string, string]> = [
      ['by Friday', '2026-10-16'],
      ['on Friday', '2026-10-16'],
      ['Friday', '2026-10-16'],
      ['on fri', '2026-10-16'],
      ['next Monday', '2026-10-19'],
      ['tomorrow', '2026-10-15'],
      // That week's Friday, the last workday.
      ['next week', '2026-10-23'],
      ['end of week', '2026-10-16'],
      ['by EOW', '2026-10-16'],
      ['end of the month', '2026-10-31'],
      ['EOM', '2026-10-31'],
      ['on the 20th', '2026-10-20'],
      ['on the 2nd', '2026-11-02'],
      ['Oct 20', '2026-10-20'],
      ['October 20th', '2026-10-20'],
      ['20 Oct', '2026-10-20'],
      ['10/20', '2026-10-20'],
      ['2026-10-20', '2026-10-20'],
      ['in 3 days', '2026-10-17'],
      ['in 2 weeks', '2026-10-28'],
    ];
    for (const [phrase, due] of cases) {
      assert.strictEqual(dueOf(`@sam will send the deck ${phrase}`), due, phrase);
    }
    // A week that starts on Monday has the same Friday.
    assert.strictEqual(dueOf('@sam will send the deck next week', { dateOptions: { weekStart: 1 } }), '2026-10-23');
    // Without an order to read it in, a numeric date is not a day.
    assert.strictEqual(dueOf('@sam will send the deck 10/20', { dateOptions: {} }), undefined);
  });

  test('offers only a day after today and no more than 60 days off', () => {
    assert.strictEqual(dueOf('@sam sent the deck today'), undefined);
    assert.strictEqual(dueOf('@sam sent the deck on 2026-10-01'), undefined);
    assert.strictEqual(dueOf('@sam sends the deck on 2026-12-13'), '2026-12-13');
    assert.strictEqual(dueOf('@sam sends the deck on 2026-12-14'), undefined);
    assert.strictEqual(dueOf('@sam sends the deck in 3 months'), undefined);
    // A short weekday is a day only after a lead word.
    assert.strictEqual(dueOf('@sam and the sat nav'), undefined);
    // Of two days, the last that reads is the promise's.
    assert.strictEqual(dueOf('@sam said on 2026-10-01 that it lands by Friday'), '2026-10-16');
    assert.strictEqual(findPromisedDay('Sunday-school run with @sam', now), undefined);
  });

  test('a line names exactly one person, and not the reader', () => {
    assert.strictEqual(dueOf('Lunch with @sam and @lena tomorrow'), undefined);
    assert.strictEqual(dueOf('The fix lands tomorrow'), undefined);
    assert.strictEqual(dueOf('@sam says @sam will ship it tomorrow'), '2026-10-15');
    assert.strictEqual(dueOf('#person/sam ships it tomorrow'), '2026-10-15');
    assert.strictEqual(dueOf('@david ships it tomorrow'), undefined);
    assert.strictEqual(dueOf('@david ships it tomorrow', { identity: '' }), '2026-10-15');
  });

  test('a task, a question, a heading, or code is no promise', () => {
    assert.strictEqual(dueOf('- [ ] @sam ships it tomorrow'), undefined);
    assert.strictEqual(dueOf('- Will @sam ship it tomorrow?'), undefined);
    // A question's line is a checkbox line, so it is no promise however it ends.
    assert.strictEqual(dueOf('- [?] Will @sam ship the fix by Friday'), undefined);
    assert.strictEqual(dueOf('- [?] @sam says the fix lands by Friday #team/rates'), undefined);
    assert.strictEqual(dueOf('## @sam ships it tomorrow'), undefined);
    assert.strictEqual(dueOf('@sam ships `by Friday`'), undefined);
    assert.strictEqual(dueOf('`@sam` ships it by Friday'), undefined);
    const fenced = findPromises(['```', '@sam ships it tomorrow', '```', '@lena ships it tomorrow'], reading);
    assert.deepStrictEqual(fenced.map((promise) => promise.line), [3]);
    const frontmatter = findPromises(['---', 'note: "@sam ships it tomorrow"', '---', 'Body'], reading);
    assert.deepStrictEqual(frontmatter, []);
  });

  test('a promise a task under it already tracks is not offered again', () => {
    const lines = [
      '- @sam says the fix lands by Friday',
      '  - [w] Fix lands 📅 2026-10-16 👤 @sam',
      '- @lena says the deck lands by Friday',
      '  - [x] Deck lands 👤 @lena',
      '- @ren says the report lands by Friday',
      '  - [ ] Read it 👤 @lena',
      '- @kim says the plan lands by Friday',
      '- [ ] Plan lands 👤 @kim',
    ];
    assert.deepStrictEqual(
      findPromises(lines, reading).map((promise) => promise.person),
      ['@ren', '@kim'],
    );
  });

  test('titles the task with the words after the person and a reporting verb', () => {
    const titleOf = (line: string): string | undefined => readPromiseLine(line, 0, reading)?.title;
    assert.strictEqual(titleOf('@sam-okafor says the loader retry fix lands by Friday'), 'Loader retry fix lands');
    assert.strictEqual(titleOf('@sam will send the deck tomorrow!'), 'Send the deck');
    assert.strictEqual(titleOf('@sam promised that the numbers reconcile by EOW.'), 'Numbers reconcile');
    assert.strictEqual(titleOf('- @sam: UAT sign-off on Oct 20'), 'UAT sign-off');
    assert.strictEqual(titleOf('@sam to book the room on the 20th'), 'Book the room');
    // Fewer than two words left: the whole line without the day.
    assert.strictEqual(titleOf('- Lunch with @sam tomorrow'), 'Lunch with @sam');
    assert.strictEqual(titleOf('By Friday, @sam replies.'), '@sam replies');
  });

  test('writes the waiting task under the line, in the note format and the reader statuses', () => {
    const lines = ['- @sam-okafor says the loader retry fix lands by Friday'];
    const promise = findPromises(lines, reading)[0];
    assert.strictEqual(
      formatPromiseTask(lines, promise, { format: 'emoji' }),
      '  - [w] Loader retry fix lands 📅 2026-10-16 👤 @sam-okafor',
    );
    assert.strictEqual(
      formatPromiseTask(lines, promise, { format: 'dataview' }),
      '  - [w] Loader retry fix lands [due:: 2026-10-16] [assignee:: @sam-okafor]',
    );
    // A note whose tasks use Dataview's brackets is written in them.
    const dataview = ['- [ ] Old [due:: 2026-10-01]', ...lines];
    assert.strictEqual(
      formatPromiseTask(dataview, { ...promise, line: 1 }, { format: 'emoji' }),
      '  - [w] Loader retry fix lands [due:: 2026-10-16] [assignee:: @sam-okafor]',
    );
    // The reader's first on-hold status, under a numbered item or a paragraph.
    const statuses = [
      { symbol: ' ', name: 'Todo', type: 'todo' as const },
      { symbol: 'x', name: 'Done', type: 'done' as const },
      { symbol: '?', name: 'Asked', type: 'onHold' as const },
    ];
    const numbered = ['1. @sam ships it tomorrow'];
    assert.strictEqual(
      formatPromiseTask(numbered, findPromises(numbered, reading)[0], { format: 'emoji', statuses }),
      '   - [?] Ships it 📅 2026-10-15 👤 @sam',
    );
    const paragraph = ['\t@sam ships it tomorrow'];
    assert.strictEqual(
      formatPromiseTask(paragraph, findPromises(paragraph, reading)[0], { format: 'emoji' }),
      '\t\t- [w] Ships it 📅 2026-10-15 👤 @sam',
    );
  });

  test('remembers Not a promise by the note and the words of the line, up to a cap', async () => {
    const store = new MemoryStore();
    const marks = new PromiseDismissals(store);
    let changes = 0;
    marks.onDidChange(() => {
      changes += 1;
    });
    const key = promiseLineKey('  @sam ships it tomorrow ');
    assert.strictEqual(key, promiseLineKey('@sam ships it tomorrow'));
    assert.strictEqual(marks.has('file:///notes/2026-10-14.md', key), false);
    await marks.add('file:///notes/2026-10-14.md', key);
    assert.strictEqual(marks.has('file:///notes/2026-10-14.md', key), true);
    assert.strictEqual(marks.has('file:///notes/2026-10-15.md', key), false);
    assert.strictEqual(changes, 1);
    for (let at = 0; at < NOT_PROMISES_LIMIT; at += 1) {
      await marks.add('file:///notes/2026-10-14.md', `line${at}`);
    }
    assert.strictEqual(marks.has('file:///notes/2026-10-14.md', key), false, 'the oldest mark goes first');
    assert.strictEqual((store.get<string[]>(NOT_PROMISES_KEY) ?? []).length, NOT_PROMISES_LIMIT);
    await store.update(NOT_PROMISES_KEY, 'not a list');
    assert.strictEqual(marks.has('file:///notes/2026-10-14.md', 'line1'), false);
  });
});
