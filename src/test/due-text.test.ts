import * as assert from 'assert';

import { describeDueDate } from '../domain/markdown/dueWording';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 4, 12).getTime();
const POLICY = { needsNewDateAfterDays: 60 };

suite('Due dates in their parts, for Display\'s Dates preference', () => {
  test('every wording\'s parts join back into its label', () => {
    for (let days = -70; days <= 70; days += 1) {
      const { label, parts } = describeDueDate(NOW + days * DAY, NOW, POLICY);
      const joined = parts.date ? `${parts.state}${parts.distance} · ${parts.date}` : parts.state;
      assert.strictEqual(joined, label, `${days} days`);
    }
  });

  test('an overdue date keeps "overdue" as its state, never as its distance', () => {
    for (let days = -59; days < 0; days += 1) {
      assert.strictEqual(describeDueDate(NOW + days * DAY, NOW, POLICY).parts.state, 'overdue', `${days} days`);
    }
  });

  test('the parts of each kind of wording', () => {
    const parts = (days: number, policy = POLICY): unknown => describeDueDate(NOW + days * DAY, NOW, policy).parts;
    assert.deepStrictEqual(parts(-15), { state: 'overdue', distance: ' 15 days', date: '2026-09-19' });
    assert.deepStrictEqual(parts(-1), { state: 'overdue', distance: ' 1 day', date: '2026-10-03' });
    assert.deepStrictEqual(parts(3), { state: 'due', distance: ' in 3 days', date: '2026-10-07' });
    assert.deepStrictEqual(parts(1), { state: 'due', distance: ' tomorrow', date: '2026-10-05' });
    assert.deepStrictEqual(parts(0), { state: 'due today', distance: '', date: '2026-10-04' });
    assert.deepStrictEqual(parts(-45), { state: 'overdue', distance: '', date: '2026-08-20' });
    assert.deepStrictEqual(parts(82), { state: 'due 2026-12-25', distance: '', date: '' }, 'beyond a month the date is the state');
    assert.deepStrictEqual(parts(-125, { needsNewDateAfterDays: 30 }), { state: 'was due 2026-06-01', distance: '', date: '' });
  });

  test('the date is given apart from its words, as the label writes it', () => {
    assert.strictEqual(describeDueDate(NOW + 82 * DAY, NOW, POLICY).date, '2026-12-25');
    assert.strictEqual(describeDueDate(NOW - 15 * DAY, NOW, POLICY, { dueText: 'Sep 19' }).date, 'Sep 19');
  });
});
