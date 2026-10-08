import * as assert from 'assert';

import { buildNoteActionItems, hasHeadingAbove, NoteActionState } from '../ui/commands/noteActions';
import { isDailyNoteText, readTopHeadings } from '../ui/commands/activeNoteContext';

/** The rows Note Actions lists where the cursor is, a separator as `—`. */
function labels(state: Partial<NoteActionState>): string[] {
  return buildNoteActionItems({ onTaskLine: false, pinned: false, parked: false, inTaggedEntry: false, underHeading: false, ...state })
    .map((item) => (item.command ? `${item.label}${item.detail ? ` — ${item.detail}` : ''}` : '—'));
}

suite('Note Actions', () => {
  test('lists the task first on a task line, then the note, then keeping it', () => {
    assert.deepStrictEqual(labels({ onTaskLine: true }), [
      '$(check) Toggle Task Done',
      '$(edit) Edit Task',
      '$(circle-large-outline) Set Task Status…',
      '$(list-ordered) Break into Steps…',
      '$(add) Add Task',
      '—',
      '$(preview) Open Note as Page',
      '$(references) Open Related Notes',
      '$(type-hierarchy) Open Notes Graph Around This Note',
      '$(arrow-right) Move to…',
      '$(copy) Copy as Plain Markdown',
      '$(tag) Move Inline Tags to Front Matter',
      '—',
      '$(pin) Pin Note to Home',
      '$(archive) Park Note',
    ]);
  });

  test('offers Add Task elsewhere, and Unpin and Unpark on a pinned, parked note', () => {
    assert.deepStrictEqual(labels({ pinned: true, parked: true }).slice(0, 2), ['$(add) Add Task', '—']);
    assert.deepStrictEqual(labels({ pinned: true, parked: true }).slice(-2), ['$(pinned) Unpin Note from Home', '$(inbox) Unpark Note']);
  });

  test('offers the heading\'s actions under a heading', () => {
    assert.deepStrictEqual(labels({ underHeading: true }).slice(1, 7), [
      '—',
      '$(symbol-text) Rename Heading',
      '$(export) Extract Heading',
      '$(person) Tag Heading with a Person or Project…',
      '$(target) Focus Section',
      '—',
    ]);
  });

  test('finds a heading above the cursor as the parser reads one', () => {
    const above = (lines: string[], line = lines.length - 1) =>
      hasHeadingAbove({ lineCount: lines.length, lineAt: (at: number) => ({ text: lines[at] }) } as never, line);
    assert.strictEqual(above(['#', 'text']), true, 'hashes alone');
    assert.strictEqual(above(['   ## Plan', 'text']), true, 'up to three spaces in');
    assert.strictEqual(above(['    # Code', 'text']), false, 'four spaces in is code');
    assert.strictEqual(above(['#tag', 'text']), false, 'a tag');
    assert.strictEqual(above(['```', '# not a heading', '```', 'text']), false, 'a line in fenced code');
    assert.strictEqual(above(['# Plan', '```', '# not a heading', 'text']), true, 'the heading above the code');
    const frontMatter = ['---', '# a comment', 'tags: [plan]', '---', 'text'];
    assert.strictEqual(above(frontMatter), false, 'a YAML comment in front matter');
    assert.strictEqual(above(frontMatter, 2), false, 'inside the front matter');
  });

  test('says Related Notes is for the heading only inside a tagged entry', () => {
    const related = (inTaggedEntry: boolean) => buildNoteActionItems(
      { onTaskLine: false, pinned: false, parked: false, inTaggedEntry, underHeading: true },
    ).find((item) => item.command === 'deckard.openRelatedNotes');
    assert.strictEqual(related(true)?.detail, 'For the heading the cursor is in');
    assert.strictEqual(related(false)?.detail, undefined);
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

  test('reads a fence as the parser does: a ``` example inside a ```` fence is still code', () => {
    assert.deepStrictEqual(
      readTopHeadings(['# Guide', '````', '```', '# 2026-09-25', '```', '````', '# After']),
      ['Guide', 'After'],
    );
  });
});
