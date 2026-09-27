import * as assert from 'assert';

import { formatExcerpt, readProseLines } from '../core/markdown/proseExcerpt';
import { parseSidebarMessage } from '../ui/webview/messages';

suite('Prose excerpts', () => {
  test('reads only prose, with the Markdown taken off', () => {
    assert.deepStrictEqual(
      readProseLines([
        '---',
        'tags: [daily]',
        '---',
        '# Vendor review #risk/vendor',
        '',
        'Northwind is **late** on the [[Routes|northern route]] #risk/vendor ^q3',
        '#only #tags',
        '| a | b |',
        '---',
        '![](diagram.png)',
        '```',
        'code #project/atlas',
        '```',
        '> Quoted [text](https://example.com) and `code` with @dana.',
        '- A list item about [[Atlas]]',
        '- [ ] A task 📅 2026-10-01 ⏫',
      ].join('\n')),
      [
        'Northwind is late on the northern route',
        'Quoted text and code with.',
        'A list item about Atlas',
      ],
    );
  });

  test('uses task lines only when there is no other prose', () => {
    assert.deepStrictEqual(readProseLines('# Plan\n- [ ] Book the venue 📅 2026-10-01 🔁 every week\n- [x] Pay ✅ 2026-09-01'), [
      'Book the venue',
      'Pay',
    ]);
  });

  test('starts at the first line holding a shared word, and cuts at a word', () => {
    const lines = ['First line.', 'Second line about the northern route.', 'Third.'];
    assert.strictEqual(formatExcerpt(lines), 'First line. Second line about the northern route. Third.');
    assert.strictEqual(formatExcerpt(lines, ['route']), '…Second line about the northern route. Third.');
    assert.strictEqual(formatExcerpt(lines, ['art']), 'First line. Second line about the northern route. Third.', '"art" is not a word start in "starts"');
    const long = formatExcerpt(['word '.repeat(80).trim()]);
    assert.ok(long && long.length <= 240 && long.endsWith('…') && !long.includes('wo…'));
    assert.strictEqual(formatExcerpt([]), undefined);
  });

  test('the sidebar takes 0, 1, or 2 preview lines, and nothing else', () => {
    [0, 1, 2].forEach((lines) =>
      assert.deepStrictEqual(parseSidebarMessage({ type: 'setRelatedNotesPreviewLines', lines }), {
        type: 'setRelatedNotesPreviewLines',
        lines,
      }),
    );
    assert.strictEqual(parseSidebarMessage({ type: 'setRelatedNotesPreviewLines', lines: 3 }), undefined);
    assert.strictEqual(parseSidebarMessage({ type: 'setRelatedNotesPreviewLines', lines: '1' }), undefined);
  });
});
