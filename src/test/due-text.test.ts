import * as assert from 'assert';

import { describeDueDate } from '../domain/markdown/dueWording';
import { splitDueLabel } from '../webview/shared/dueParts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 4, 12).getTime();
const POLICY = { needsNewDateAfterDays: 60 };

suite('Due dates in their parts, for Display\'s Dates preference', () => {
  test('every wording the host gives splits back into the label it came from', () => {
    for (let days = -70; days <= 70; days += 1) {
      const { label } = describeDueDate(NOW + days * DAY, NOW, POLICY);
      const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
      for (const written of [label, capitalized]) {
        const parts = splitDueLabel(written);
        const joined = parts.date ? `${parts.state}${parts.distance} · ${parts.date}` : parts.state;
        assert.strictEqual(joined, written, `${days} days`);
      }
    }
  });

  test('an overdue date keeps "Overdue" as its state, never as its distance', () => {
    for (let days = -59; days < 0; days += 1) {
      const { label } = describeDueDate(NOW + days * DAY, NOW, POLICY);
      assert.match(splitDueLabel(label.charAt(0).toUpperCase() + label.slice(1)).state, /^Overdue$/, `${days} days`);
    }
  });

  test('the parts of each kind of wording', () => {
    assert.deepStrictEqual(splitDueLabel('Overdue 15 days · 2026-09-19'), { state: 'Overdue', distance: ' 15 days', date: '2026-09-19' });
    assert.deepStrictEqual(splitDueLabel('Due in 3 days · 2026-10-07'), { state: 'Due', distance: ' in 3 days', date: '2026-10-07' });
    assert.deepStrictEqual(splitDueLabel('Due tomorrow · 2026-10-05'), { state: 'Due', distance: ' tomorrow', date: '2026-10-05' });
    assert.deepStrictEqual(splitDueLabel('Due today · 2026-10-04'), { state: 'Due today', distance: '', date: '2026-10-04' });
    assert.deepStrictEqual(splitDueLabel('Overdue · 2026-08-01'), { state: 'Overdue', distance: '', date: '2026-08-01' });
    assert.deepStrictEqual(splitDueLabel('Due 2026-12-25'), { state: 'Due 2026-12-25', distance: '', date: '' });
    assert.deepStrictEqual(splitDueLabel('Was due 2026-06-01'), { state: 'Was due 2026-06-01', distance: '', date: '' });
  });
});
