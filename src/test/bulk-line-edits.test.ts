import * as assert from 'assert';

import { findLineTags, readTagKey, removeTagFromLine, replaceTagOnLine } from '../domain/markdown/tagLineEdits';
import { shiftTaskDates } from '../domain/markdown/taskLineEdits';

suite('Line edits a bulk edit makes', () => {
  test('shifts each chosen date a task writes, in place and in its own form', () => {
    const fields = ['due', 'scheduled', 'start'] as const;
    assert.strictEqual(
      shiftTaskDates('- [ ] Call Ren 📅 2026-10-30 ⏳ 2026-10-28 ^call', 3, { days: 3, fields }),
      '- [ ] Call Ren 📅 2026-11-02 ⏳ 2026-10-31 ^call',
    );
    assert.strictEqual(
      shiftTaskDates('- [ ] Call Ren [due:: 2026-11-01] (start:: 2026-10-30)', 3, { days: -2, fields }),
      '- [ ] Call Ren [due:: 2026-10-30] (start:: 2026-10-28)',
      'both bracket forms move, earlier for a negative shift',
    );
    assert.strictEqual(
      shiftTaskDates('- [ ] Call Ren 📅 2026-10-30 🛫 2026-10-28', 3, { days: 7, fields: ['start'] }),
      '- [ ] Call Ren 📅 2026-10-30 🛫 2026-11-04',
      'only the dates chosen move',
    );
    assert.strictEqual(
      shiftTaskDates('- [ ] Call Ren 📅 2026-12-30', 3, { days: 5, fields }),
      '- [ ] Call Ren 📅 2027-01-04',
      'a shift crosses a year',
    );
    assert.strictEqual(
      shiftTaskDates('- [x] Call Ren on 2026-10-30 ✅ 2026-10-29', 3, { days: 1, fields }),
      '- [x] Call Ren on 2026-10-30 ✅ 2026-10-29',
      'a date in the words, and the done date, are not moved',
    );
  });

  test('reads one tag as its key, and nothing else', () => {
    assert.strictEqual(readTagKey('#Project/Atlas'), '#project/atlas');
    assert.strictEqual(readTagKey(' @dana '), '@dana');
    assert.strictEqual(readTagKey('#a #b'), undefined);
    assert.strictEqual(readTagKey('atlas'), undefined);
  });

  test('takes a tag off a line, with the space before it', () => {
    assert.strictEqual(removeTagFromLine('- [ ] Book #project/atlas the room', '#project/atlas'), '- [ ] Book the room');
    assert.strictEqual(removeTagFromLine('- [ ] Book the room #Project/Atlas ^room', '#project/atlas'), '- [ ] Book the room ^room');
    assert.strictEqual(removeTagFromLine('- [ ] #a Book the room', '#a'), '- [ ] Book the room', 'a tag first in the words');
    assert.strictEqual(removeTagFromLine('#a starts the line', '#a'), 'starts the line');
    assert.strictEqual(removeTagFromLine('## Decision #risk/vendor ##', '#risk/vendor'), '## Decision ##', 'a heading keeps its closing hashes');
    assert.strictEqual(removeTagFromLine('- [ ] Call #a, then #a again', '#a'), '- [ ] Call, then again', 'every writing of it');
    assert.strictEqual(removeTagFromLine('- [ ] Book the room #project/atlas-old', '#project/atlas'), '- [ ] Book the room #project/atlas-old', 'a longer tag is another tag');
    assert.strictEqual(removeTagFromLine('- [ ] Read `#a` aloud', '#a'), '- [ ] Read `#a` aloud', 'code is not a tag');
    assert.strictEqual(removeTagFromLine('- [ ] Book the room', '#a'), '- [ ] Book the room');
  });

  test('a person in the 👤 field is the field, not a tag to take off', () => {
    assert.deepStrictEqual(findLineTags('- [ ] Chase @ren 👤 @dana').map((tag) => tag.key), ['@ren']);
    assert.strictEqual(removeTagFromLine('- [ ] Chase @dana 👤 @dana', '@dana'), '- [ ] Chase 👤 @dana');
    assert.strictEqual(removeTagFromLine('- [ ] Chase it [assignee:: @dana]', '@dana'), '- [ ] Chase it [assignee:: @dana]');
  });

  test('writes another tag where one is written', () => {
    assert.strictEqual(replaceTagOnLine('- [ ] Book #context/phone the room', '#context/phone', '#context/computer'), '- [ ] Book #context/computer the room');
    assert.strictEqual(
      replaceTagOnLine('- [ ] Call #a then #a', '#a', '#b'),
      '- [ ] Call #b then',
      'the first takes its place and the rest go',
    );
    assert.strictEqual(
      replaceTagOnLine('- [ ] Call #a #b', '#a', '#b'),
      '- [ ] Call #b',
      'a line that has the new tag only loses the old one',
    );
    assert.strictEqual(replaceTagOnLine('- [ ] Call #c', '#a', '#b'), '- [ ] Call #c', 'a line without it is left alone');
    assert.strictEqual(replaceTagOnLine('- [ ] Call #a', '#a', 'not a tag'), '- [ ] Call #a');
    assert.strictEqual(replaceTagOnLine('## Plan #a ##', '#a', '@dana'), '## Plan @dana ##');
  });
});
