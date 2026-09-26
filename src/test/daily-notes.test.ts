import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import {
  fillPeriodicTemplate,
  findAdjacentDailyNote,
  findPeriodicNoteNames,
  getIsoWeek,
  getPeriodicNote,
  isPeriodicNoteName,
  listDailyNotes,
} from '../ui/commands/dailyNote';
import { buildDailyNotePicks } from '../ui/commands/dailyNoteForDate';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return {
    files: new Map(
      Object.entries(notes).map(([path, content]) => [path, parseMarkdown(path, content)]),
    ),
    sections: new Map(),
    tasks: new Map(),
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

suite('Daily notes', () => {
  const notes = listDailyNotes(
    indexOf({
      'notes/2026-09-13.md': '# 2026-09-13',
      'journal/2026-09-10.md': '# Thursday',
      'notes/planning.md': '# 2026-09-08\nFrom the heading.',
      'notes/Atlas.md': '# Atlas',
    }),
  );

  test('lists daily notes by their day, oldest first', () => {
    assert.deepStrictEqual(notes, [
      { date: '2026-09-08', filePath: 'notes/planning.md' },
      { date: '2026-09-10', filePath: 'journal/2026-09-10.md' },
      { date: '2026-09-13', filePath: 'notes/2026-09-13.md' },
    ]);
  });

  test('steps to the nearest daily note, skipping days without one', () => {
    assert.strictEqual(findAdjacentDailyNote(notes, '2026-09-13', 'previous')?.date, '2026-09-10');
    assert.strictEqual(findAdjacentDailyNote(notes, '2026-09-10', 'next')?.date, '2026-09-13');
    assert.strictEqual(
      findAdjacentDailyNote(notes, '2026-09-11', 'previous')?.date,
      '2026-09-10',
      'from a day without a note',
    );
    assert.strictEqual(findAdjacentDailyNote(notes, '2026-09-08', 'previous'), undefined);
    assert.strictEqual(findAdjacentDailyNote(notes, '2026-09-13', 'next'), undefined);
  });
});

suite('Weekly and monthly notes', () => {
  test('numbers weeks as ISO weeks, across the turn of a year', () => {
    assert.deepStrictEqual(getIsoWeek(new Date(2026, 8, 13)), { year: 2026, week: 37 });
    assert.deepStrictEqual(getIsoWeek(new Date(2026, 8, 7)), { year: 2026, week: 37 });
    assert.deepStrictEqual(
      getIsoWeek(new Date(2027, 0, 1)),
      { year: 2026, week: 53 },
      'the first Friday of 2027 is in the last week of 2026',
    );
    assert.deepStrictEqual(
      getIsoWeek(new Date(2024, 11, 30)),
      { year: 2025, week: 1 },
      'the last Monday of 2024 starts the first week of 2025',
    );
  });

  test("names each period's note for the days it holds", () => {
    // A week runs Sunday to Saturday, as the Calendar draws it.
    const sunday = new Date(2026, 8, 13);
    assert.deepStrictEqual(getPeriodicNote('week', sunday), {
      name: 'week-2026-09-13-2026-09-19',
      variables: {
        date: '2026-09-13',
        week: '2026-09-13 to 2026-09-19',
        month: 'September 2026',
      },
    });
    assert.deepStrictEqual(getPeriodicNote('week', new Date(2026, 8, 17)), {
      name: 'week-2026-09-13-2026-09-19',
      variables: {
        date: '2026-09-13',
        week: '2026-09-13 to 2026-09-19',
        month: 'September 2026',
      },
    }, 'every day of a week names the same note');
    assert.deepStrictEqual(getPeriodicNote('month', sunday), {
      name: 'month-september-2026',
      variables: {
        date: '2026-09-01',
        week: '2026-09-01 to 2026-09-30',
        month: 'September 2026',
      },
    });
    assert.strictEqual(getPeriodicNote('day', sunday).name, '2026-09-13');
    assert.strictEqual(
      fillPeriodicTemplate('# {week}\nFrom {date}, in {month}. {other}', {
        date: '2026-09-13',
        week: '2026-09-13 to 2026-09-19',
        month: 'September 2026',
      }),
      '# 2026-09-13 to 2026-09-19\nFrom 2026-09-13, in September 2026. {other}',
    );
  });

  test('still answers to the names it wrote before', () => {
    const sunday = new Date(2026, 8, 13);
    const weekNames = findPeriodicNoteNames('week', sunday);
    assert.deepStrictEqual(weekNames.slice(0, 2), [
      'week-2026-09-13-2026-09-19',
      '2026-W38',
    ], 'the ISO week of the Monday this row holds');
    assert.strictEqual(weekNames.length, 8, 'and the week under each other start that holds its middle day');
    assert.ok(weekNames.includes('week-2026-09-14-2026-09-20'));
    assert.deepStrictEqual(findPeriodicNoteNames('month', sunday), [
      'month-september-2026',
      '2026-09',
    ]);
    assert.deepStrictEqual(findPeriodicNoteNames('day', sunday), ['2026-09-13']);

    for (const name of [
      'week-2026-09-13-2026-09-19',
      'month-september-2026',
      '2026-W38',
      '2026-09',
    ]) {
      assert.strictEqual(isPeriodicNoteName(name), true, name);
    }
    for (const name of ['2026-09-13', 'Atlas', 'week-notes', 'month-of-sundays']) {
      assert.strictEqual(isPeriodicNoteName(name), false, name);
    }
  });

  test('the daily note picker lists the days around today, then the newest notes', () => {
    // Friday 2026-09-25, noon.
    const now = new Date(2026, 8, 25, 12).getTime();
    const entries = ['2026-09-10', '2026-09-22', '2026-09-24', '2026-09-25', '2026-09-23'].map((date) => ({
      date,
      filePath: `notes/${date}.md`,
    }));
    const picks = buildDailyNotePicks(entries, '', now);
    assert.deepStrictEqual(
      picks.map((pick) => [pick.label, pick.description ?? '']),
      [
        ['Yesterday', 'Thursday 2026-09-24 · yesterday'],
        ['Today', 'Friday 2026-09-25 · today'],
        ['Tomorrow', 'Saturday 2026-09-26 · tomorrow'],
        ['Recent daily notes', ''],
        ['Wed, Sep 23', '2026-09-23 · 2 days ago'],
        ['Tue, Sep 22', '2026-09-22 · 3 days ago'],
        ['Thu, Sep 10', '2026-09-10 · 15 days ago'],
      ],
    );
    const typed = buildDailyNotePicks(entries, 'last friday', now);
    assert.strictEqual(typed[0].label, '$(calendar) Open daily note for Fri, Sep 18');
    assert.strictEqual(typed[0].description, '2026-09-18 · 7 days ago');
    assert.strictEqual(typed[0].detail, 'Creates it from the daily note template');
    assert.strictEqual(typed[0].date, '2026-09-18');
    const existing = buildDailyNotePicks(entries, '2026-09-22', now);
    assert.strictEqual(existing[0].detail, undefined, 'an existing note is opened, not created');
    const nonsense = buildDailyNotePicks(entries, 'the cat', now);
    assert.deepStrictEqual(nonsense, [
      { label: '$(info) Enter a date such as friday, in 3 days, or 2026-10-02.' },
    ]);
  });

  test('a week starting on Monday is named for its days, and finds the notes written before', () => {
    const monday = new Date(2026, 8, 21, 12);
    assert.strictEqual(getPeriodicNote('week', monday, 1).name, 'week-2026-09-21-2026-09-27');
    const names = findPeriodicNoteNames('week', monday, 1);
    assert.strictEqual(names[0], 'week-2026-09-21-2026-09-27');
    assert.ok(names.includes('week-2026-09-20-2026-09-26'), names.join(', '));
    assert.ok(names.includes('2026-W39'), names.join(', '));
    // And back: a Sunday week finds the Monday note it mostly shares.
    const back = findPeriodicNoteNames('week', new Date(2026, 8, 20, 12), 0);
    assert.ok(back.includes('week-2026-09-21-2026-09-27'), back.join(', '));
    assert.ok(back.includes('2026-W39'), back.join(', '));
  });
});
