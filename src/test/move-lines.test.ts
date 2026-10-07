import * as assert from 'assert';

import {
  applySplices,
  blockSplice,
  dedentBlock,
  leaveBehind,
  MoveBlock,
  readMoveBlock,
} from '../domain/markdown/moveLines';
import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { readSectionTarget, suggestNoteName } from '../ui/commands/moveTo';
import { validateExtractedNoteName } from '../ui/commands/extractHeading';

const cursor = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 }, isEmpty: true });
const select = (from: [number, number], to: [number, number]) => ({
  start: { line: from[0], character: from[1] },
  end: { line: to[0], character: to[1] },
  isEmpty: false,
});
const block = (lines: string[], selection: ReturnType<typeof cursor>): MoveBlock => {
  const read = readMoveBlock(lines, selection);
  assert.ok(!('refused' in read), JSON.stringify(read));
  return read as MoveBlock;
};

suite('What Move to… moves', () => {
  const note = [
    '# Day',
    '- [ ] Call Ren 📅 2026-09-20',
    '    - [ ] Find the number',
    '        - [ ] Ask Dana',
    '',
    '    - [ ] Book a room',
    '- [ ] Next task',
    'A line of prose.',
    '',
  ];

  test('the cursor on a task takes it and its nested steps, blank lines between included', () => {
    assert.deepStrictEqual([block(note, cursor(1)).start, block(note, cursor(1)).end], [1, 5]);
    assert.deepStrictEqual([block(note, cursor(2)).start, block(note, cursor(2)).end], [2, 3]);
    assert.deepStrictEqual([block(note, cursor(7)).start, block(note, cursor(7)).end], [7, 7]);
  });

  test('a selection ending at the start of a line leaves it, and one ending on an item takes its children', () => {
    const upTo = block(note, select([6, 0], [7, 0]));
    assert.deepStrictEqual([upTo.start, upTo.end], [6, 6]);
    const items = block(note, select([1, 0], [1, 5]));
    assert.deepStrictEqual([items.start, items.end], [1, 5]);
  });

  test('refuses a heading, a blank line, front matter, and a fence cut in two', () => {
    assert.deepStrictEqual(readMoveBlock(note, cursor(0)), { refused: 'heading' });
    assert.deepStrictEqual(readMoveBlock(note, cursor(4)), { refused: 'blank' });
    assert.deepStrictEqual(readMoveBlock(['---', 'tags: [a]', '---', 'Text'], cursor(1)), { refused: 'frontMatter' });
    assert.deepStrictEqual(
      readMoveBlock(['Text', '```', 'code', '```', 'After'], select([0, 0], [2, 2])),
      { refused: 'splitFence' },
    );
    assert.ok(!('refused' in readMoveBlock(['Text', '```', 'code', '```', 'After'], select([0, 0], [3, 3]))));
  });

  test('refuses a heading as the parser reads one: hashes alone, and up to three spaces in', () => {
    for (const heading of ['#', '##', '# ', '   # Plan']) {
      assert.deepStrictEqual(readMoveBlock(['Text', heading, 'More'], cursor(1)), { refused: 'heading' }, JSON.stringify(heading));
      assert.deepStrictEqual(
        readMoveBlock(['Text', heading, 'More'], select([0, 0], [2, 2])),
        { refused: 'heading' },
        `${JSON.stringify(heading)} inside a block`,
      );
    }
    assert.ok(!('refused' in readMoveBlock(['#tag line', 'More'], cursor(0))), 'a tag is not a heading');
  });

  test('a task left behind is marked [>] with a link to where it went', () => {
    const moved = block(note, cursor(1));
    assert.deepStrictEqual(leaveBehind(moved, note, '2026-09-25'), [
      '- [>] Call Ren 📅 2026-09-20 → [[2026-09-25]]',
    ]);
    const two = block(note, select([1, 0], [6, 4]));
    assert.strictEqual(leaveBehind(two, note, 'Atlas#Next').length, 2);
    assert.deepStrictEqual(leaveBehind(block(note, cursor(7)), note, 'Atlas#Next'), ['[[Atlas#Next]]']);
    const mixed = block(note, select([6, 0], [7, 3]));
    assert.deepStrictEqual(leaveBehind(mixed, note, 'Atlas'), ['- [[Atlas]]']);
  });

  test('a forwarded task is neither a task nor a note on a tag\'s page', () => {
    const parsed = parseMarkdown('a.md', '# Day\n- [>] Call Ren #project/atlas → [[2026-09-25]]\n');
    assert.strictEqual(parsed.tasks.length, 0);
    assert.strictEqual(parsed.sections.filter((section) => section.isInline).length, 0);
    assert.deepStrictEqual(parsed.sections[0].bodyTags ?? [], []);
  });

  test('takes off the first line\'s indentation, spaces or tabs', () => {
    assert.deepStrictEqual(dedentBlock(['    - [ ] a', '        - [ ] b', 'c']), ['- [ ] a', '    - [ ] b', 'c']);
    assert.deepStrictEqual(dedentBlock(['\t- a', '\t\t- b']), ['- a', '\t- b']);
  });

  test('takes the block out and puts it back in one note, up or down, with CRLF kept', () => {
    const text = '# A\r\n- one\r\n- two\r\n# B\r\n- three\r\n';
    const lines = text.split(/\r?\n/);
    const moved = block(lines, cursor(1));
    const out = blockSplice(text, moved, ['- [[B]]']);
    const at = text.indexOf('- three\r\n') + '- three\r\n'.length;
    assert.strictEqual(
      applySplices(text, [out, { start: at, end: at, text: '- one\r\n' }]),
      '# A\r\n- [[B]]\r\n- two\r\n# B\r\n- three\r\n- one\r\n',
    );
    const last = '# A\n- one\n- two';
    const tail = block(last.split('\n'), cursor(2));
    assert.strictEqual(applySplices(last, [blockSplice(last, tail, [])]), '# A\n- one');
  });

  test('names a new note from the first eight words of the line', () => {
    assert.strictEqual(suggestNoteName('- [ ] Ask about the #project/atlas budget before the end of the month 📅 2026-10-02'), 'Ask about the budget before the end of');
    assert.strictEqual(suggestNoteName('Budget questions'), 'Budget questions');
  });

  test('suggests a new note name the link left behind can open', () => {
    for (const line of ['- [ ] Plan [draft] for Q3', 'Notes on a^b and [x]', '- Issue #42 follow-up']) {
      const name = suggestNoteName(line);
      assert.strictEqual(validateExtractedNoteName(name), undefined, `${line} → ${name}`);
    }
    assert.strictEqual(suggestNoteName('- [ ] Plan [draft] for Q3'), 'Plan draft for Q3');
  });

  test('suggests a name without the dot a sentence ends in, which no file name can end in', () => {
    for (const line of ['- [ ] Fix the roof.', 'Call the bank...', '- Ask Dana. ?']) {
      const name = suggestNoteName(line);
      assert.strictEqual(validateExtractedNoteName(name), undefined, `${line} → ${name}`);
    }
    assert.strictEqual(suggestNoteName('- [ ] Fix the roof.'), 'Fix the roof');
    assert.strictEqual(suggestNoteName('Version 2.1 notes'), 'Version 2.1 notes', 'a dot inside the name stays');
  });

  test('says a name may not end in a dot, when the box refuses one', () => {
    assert.match(validateExtractedNoteName('Fix the roof.') ?? '', /not ending in a dot/);
  });

  test('links to the heading chosen even after the index has read its note again', () => {
    const before = parseMarkdown('plan.md', '# Plan\n\n## Calls\n- [ ] Ren\n');
    const chosen = before.sections.find((section) => section.heading === 'Calls');
    assert.ok(chosen);
    // Saved with a line above the heading while the picker was open, and read again.
    const now = parseMarkdown('plan.md', '# Plan\nA line added.\n\n## Calls\n- [ ] Ren\n');
    const index = buildWorkspaceIndex(new Map([[now.filePath, now]]));
    assert.ok(!index.sections.has(chosen.id), 'the heading as it was chosen is gone from the index');
    const target = readSectionTarget(index, 'plan.md', chosen, now.sections);
    assert.strictEqual(target?.section.startLine, 4);
    assert.strictEqual(target?.link, 'plan#Calls', 'the link left behind names the heading');
  });

  test('remembers the heading chosen, not the one at its old line, after the index has read its note again', () => {
    const before = parseMarkdown('plan.md', '# Plan\n\n## Calls\n- [ ] Ren\n');
    const chosen = before.sections.find((section) => section.heading === 'Calls');
    assert.ok(chosen);
    const now = parseMarkdown('plan.md', '# Plan\nA line added.\n\n## Calls\n- [ ] Ren\n');
    const index = buildWorkspaceIndex(new Map([[now.filePath, now]]));
    assert.deepStrictEqual(readSectionTarget(index, 'plan.md', chosen, now.sections)?.recent, {
      filePath: 'plan.md',
      heading: 'Calls',
      headingLevel: 2,
      occurrence: 0,
    });
  });
});
