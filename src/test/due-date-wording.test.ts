import * as assert from 'assert';

import { describeDueDate } from '../core/markdown/taskMetadata';

/**
 * A due date is read for its distance from today, and cited by its date, so
 * a row writes both: the distance in words, then the date. The word
 * "overdue" is in the text, never left to a colour.
 */
suite('Due date wording', () => {
  const day = (date: number, hour = 9): number =>
    new Date(2026, 8, date, hour).getTime();
  const now = day(23, 14);

  test('says how far from today a date is, then the date', () => {
    assert.strictEqual(describeDueDate(day(23), now).label, 'due today · 2026-09-23');
    assert.strictEqual(describeDueDate(day(24), now).label, 'due tomorrow · 2026-09-24');
    assert.strictEqual(describeDueDate(day(26), now).label, 'due in 3 days · 2026-09-26');
    assert.strictEqual(describeDueDate(day(22), now).label, 'overdue 1 day · 2026-09-22');
    assert.strictEqual(describeDueDate(day(8), now).label, 'overdue 15 days · 2026-09-08');
  });

  test('counts calendar days, whatever the hour', () => {
    assert.strictEqual(describeDueDate(day(24, 0), day(23, 23)).days, 1, 'late tonight to early tomorrow is one day');
    assert.strictEqual(describeDueDate(day(23, 23), day(23, 0)).days, 0, 'any time today is today');
  });

  test('leaves the distance to the date beyond a month', () => {
    const description = describeDueDate(new Date(2026, 11, 1).getTime(), now);
    assert.strictEqual(description.label, 'due 2026-12-01');
    assert.strictEqual(description.overdue, false);
    const slipped = describeDueDate(new Date(2026, 5, 1).getTime(), now);
    assert.strictEqual(slipped.label, 'overdue · 2026-06-01', 'but still says it is overdue');
    assert.strictEqual(slipped.overdue, true);
  });

  test('keeps the date as the task wrote it', () => {
    assert.strictEqual(describeDueDate(day(8), now, '2026-09-08').label, 'overdue 15 days · 2026-09-08');
    assert.strictEqual(describeDueDate(day(8), now, 'Sep 8').label, 'overdue 15 days · Sep 8');
  });
});
