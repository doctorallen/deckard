import * as assert from 'assert';

import { getFileName, getFolder } from '../shared/paths';

suite('Index paths', () => {
  test('getFileName keeps the last segment and its extension', () => {
    assert.strictEqual(getFileName('projects/atlas.md'), 'atlas.md');
    assert.strictEqual(getFileName('a/b/c/Weekly Review.MD'), 'Weekly Review.MD');
    assert.strictEqual(getFileName('inbox.md'), 'inbox.md');
    assert.strictEqual(getFileName('notes/archive.tar.gz'), 'archive.tar.gz');
  });

  test('getFileName splits on "/" only, never on a backslash', () => {
    assert.strictEqual(getFileName('projects\\atlas.md'), 'projects\\atlas.md');
  });

  test('getFileName gives an empty name for a trailing "/" and for an empty path', () => {
    assert.strictEqual(getFileName('projects/'), '');
    assert.strictEqual(getFileName(''), '');
  });

  test('getFileName passes undefined through', () => {
    assert.strictEqual(getFileName(undefined), undefined);
  });

  test('getFolder keeps everything before the last "/"', () => {
    assert.strictEqual(getFolder('projects/atlas.md'), 'projects');
    assert.strictEqual(getFolder('a/b/c.md'), 'a/b');
    assert.strictEqual(getFolder('projects/'), 'projects');
  });

  test('getFolder is empty for a note at the top of the notes folder', () => {
    assert.strictEqual(getFolder('inbox.md'), '');
    assert.strictEqual(getFolder(''), '');
    assert.strictEqual(getFolder('/inbox.md'), '');
  });
});
