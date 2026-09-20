import * as assert from 'assert';

import {
  describeTaskDate,
  formatTaskDraft,
  isTaskLine,
  parseTaskDateInput,
  parseTaskDraft,
} from '../core/markdown/taskDraft';

/** A Monday, so a weekday answer is easy to read. */
const now = new Date(2026, 8, 21, 9, 0, 0).getTime();

suite('Task drafts', () => {
  test('knows a task line from an ordinary one', () => {
    assert.strictEqual(isTaskLine('- [ ] Chase the contractor'), true);
    assert.strictEqual(isTaskLine('  * [x] Done'), true);
    assert.strictEqual(isTaskLine('+ [ ] Also a task'), true);
    assert.strictEqual(isTaskLine('- Not a task'), false);
    assert.strictEqual(isTaskLine('# Heading'), false);
    assert.strictEqual(isTaskLine('1. [ ] Ordered lists are not tasks'), false);
  });

  test('reads a line into its parts', () => {
    const draft = parseTaskDraft(
      '  - [ ] Chase the contractor #project/atlas @dana ⏫ 🔁 every week 🛫 2026-09-20 ⏳ 2026-09-21 📅 2026-09-22 🆔 a1 ⛔ b2, c3 ^chase',
    );
    assert.strictEqual(draft.prefix, '  - [ ] ');
    assert.strictEqual(draft.completed, false);
    assert.strictEqual(
      draft.description,
      'Chase the contractor #project/atlas @dana',
      'the words, with the metadata taken out and the tags left in',
    );
    assert.strictEqual(draft.priority, 'high');
    assert.strictEqual(draft.recurrence, 'every week');
    assert.strictEqual(draft.start, '2026-09-20');
    assert.strictEqual(draft.scheduled, '2026-09-21');
    assert.strictEqual(draft.due, '2026-09-22');
    assert.strictEqual(draft.id, 'a1');
    assert.deepStrictEqual(draft.dependsOn, ['b2', 'c3']);
    assert.strictEqual(draft.blockId, 'chase');
    assert.strictEqual(draft.format, 'emoji');
  });

  test('writes the line back as Tasks writes one', () => {
    const line =
      '- [ ] Chase the contractor ⏫ 🔁 every week 🛫 2026-09-20 ⏳ 2026-09-21 📅 2026-09-22 🆔 a1 ⛔ b2 ^chase';
    assert.strictEqual(formatTaskDraft(parseTaskDraft(line)), line);

    const done = '- [x] Filed the report ✅ 2026-09-18';
    assert.strictEqual(formatTaskDraft(parseTaskDraft(done)), done);
  });

  test('keeps a line in the format it was written in', () => {
    const dataview = '- [ ] Send the proposal [priority:: high] [due:: 2026-09-22]';
    const draft = parseTaskDraft(dataview);
    assert.strictEqual(draft.format, 'dataview');
    assert.strictEqual(formatTaskDraft(draft), dataview);

    const fresh = parseTaskDraft('- [ ] A new task', 'dataview');
    assert.strictEqual(fresh.format, 'dataview', 'the setting decides a bare line');
    assert.strictEqual(
      formatTaskDraft({ ...fresh, due: '2026-09-22' }),
      '- [ ] A new task [due:: 2026-09-22]',
    );
  });

  test('keeps what it does not edit', () => {
    const line = '- [ ] Ship it 🏁 delete 📅 2026-09-22 ^ship';
    const written = formatTaskDraft(parseTaskDraft(line));
    assert.ok(written.includes('🏁 delete'), written);
    assert.ok(written.endsWith('^ship'), 'a block id has to end the line');
  });

  test('makes a task out of a line that is not one yet', () => {
    const draft = parseTaskDraft('  Buy milk');
    assert.strictEqual(draft.prefix, '  - [ ] ');
    assert.strictEqual(draft.description, 'Buy milk');
    assert.strictEqual(formatTaskDraft(draft), '  - [ ] Buy milk');
    assert.strictEqual(formatTaskDraft(parseTaskDraft('')), '- [ ]');
  });

  test('reads a date the way people write one', () => {
    const date = (written: string): string | undefined | null => {
      const read = parseTaskDateInput(written, now);
      return read === undefined ? null : read.date;
    };
    assert.strictEqual(date('2026-09-25'), '2026-09-25');
    assert.strictEqual(date('today'), '2026-09-21');
    assert.strictEqual(date('tomorrow'), '2026-09-22');
    assert.strictEqual(date('yesterday'), '2026-09-20');
    assert.strictEqual(date('in 3 days'), '2026-09-24');
    assert.strictEqual(date('+2w'), '2026-10-05');
    assert.strictEqual(date('1 month'), '2026-10-21');
    assert.strictEqual(date('friday'), '2026-09-25');
    assert.strictEqual(date('next monday'), '2026-09-28', 'never today');
    assert.strictEqual(date(''), undefined, 'empty clears the date');
    assert.strictEqual(date('whenever'), null, 'and nothing is guessed');
    assert.strictEqual(date('2026-02-31'), null, 'a day that is not a day');
  });

  test('says a date back with its weekday', () => {
    assert.strictEqual(describeTaskDate('2026-09-25'), 'Friday 2026-09-25');
  });
});
