import * as assert from 'assert';

import { DEFAULT_TASK_POLICY } from '../domain/tasks/taskPolicy';
import { describeDueDate } from '../domain/markdown/dueWording';

/**
 * A due date is read for its distance from today, and cited by its date, so
 * a row writes both: the distance in words, then the date. The word
 * "overdue" is in the text, never left to a color.
 */
suite('Due date wording', () => {
  const day = (date: number, hour = 9): number =>
    new Date(2026, 8, date, hour).getTime();
  const now = day(23, 14);

  test('says how far from today a date is, then the date', () => {
    assert.strictEqual(describeDueDate(day(23), now, DEFAULT_TASK_POLICY).label, 'due today · 2026-09-23');
    assert.strictEqual(describeDueDate(day(24), now, DEFAULT_TASK_POLICY).label, 'due tomorrow · 2026-09-24');
    assert.strictEqual(describeDueDate(day(26), now, DEFAULT_TASK_POLICY).label, 'due in 3 days · 2026-09-26');
    assert.strictEqual(describeDueDate(day(22), now, DEFAULT_TASK_POLICY).label, 'overdue 1 day · 2026-09-22');
    assert.strictEqual(describeDueDate(day(8), now, DEFAULT_TASK_POLICY).label, 'overdue 15 days · 2026-09-08');
  });

  test('counts calendar days, whatever the hour', () => {
    assert.strictEqual(describeDueDate(day(24, 0), day(23, 23), DEFAULT_TASK_POLICY).days, 1, 'late tonight to early tomorrow is one day');
    assert.strictEqual(describeDueDate(day(23, 23), day(23, 0), DEFAULT_TASK_POLICY).days, 0, 'any time today is today');
  });

  test('leaves the distance to the date beyond a month', () => {
    const description = describeDueDate(new Date(2026, 11, 1).getTime(), now, DEFAULT_TASK_POLICY);
    assert.strictEqual(description.label, 'due 2026-12-01');
    assert.strictEqual(description.overdue, false);
    const slipped = describeDueDate(new Date(2026, 5, 1).getTime(), now, { needsNewDateAfterDays: 0 });
    assert.strictEqual(slipped.label, 'overdue · 2026-06-01', 'but still says it is overdue');
    assert.strictEqual(slipped.overdue, true);
  });

  test('a task more than 30 days overdue was due, and is not red', () => {
    const stale = describeDueDate(new Date(2026, 6, 1).getTime(), now, DEFAULT_TASK_POLICY);
    assert.strictEqual(stale.label, 'was due 2026-07-01');
    assert.strictEqual(stale.overdue, false);
    assert.strictEqual(stale.stale, true);
    const month = describeDueDate(new Date(2026, 7, 24).getTime(), now, DEFAULT_TASK_POLICY);
    assert.strictEqual(month.label, 'overdue 30 days · 2026-08-24', 'thirty days is still overdue');
    assert.strictEqual(month.stale, undefined);
  });

  test('keeps the date as the task wrote it', () => {
    assert.strictEqual(describeDueDate(day(8), now, DEFAULT_TASK_POLICY, '2026-09-08').label, 'overdue 15 days · 2026-09-08');
    assert.strictEqual(describeDueDate(day(8), now, DEFAULT_TASK_POLICY, 'Sep 8').label, 'overdue 15 days · Sep 8');
  });
});
