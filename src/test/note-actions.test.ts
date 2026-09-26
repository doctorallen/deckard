import * as assert from 'assert';

import { buildNoteActionItems, NoteActionState } from '../ui/commands/noteActions';
import { isDailyNoteText, readTopHeadings } from '../ui/commands/activeNoteContext';

const target = { uri: 'file:///notes/atlas.md', line: 4 };

function labels(state: Partial<NoteActionState>): string[] {
  return buildNoteActionItems(
    { onTaskLine: false, pinned: false, inTaggedEntry: false, underHeading: false, ...state },
    target,
  ).map((item) => `${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
}

suite('Note Actions', () => {
  test('lists the task first on a task line', () => {
    assert.deepStrictEqual(labels({ onTaskLine: true }), [
      '$(check) Toggle Task Done',
      '$(edit) Edit Task…',
      '$(references) Open Related Notes',
      '$(type-hierarchy) Open Notes Graph Around This Note',
      '$(arrow-right) Move to…',
      '$(pin) Pin Note to Home',
    ]);
  });

  test('offers Add Task elsewhere, and Unpin on a pinned note', () => {
    assert.deepStrictEqual(labels({ pinned: true }), [
      '$(add) Add Task…',
      '$(references) Open Related Notes',
      '$(type-hierarchy) Open Notes Graph Around This Note',
      '$(arrow-right) Move to…',
      '$(pinned) Unpin Note from Home',
    ]);
  });

  test('opens Related Notes for the heading only inside a tagged entry', () => {
    const [, related] = buildNoteActionItems(
      { onTaskLine: false, pinned: false, inTaggedEntry: true, underHeading: true },
      target,
    );
    assert.strictEqual(related.detail, 'For the heading the cursor is in');
    assert.strictEqual(related.command, 'deckard.showEntryRelatedNotes');
    assert.deepStrictEqual(related.args, [target.uri, target.line]);
    const [, plain] = buildNoteActionItems(
      { onTaskLine: false, pinned: false, inTaggedEntry: false, underHeading: true },
      target,
    );
    assert.strictEqual(plain.command, 'deckard.relatedNotes.focus');
    assert.strictEqual(plain.detail, undefined);
  });
});

suite('Active note context', () => {
  test('reads a daily note from its file name or its first heading', () => {
    assert.strictEqual(isDailyNoteText('journal/2026-09-25.md', ['Anything']), true);
    assert.strictEqual(isDailyNoteText('journal/friday.md', ['# Friday 2026-09-25']), true);
    assert.strictEqual(isDailyNoteText('Atlas.md', ['# Atlas', '', 'Due 2026-09-25']), false);
  });

  test('takes only top headings outside front matter and fences', () => {
    assert.deepStrictEqual(
      readTopHeadings([
        '---',
        '# not a heading: 2026-01-01',
        '---',
        '# Plan',
        '```',
        '# 2026-09-25',
        '```',
        '## Sub',
      ]),
      ['Plan'],
    );
  });
});
