import * as assert from 'assert';

import {
  findWorkspaceFolderByKey,
  getFileName,
  getFolder,
  readFolderSetting,
  workspaceFolderKey,
} from '../shared/paths';

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

  test('readFolderSetting trims a folder setting to a relative path, and reads one that is not text as the default', () => {
    assert.strictEqual(readFolderSetting(' /notes\\daily/ ', ''), 'notes/daily');
    assert.strictEqual(readFolderSetting('', 'templates'), '');
    assert.strictEqual(readFolderSetting(null, 'templates'), 'templates');
    assert.strictEqual(readFolderSetting(5, ''), '');
    assert.strictEqual(readFolderSetting(false, ''), '');
    assert.strictEqual(readFolderSetting(['notes'], ''), '');
  });

  test('workspaceFolderKey names a folder, and a later folder of the same name with a count', () => {
    const folder = (name: string, path: string) => ({ name, uri: { toString: () => `file://${path}` } });
    const folders = [
      folder('notes', '/work/notes'),
      folder('notes', '/personal/notes'),
      folder('notes (2)', '/odd/notes (2)'),
      folder('journal', '/journal'),
    ];
    assert.deepStrictEqual(
      folders.map((each) => workspaceFolderKey(folders, each)),
      ['notes', 'notes (2)', 'notes (2) (2)', 'journal'],
    );
    assert.strictEqual(workspaceFolderKey(folders, folder('notes', '/personal/notes')), 'notes (2)', 'found by its URI');
    assert.strictEqual(workspaceFolderKey(folders, folder('notes', '/elsewhere')), undefined);
    assert.strictEqual(findWorkspaceFolderByKey(folders, 'notes (2)'), folders[1]);
    assert.strictEqual(findWorkspaceFolderByKey(folders, 'journal'), folders[3]);
    assert.strictEqual(findWorkspaceFolderByKey(folders, 'archive'), undefined);
  });
});
