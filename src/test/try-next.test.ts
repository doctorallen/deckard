import * as assert from 'assert';

import { chooseTryNext, TRY_NEXT_SNOOZE_MS, TryNextInput } from '../ui/state/tryNext';

/** Sunday 2026-10-04, the first day of a Sunday week. */
const sunday = new Date(2026, 9, 4, 9).getTime();

const quiet: TryNextInput = {
  weekStart: 0,
  dailyNoteDates: [],
  hasLastWeekNote: false,
  openTasks: 0,
  hasPins: false,
};

const lastWeek = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03'];

suite('Try next', () => {
  test('suggests nothing when nothing applies', () => {
    assert.strictEqual(chooseTryNext(quiet, new Set(), {}, sunday), undefined);
  });

  test('a review, on the week\'s first day after five daily notes and no weekly note', () => {
    const input = { ...quiet, dailyNoteDates: lastWeek };
    assert.deepStrictEqual(chooseTryNext(input, new Set(), {}, sunday), {
      id: 'weeklyReview',
      key: 'weeklyReview',
      text: 'You wrote 6 daily notes last week. A review lists what you finished and what is still open.',
      action: { label: 'Write a review' },
    });
    assert.strictEqual(chooseTryNext({ ...input, hasLastWeekNote: true }, new Set(), {}, sunday), undefined);
    assert.strictEqual(chooseTryNext({ ...input, dailyNoteDates: lastWeek.slice(0, 4) }, new Set(), {}, sunday), undefined);
    assert.strictEqual(chooseTryNext(input, new Set(), {}, sunday + 24 * 60 * 60 * 1000), undefined, 'not on Monday');
    assert.strictEqual(chooseTryNext({ ...input, weekStart: 1 }, new Set(), {}, sunday), undefined, 'the week follows weekStart');
  });

  test('a merge for two tags that look alike, retired per pair', () => {
    const input = {
      ...quiet,
      lookalike: { sourceKey: '#person/mara-vle', sourceLabel: '#person/mara-vle', targetKey: '#person/mara-vale', targetLabel: '#person/mara-vale' },
    };
    const merge = chooseTryNext(input, new Set(), {}, sunday);
    assert.strictEqual(merge?.text, '#person/mara-vle looks like #person/mara-vale. Merging rewrites every note that uses it.');
    assert.strictEqual(merge?.key, 'mergeLookalike:#person/mara-vle|#person/mara-vale');
    assert.strictEqual(chooseTryNext(input, new Set([merge.key]), {}, sunday), undefined);
    const other = { ...input, lookalike: { ...input.lookalike, sourceKey: '#a', sourceLabel: '#a' } };
    assert.ok(chooseTryNext(other, new Set([merge.key]), {}, sunday), 'another pair is still offered');
  });

  test('the Task board at ten open tasks, and a pin for a note opened often', () => {
    assert.strictEqual(chooseTryNext({ ...quiet, openTasks: 9 }, new Set(), {}, sunday), undefined);
    assert.strictEqual(chooseTryNext({ ...quiet, openTasks: 42 }, new Set(), {}, sunday)?.text, 'You have 42 open tasks. The Task board lays them out by status, and a drag rewrites the task.');
    const note = { filePath: 'Harbor.md', title: 'Harbor', line: 1, opens: 5 };
    assert.strictEqual(chooseTryNext({ ...quiet, frequentNote: note }, new Set(), {}, sunday)?.text, 'You open Harbor often. Pin it to Home to keep it one click away.');
    assert.strictEqual(chooseTryNext({ ...quiet, frequentNote: { ...note, opens: 4 } }, new Set(), {}, sunday), undefined);
    assert.strictEqual(chooseTryNext({ ...quiet, frequentNote: note, hasPins: true }, new Set(), {}, sunday), undefined);
  });

  test('the first that applies wins, and a retired or put-off one is skipped until it lapses', () => {
    const input = { ...quiet, dailyNoteDates: lastWeek, openTasks: 42 };
    assert.strictEqual(chooseTryNext(input, new Set(), {}, sunday)?.id, 'weeklyReview');
    assert.strictEqual(chooseTryNext(input, new Set(['weeklyReview']), {}, sunday)?.id, 'taskBoard');
    const snoozed = { weeklyReview: sunday + TRY_NEXT_SNOOZE_MS };
    assert.strictEqual(chooseTryNext(input, new Set(), snoozed, sunday)?.id, 'taskBoard');
    const later = { ...input, dailyNoteDates: [] };
    assert.strictEqual(
      chooseTryNext(later, new Set(), { taskBoard: sunday + TRY_NEXT_SNOOZE_MS }, sunday + TRY_NEXT_SNOOZE_MS + 1)?.id,
      'taskBoard',
      'a week later it is back',
    );
  });
});
