import * as assert from 'assert';

import { findFrontmatterEnd, splitFrontmatterValues, unquote } from '../domain/markdown/frontmatter';

suite('Front matter bounds and values', () => {
  test('both rules close on ---', () => {
    const lines = ['---', 'tags: [a]', '---', 'body'];
    assert.strictEqual(findFrontmatterEnd(lines, 'dashes'), 2);
    assert.strictEqual(findFrontmatterEnd(lines, 'dashes-or-dots'), 2);
  });

  test('a ... closing line counts only for dashes-or-dots', () => {
    const lines = ['---', 'tags: [a]', '...', 'body', '---'];
    assert.strictEqual(findFrontmatterEnd(lines, 'dashes-or-dots'), 2);
    assert.strictEqual(findFrontmatterEnd(lines, 'dashes'), 4);
    assert.strictEqual(findFrontmatterEnd(['---', 'a: b', '...'], 'dashes'), undefined);
  });

  test('an indented closing line counts only for dashes', () => {
    const lines = ['---', 'a: b', '  ---  ', 'body'];
    assert.strictEqual(findFrontmatterEnd(lines, 'dashes'), 2);
    assert.strictEqual(findFrontmatterEnd(lines, 'dashes-or-dots'), undefined);
    assert.strictEqual(findFrontmatterEnd(['---', 'a: b', '---  '], 'dashes-or-dots'), 2);
  });

  test('a note must open with ---, whitespace around it allowed', () => {
    assert.strictEqual(findFrontmatterEnd([' --- ', 'a: b', '---'], 'dashes'), 2);
    assert.strictEqual(findFrontmatterEnd([' --- ', 'a: b', '---'], 'dashes-or-dots'), 2);
    assert.strictEqual(findFrontmatterEnd(['...', 'a: b', '...'], 'dashes-or-dots'), undefined);
    assert.strictEqual(findFrontmatterEnd(['# Title', '---', '---'], 'dashes'), undefined);
    assert.strictEqual(findFrontmatterEnd([], 'dashes'), undefined);
  });

  test('front matter that never closes is none', () => {
    assert.strictEqual(findFrontmatterEnd(['---', 'a: b'], 'dashes'), undefined);
    assert.strictEqual(findFrontmatterEnd(['---'], 'dashes-or-dots'), undefined);
  });

  test('values are split, trimmed, and unquoted', () => {
    assert.deepStrictEqual(splitFrontmatterValues(' [a, "b", , \'c\'] '), ['a', 'b', 'c']);
    assert.deepStrictEqual(splitFrontmatterValues(' "solo" '), ['solo']);
    assert.deepStrictEqual(splitFrontmatterValues('   '), []);
    assert.deepStrictEqual(splitFrontmatterValues('[]', { keepEmptyValue: true }), []);
  });

  test('an empty quoted value is kept only when asked', () => {
    assert.deepStrictEqual(splitFrontmatterValues('""'), []);
    assert.deepStrictEqual(splitFrontmatterValues("''", { keepEmptyValue: true }), ['']);
  });

  test('unquote takes one quote off each end', () => {
    assert.strictEqual(unquote('"a"'), 'a');
    assert.strictEqual(unquote('\'a"'), 'a');
    assert.strictEqual(unquote('""a""'), '"a"');
    assert.strictEqual(unquote('a'), 'a');
  });
});
