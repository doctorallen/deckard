import * as assert from 'assert';

import { escapeMarkdown, escapeRegExp, pluralize } from '../shared/text';

suite('Text helpers', () => {
  suite('pluralize', () => {
    test('uses the singular for exactly one and the plural for zero and many', () => {
      assert.strictEqual(pluralize(0, 'note'), '0 notes');
      assert.strictEqual(pluralize(1, 'note'), '1 note');
      assert.strictEqual(pluralize(2, 'note'), '2 notes');
    });

    test('takes an irregular plural', () => {
      assert.strictEqual(pluralize(1, 'entry', 'entries'), '1 entry');
      assert.strictEqual(pluralize(0, 'saved search', 'saved searches'), '0 saved searches');
      assert.strictEqual(pluralize(3, 'saved search', 'saved searches'), '3 saved searches');
    });

    test('writes the number plainly unless asked for digit grouping', () => {
      assert.strictEqual(pluralize(1204, 'open task'), '1204 open tasks');
      assert.strictEqual(pluralize(1204, 'open task', 'open tasks', { locale: true }), '1,204 open tasks');
      assert.strictEqual(pluralize(1, 'tag', 'tags', { locale: true }), '1 tag');
      assert.strictEqual(pluralize(0, 'tag', 'tags', { locale: true }), '0 tags');
    });

    test('says nothing for zero only when asked', () => {
      assert.strictEqual(pluralize(0, 'pinned note', 'pinned notes', { emptyForZero: true }), '');
      assert.strictEqual(pluralize(1, 'pinned note', 'pinned notes', { emptyForZero: true }), '1 pinned note');
      assert.strictEqual(pluralize(2, 'pinned note', 'pinned notes', { emptyForZero: true }), '2 pinned notes');
    });

    test('treats a negative or fractional count as many', () => {
      assert.strictEqual(pluralize(-1, 'note'), '-1 notes');
      assert.strictEqual(pluralize(1.5, 'note'), '1.5 notes');
    });
  });

  suite('escapeMarkdown', () => {
    const every = String.raw`a\*_[]{}()#+-.!|<>~` + '`';

    test('escapes Markdown punctuation but not the hyphen by default', () => {
      const expected = String.raw`a\\\*\_\[\]\{\}\(\)\#\+-\.\!\|\<\>~` + '\\`';
      assert.strictEqual(escapeMarkdown(every), expected);
      assert.strictEqual(escapeMarkdown(every, 'punctuation'), expected);
    });

    test('escapes the hyphen too for the agenda tooltip', () => {
      assert.strictEqual(
        escapeMarkdown(every, 'punctuationAndHyphen'),
        String.raw`a\\\*\_\[\]\{\}\(\)\#\+\-\.\!\|\<\>~` + '\\`',
      );
    });

    test('escapes only code, emphasis, link, and HTML characters for the status bar', () => {
      assert.strictEqual(escapeMarkdown(every, 'inline'), String.raw`a\\\*\_\[\]{}()#+-.!|\<\>~` + '\\`');
    });

    test('leaves plain text alone, and escapes every occurrence on repeated calls', () => {
      assert.strictEqual(escapeMarkdown('Plain words, 2026'), 'Plain words, 2026');
      assert.strictEqual(escapeMarkdown('*a* *b*'), String.raw`\*a\* \*b\*`);
      assert.strictEqual(escapeMarkdown('*a* *b*'), String.raw`\*a\* \*b\*`);
    });
  });

  suite('escapeRegExp', () => {
    test('escapes every metacharacter', () => {
      assert.strictEqual(escapeRegExp('.*+?^${}()|[]\\'), String.raw`\.\*\+\?\^\$\{\}\(\)\|\[\]\\`);
    });

    test('matches the text literally inside a larger pattern', () => {
      const pattern = new RegExp(`^${escapeRegExp('#tag.(one)+')}$`);
      assert.ok(pattern.test('#tag.(one)+'));
      assert.ok(!pattern.test('#tagx(one)'));
      assert.strictEqual(escapeRegExp('plain-text/ok'), 'plain-text/ok');
    });
  });
});
