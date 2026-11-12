import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { applySplices } from '../domain/markdown/moveLines';
import { parseMarkdown } from '../domain/markdown/parser';
import {
  formatSectionLink,
  listMentionedPlaces,
  MAX_MENTIONED_PLACES,
  nestingShift,
  placeSection,
  readSectionBlock,
  shiftHeadings,
} from '../domain/notes/moveSection';
import { lineOffsets } from '../domain/markdown/moveLines';

const lines = (...text: string[]): string => text.join('\n');
const cursor = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 }, isEmpty: true });
const select = (from: [number, number], to: [number, number]) => ({
  start: { line: from[0], character: from[1] },
  end: { line: to[0], character: to[1] },
  isEmpty: false,
});

/** `content` with an insertion applied, as MoveService splices it. */
function insert(content: string, at: { line: number; character: number; text: string }): string {
  const offset = lineOffsets(content)[at.line] + at.character;
  return applySplices(content, [{ start: offset, end: offset, text: at.text }]);
}

suite('Moving a section', () => {
  const day = [
    '---',
    'tags: [daily]',
    '---',
    '# 2026-11-12',
    '',
    '## Standup',
    '- Nothing blocked',
    '',
    '## Ledger cutover plan',
    'Talked with @dana about #project/ledger.',
    '',
    '### Steps',
    '- [ ] Freeze writes',
    '```sh',
    '# not a heading',
    '```',
    '',
    '## Lunch',
    '- Tacos',
  ];

  test('takes the heading at the cursor and everything under it, to the next heading at its level', () => {
    const block = readSectionBlock(day, cursor(8));
    assert.ok(block);
    assert.deepStrictEqual([block.start, block.end], [8, 15], 'the blank line before Lunch stays');
    assert.deepStrictEqual(block.section, { level: 2, heading: 'Ledger cutover plan' });
    assert.strictEqual(block.listItem, false);
    assert.deepStrictEqual(readSectionBlock(day, cursor(11))?.lines, ['### Steps', '- [ ] Freeze writes', '```sh', '# not a heading', '```']);
    assert.deepStrictEqual(readSectionBlock(day, cursor(17))?.lines, ['## Lunch', '- Tacos'], 'the last section runs to the end');
  });

  test('takes the section a selection starts on, whatever its end', () => {
    assert.deepStrictEqual(readSectionBlock(day, select([8, 3], [18, 2]))?.lines.length, 8);
    assert.deepStrictEqual(readSectionBlock(day, select([8, 0], [9, 4]))?.end, 15);
  });

  test('takes nothing from a line that is not a heading, or is one only in looks', () => {
    assert.strictEqual(readSectionBlock(day, cursor(9)), undefined, 'a line of text');
    assert.strictEqual(readSectionBlock(day, cursor(14)), undefined, 'inside a code block');
    assert.strictEqual(readSectionBlock(['---', '# title', '---', 'Text'], cursor(1)), undefined, 'inside front matter');
    assert.strictEqual(readSectionBlock(day, select([7, 0], [9, 0])), undefined, 'a selection that starts above it');
  });

  test('nests under a heading one level deeper, shifting every subheading alike, none past ######', () => {
    assert.strictEqual(nestingShift(2, 2), 1);
    assert.strictEqual(nestingShift(3, 1), -1);
    const section = ['## Ledger cutover plan', 'Text', '### Steps', '```', '## kept in code', '```', '#### Detail', '#tag is not a heading'];
    assert.deepStrictEqual(shiftHeadings(section, nestingShift(2, 2)), [
      '### Ledger cutover plan',
      'Text',
      '#### Steps',
      '```',
      '## kept in code',
      '```',
      '##### Detail',
      '#tag is not a heading',
    ]);
    assert.deepStrictEqual(shiftHeadings(['## Plan', '#### Deep', '###### Deepest  ##'], nestingShift(2, 5)), [
      '###### Plan',
      '###### Deep',
      '###### Deepest  ##',
    ]);
    assert.deepStrictEqual(shiftHeadings(['### Up', '#### Under'], -2), ['# Up', '## Under']);
    assert.deepStrictEqual(shiftHeadings(['## Same'], 0), ['## Same']);
  });

  test('lands at the end of the heading’s section, before the next heading at its level, after a blank line', () => {
    const migration = lines('# Ledger migration', '', '## Plan', '- Freeze writes', '', '### Owners', '- Dana', '', '## Risks', '- None yet', '');
    const moved = lines('### Ledger cutover plan', 'Talked with @dana.');
    const placed = placeSection(migration, moved, { startLine: 3, endLine: 8 });
    assert.strictEqual(
      insert(migration, placed),
      lines('# Ledger migration', '', '## Plan', '- Freeze writes', '', '### Owners', '- Dana', '', '### Ledger cutover plan', 'Talked with @dana.', '', '## Risks', '- None yet', ''),
    );
    assert.strictEqual(placed.taskLine, 8);

    const tight = lines('## Plan', '- Freeze writes', '## Risks');
    assert.strictEqual(
      insert(tight, placeSection(tight, '### Moved', { startLine: 1, endLine: 2 })),
      lines('## Plan', '- Freeze writes', '', '### Moved', '', '## Risks'),
      'a blank line on either side',
    );
    const bare = lines('## Plan', '', '## Risks');
    assert.strictEqual(insert(bare, placeSection(bare, '### Moved', { startLine: 1, endLine: 2 })), lines('## Plan', '', '### Moved', '', '## Risks'));
  });

  test('lands at the end of a note after a blank line, with or without a final line break, or alone in an empty note', () => {
    assert.strictEqual(insert('# Today\n- Coffee\n', placeSection('# Today\n- Coffee\n', '## Moved')), '# Today\n- Coffee\n\n## Moved\n');
    assert.strictEqual(insert('# Today\n- Coffee', placeSection('# Today\n- Coffee', '## Moved')), '# Today\n- Coffee\n\n## Moved');
    assert.strictEqual(insert('', placeSection('', '## Moved')), '## Moved\n');
    assert.strictEqual(insert('a\r\n', placeSection('a\r\n', '## Moved')), 'a\r\n\r\n## Moved\r\n');
  });

  test('leaves a link to the heading in its new note, in either link style', () => {
    const link = { heading: 'Ledger cutover plan #project/ledger', sourcePath: 'journal/2026-11-12.md', targetPath: 'Ledger migration.md' };
    assert.strictEqual(formatSectionLink({ ...link, style: 'wiki' }), '[[Ledger migration#Ledger cutover plan]]');
    assert.strictEqual(
      formatSectionLink({ ...link, style: 'markdown' }),
      '[Ledger migration#Ledger cutover plan](../Ledger%20migration.md#ledger-cutover-plan)',
    );
    const named = { heading: 'Ledger cutover plan', sourcePath: 'journal/2026-11-12.md', targetPath: 'Ledger cutover plan.md' };
    assert.strictEqual(formatSectionLink({ ...named, style: 'wiki' }), '[[Ledger cutover plan]]', 'a heading named as its note links the note');
    assert.strictEqual(formatSectionLink({ ...named, style: 'markdown' }), '[Ledger cutover plan](../Ledger%20cutover%20plan.md)');
  });

  suite('Mentioned in this section', () => {
    const notes: Record<string, string> = {
      'journal/2026-11-12.md': lines('# 2026-11-12', '## Ledger cutover plan', 'Talked with @dana about #project/ledger.', 'See [[Vendor contacts]] and [[2026-11-12#Lunch]].', '## Lunch'),
      'Projects/Ledger.md': lines('---', 'describes: "#project/ledger"', '---', '# Ledger', '## Plan', '## Risks'),
      'People/Dana.md': lines('---', 'describes: "@dana"', '---', '# Dana'),
      'Vendor contacts.md': lines('# Vendor contacts', 'Nothing yet.'),
      'Unnamed.md': lines('# Unnamed'),
    };
    const index = buildWorkspaceIndex(new Map(Object.entries(notes).map(([path, text]) => [path, parseMarkdown(path, text)])));
    const section = notes['journal/2026-11-12.md'].split('\n').slice(1, 4);
    const describe = (places: ReturnType<typeof listMentionedPlaces>) =>
      places.map((place) => `${place.filePath}${place.section ? ` › ${place.section.heading}` : ' (end)'}`);

    test('lists the hubs of its tags and people as first written, then the notes it links, each note’s headings and then its end', () => {
      assert.deepStrictEqual(describe(listMentionedPlaces(index, section, { sourcePath: 'journal/2026-11-12.md' })), [
        'People/Dana.md › Dana',
        'People/Dana.md (end)',
        'Projects/Ledger.md › Ledger',
        'Projects/Ledger.md › Plan',
        'Projects/Ledger.md › Risks',
        'Projects/Ledger.md (end)',
        'Vendor contacts.md › Vendor contacts',
        'Vendor contacts.md (end)',
      ]);
    });

    test('leaves out the section’s own note, a tag in code, and a name no note has', () => {
      const own = ['## Plan', 'Back to [[2026-11-12]] and [[Nobody]].', '```', '#project/ledger', '```'];
      assert.deepStrictEqual(listMentionedPlaces(index, own, { sourcePath: 'journal/2026-11-12.md' }), []);
      assert.deepStrictEqual(
        describe(listMentionedPlaces(index, ['## Ledger notes #project/ledger'], { sourcePath: 'Projects/Ledger.md' })),
        [],
        'a hub’s own section is not offered its hub',
      );
    });

    test('lists at most ten places', () => {
      const many = Object.fromEntries(
        Array.from({ length: 4 }, (_, n) => [`Note ${n}.md`, lines(`# Note ${n}`, '## One', '## Two')]),
      );
      const big = buildWorkspaceIndex(new Map(Object.entries(many).map(([path, text]) => [path, parseMarkdown(path, text)])));
      const places = listMentionedPlaces(big, ['## Links', '[[Note 0]] [[Note 1]] [[Note 2]] [[Note 3]]'], { sourcePath: 'day.md' });
      assert.strictEqual(places.length, MAX_MENTIONED_PLACES);
      assert.deepStrictEqual(describe(places).slice(-2), ['Note 2.md › Note 2', 'Note 2.md › One']);
    });
  });
});
