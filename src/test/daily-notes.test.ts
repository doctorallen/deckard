import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { findAdjacentDailyNote, listDailyNotes } from '../ui/commands/dailyNote';

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
