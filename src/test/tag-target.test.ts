import * as assert from 'assert';

import { findTagTarget } from '../domain/markdown/tagTarget';

suite('Where a suggested tag goes', () => {
  const note = [
    '---', // 1
    'aliases: [Vendors]', // 2
    '---', // 3
    'Loose prose before any heading.', // 4
    '# Vendor audit ##', // 5
    'Northwind was late.', // 6
    '- [ ] Call Northwind', // 7
    '```', // 8
    'code', // 9
    '```', // 10
    '', // 11
    '## Next steps #draft', // 12
  ];

  test('the heading the cursor is on', () => {
    assert.deepStrictEqual(findTagTarget(note, 5), { line: 5, kind: 'heading', label: 'Vendor audit' });
    assert.deepStrictEqual(findTagTarget(note, 12), { line: 12, kind: 'heading', label: 'Next steps' });
  });

  test('hashes alone are a heading, as the parser reads them', () => {
    const bare = ['Prose.', '#', 'Under it.'];
    assert.deepStrictEqual(findTagTarget(bare, 2), { line: 2, kind: 'heading', label: '' });
    assert.deepStrictEqual(findTagTarget(bare, 3), { line: 2, kind: 'heading', label: '' }, 'the section under it');
    assert.deepStrictEqual(findTagTarget(['   ## Plan ##', 'Text'], 2), { line: 1, kind: 'heading', label: 'Plan' });
  });

  test('the task or list item the cursor is on', () => {
    assert.deepStrictEqual(findTagTarget(note, 7), { line: 7, kind: 'line', label: 'line 7' });
  });

  test('else the nearest heading above, which tags the section', () => {
    assert.deepStrictEqual(findTagTarget(note, 6), { line: 5, kind: 'heading', label: 'Vendor audit' });
    assert.deepStrictEqual(findTagTarget(note, 11), { line: 5, kind: 'heading', label: 'Vendor audit' });
  });

  test('a cursor in a code block counts from the line above it', () => {
    assert.deepStrictEqual(findTagTarget(note, 9), { line: 7, kind: 'line', label: 'line 7' });
  });

  test('with no heading above, the prose line the cursor is on', () => {
    assert.deepStrictEqual(findTagTarget(note, 4), { line: 4, kind: 'line', label: 'line 4' });
  });

  test('a cursor in front matter takes the first heading below', () => {
    assert.deepStrictEqual(findTagTarget(note, 2), { line: 5, kind: 'heading', label: 'Vendor audit' });
  });

  test('a blank line with no heading anywhere takes the first line with words', () => {
    assert.deepStrictEqual(findTagTarget(['', 'Just prose.', ''], 1), { line: 2, kind: 'line', label: 'line 2' });
    assert.strictEqual(findTagTarget(['', ''], 1), undefined);
    assert.strictEqual(findTagTarget([''], 1), undefined);
  });
});
