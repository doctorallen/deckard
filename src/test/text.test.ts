import * as assert from 'assert';

import { pluralize } from '../core/text';

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
});
