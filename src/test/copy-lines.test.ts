import * as assert from 'assert';

import { headingAbove, sectionWithSourceLink, withSourceLink } from '../domain/notes/copyLines';
import { dateHeading, dateHeadingLine } from '../domain/notes/moveSection';

suite('Copy to… and dated moves', () => {
  test('finds the heading a line is written under, outside code and front matter', () => {
    const lines = ['---', 'title: # Not this', '---', '# 2026-11-16', '## Vendor sync #project/borealis', '```', '## Not this either', '```', '- A line'];
    assert.strictEqual(headingAbove(lines, 8), 'Vendor sync #project/borealis');
    assert.strictEqual(headingAbove(lines, 4), '2026-11-16');
    assert.strictEqual(headingAbove(lines, 3), undefined);
  });

  test('writes the link after the first line, ahead of a block id, and above a code block or a table', () => {
    assert.deepStrictEqual(withSourceLink(['- The gateway is included  ', '  - By Dana'], '[[2026-11-16#Vendor sync]]'), [
      '- The gateway is included ([[2026-11-16#Vendor sync]])',
      '  - By Dana',
    ]);
    assert.deepStrictEqual(withSourceLink(['- Included ^gateway'], '[[2026-11-16]]'), ['- Included ([[2026-11-16]]) ^gateway']);
    assert.deepStrictEqual(withSourceLink(['```sh', 'npm test', '```'], '[[2026-11-16]]'), ['([[2026-11-16]])', '', '```sh', 'npm test', '```']);
    assert.deepStrictEqual(withSourceLink(['| a | b |'], '[[2026-11-16]]'), ['([[2026-11-16]])', '', '| a | b |']);
    assert.deepStrictEqual(sectionWithSourceLink(['## Vendor sync', '- Notes'], '[[2026-11-16#Vendor sync]]'), [
      '## Vendor sync',
      '([[2026-11-16#Vendor sync]])',
      '- Notes',
    ]);
    assert.deepStrictEqual(
      sectionWithSourceLink(['## Vendor sync', 'The gateway is included.'], '[[2026-11-16#Vendor sync]]'),
      ['## Vendor sync', '([[2026-11-16#Vendor sync]])', '', 'The gateway is included.'],
      'a blank line keeps the link out of the paragraph under it',
    );
  });

  test('puts the day before a heading’s words, once', () => {
    assert.strictEqual(dateHeading('Vendor sync #project/borealis', '2026-11-16'), '2026-11-16 Vendor sync #project/borealis');
    assert.strictEqual(dateHeading('2026-11-13 Kickoff', '2026-11-16'), '2026-11-13 Kickoff');
    assert.strictEqual(dateHeadingLine('### Vendor sync @dana', '2026-11-16'), '### 2026-11-16 Vendor sync @dana');
    assert.strictEqual(dateHeadingLine('## 2026-11-13 10:00 Kickoff', '2026-11-16'), '## 2026-11-13 10:00 Kickoff');
    assert.strictEqual(dateHeadingLine('Not a heading', '2026-11-16'), 'Not a heading');
  });
});
