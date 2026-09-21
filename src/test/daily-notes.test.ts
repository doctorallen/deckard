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
    assert.deepStrictEqual(findPeriodicNoteNames('week', sunday), [
      'week-2026-09-13-2026-09-19',
      '2026-W38',
    ], 'the ISO week of the Monday this row holds');
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
});
