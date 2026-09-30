import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { collectTaggedEntries, findBandEntry } from '../domain/markdown/taggedEntries';

suite('Tagged entries', () => {
  test('bands the innermost tagged entry the cursor is in, and nothing outside one', () => {
    const entries = collectTaggedEntries(
      parseMarkdown(
        'notes/atlas.md',
        [
          '# Atlas #project/atlas', // 1
          'Why it matters.', // 2
          '- [ ] Call Ren #risk/vendor', // 3
          '- [ ] Book the room', // 4
          '', // 5
          '# Untagged', // 6
          'Nothing here.', // 7
        ].join('\n'),
      ),
    );
    assert.deepStrictEqual(
      entries.map((entry) => [entry.startLine, entry.endLine]),
      [[1, 5], [3, 3], [4, 4]],
      'the tagged section and its tasks, which carry its tag, not the untagged section',
    );
    assert.strictEqual(findBandEntry(entries, 3)?.title.trim(), 'Call Ren #risk/vendor');
    assert.strictEqual(findBandEntry(entries, 2)?.startLine, 1, 'the section around the line');
    assert.strictEqual(findBandEntry(entries, 7), undefined);
  });

  test('of two entries alike in span, the band takes the later one', () => {
    const entries = [
      { startLine: 1, endLine: 4, title: 'first' },
      { startLine: 2, endLine: 5, title: 'second' },
    ];
    assert.strictEqual(findBandEntry(entries, 3)?.title, 'second');
    assert.strictEqual(findBandEntry(entries, 1)?.title, 'first');
    assert.strictEqual(findBandEntry([], 1), undefined);
  });
});
