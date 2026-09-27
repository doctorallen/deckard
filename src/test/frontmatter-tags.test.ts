import * as assert from 'assert';

import {
  addFrontmatterTag,
  readFrontmatterTagValues,
  removeFrontmatterTags,
} from '../core/markdown/frontmatterTags';

suite('Front matter tags', () => {
  test('adds a front matter to a note that has none', () => {
    assert.strictEqual(addFrontmatterTag('# Atlas\nBody\n', 'parked'), '---\ntags: [parked]\n---\n# Atlas\nBody\n');
  });

  test('adds a tags field to a front matter without one', () => {
    assert.strictEqual(
      addFrontmatterTag('---\ntitle: Atlas\n---\n# Atlas\n', 'parked'),
      '---\ntitle: Atlas\ntags: [parked]\n---\n# Atlas\n',
    );
  });

  test('adds to a flow list, a single value, and a block list', () => {
    assert.strictEqual(
      addFrontmatterTag('---\ntags: [a, "b"]\n---\n', 'parked'),
      '---\ntags: [a, b, parked]\n---\n',
    );
    assert.strictEqual(addFrontmatterTag('---\ntag: a\n---\n', 'parked'), '---\ntag: [a, parked]\n---\n');
    assert.strictEqual(
      addFrontmatterTag('---\ntags:\n  - a\n  - b\ntitle: x\n---\n', 'parked'),
      '---\ntags:\n  - a\n  - b\n  - parked\ntitle: x\n---\n',
    );
  });

  test('leaves a note alone that has the tag, in any spelling', () => {
    assert.strictEqual(addFrontmatterTag('---\ntags: [Parked]\n---\n', 'parked'), undefined);
    assert.strictEqual(addFrontmatterTag('---\ntags:\n  - "#parked"\n---\n', 'parked'), undefined);
  });

  test('keeps CRLF line endings', () => {
    assert.strictEqual(addFrontmatterTag('---\r\ntitle: x\r\n---\r\nBody', 'parked'), '---\r\ntitle: x\r\ntags: [parked]\r\n---\r\nBody');
    assert.strictEqual(addFrontmatterTag('Body\r\n', 'parked'), '---\r\ntags: [parked]\r\n---\r\nBody\r\n');
  });

  test('refuses a front matter it cannot safely rewrite', () => {
    assert.strictEqual(addFrontmatterTag('---\ntags: [a,\n  b]\n---\n', 'parked'), undefined);
    assert.strictEqual(removeFrontmatterTags('---\ntags: a\n  - b\n---\n', ['a']), undefined);
    assert.strictEqual(readFrontmatterTagValues('---\ntags: [a,\n  b]\n---\n'), undefined);
  });

  test('removes a tag and keeps the rest', () => {
    assert.strictEqual(
      removeFrontmatterTags('---\ntags: [a, parked, b]\n---\n', ['parked']),
      '---\ntags: [a, b]\n---\n',
    );
    assert.strictEqual(
      removeFrontmatterTags('---\ntags:\n  - a\n  - "#Parked"\n---\n', ['parked']),
      '---\ntags:\n  - a\n---\n',
    );
  });

  test('an emptied field goes, and an emptied front matter goes with it', () => {
    assert.strictEqual(
      removeFrontmatterTags('---\ntitle: x\ntags: [parked]\n---\n# A\n', ['parked']),
      '---\ntitle: x\n---\n# A\n',
    );
    assert.strictEqual(removeFrontmatterTags('---\ntags: [parked]\n---\n# A\n', ['parked']), '# A\n');
    assert.strictEqual(
      removeFrontmatterTags(addFrontmatterTag('# A\r\nBody', 'parked') as string, ['parked']),
      '# A\r\nBody',
    );
    assert.strictEqual(
      removeFrontmatterTags('---\ntags:\n  - parked\n---\nBody', ['parked', 'someday']),
      'Body',
    );
  });

  test('says when there was nothing to remove', () => {
    assert.strictEqual(removeFrontmatterTags('# A\n', ['parked']), undefined);
    assert.strictEqual(removeFrontmatterTags('---\ntags: [a]\n---\n', ['parked']), undefined);
  });
});
