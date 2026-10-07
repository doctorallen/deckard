import * as assert from 'assert';

import { findPeriodicNoteNames, getPeriodicNote } from '../domain/notes/periodicNotes';
import { listSlashChoices } from '../domain/markdown/slashMenu';
import { fillPeriodicFolder } from '../ui/commands/dailyNote';

suite('Periodic notes where you keep them', () => {
  const day = new Date(2026, 8, 16);

  test('a week is named by its days, and found by its ISO week too', () => {
    assert.strictEqual(getPeriodicNote('week', day, 0).name, 'week-2026-09-13-2026-09-19');
    const names = findPeriodicNoteNames('week', day, 0);
    assert.strictEqual(names[0], 'week-2026-09-13-2026-09-19');
    assert.ok(names.includes('2026-W38'), 'an ISO-named note is still found');
  });

  test('a folder pattern takes the year and month of the note', () => {
    assert.strictEqual(fillPeriodicFolder('journal/{yyyy}/{mm}', day), 'journal/2026/09');
    assert.strictEqual(fillPeriodicFolder('', day), '');
  });

  test('the / menu offers the time on this clock and in UTC, when given it', () => {
    const labels = listSlashChoices({ today: '2026-09-16', time: { local: '09:05', utc: '13:05' } }).map((choice) => [choice.label, choice.snippet]);
    assert.deepStrictEqual(labels.filter(([label]) => String(label).startsWith('Time')), [['Time', '09:05$0'], ['Time (UTC)', '13:05 UTC$0']]);
    assert.ok(!listSlashChoices({ today: '2026-09-16' }).some((choice) => choice.label.startsWith('Time')));
  });
});
