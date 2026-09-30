import * as assert from 'assert';

import {
  listExcludedFolders,
  readExcludeKey,
  relativeExcludeKey,
  withExcludeKey,
} from '../domain/index/excludeKeys';
import { folderName, refuseExclude } from '../ui/commands/excludeFolders';
import { createExcludeMatcher } from '../core/workspace/scanner';
import { noteFolderFor } from '../ui/commands/templates';
import * as vscode from 'vscode';

const join = (root: string, relative: string) => `${root}/${relative}`;

suite('Exclude from Deckard', () => {
  test('names a folder by its path from the workspace folder', () => {
    assert.strictEqual(relativeExcludeKey('/w/notes/archive/2019', '/w'), 'notes/archive/2019');
    assert.strictEqual(relativeExcludeKey('/w', '/w'), undefined, 'the root is not a key');
    assert.strictEqual(relativeExcludeKey('/elsewhere', '/w'), undefined);
  });

  test('escapes glob characters, so the key matches that folder alone', () => {
    const key = relativeExcludeKey('/w/notes/[draft]', '/w');
    assert.strictEqual(key, 'notes/\\[draft\\]');
    assert.strictEqual(readExcludeKey(key!), 'notes/[draft]');
    const matches = createExcludeMatcher({ [key!]: true });
    assert.strictEqual(matches('notes/[draft]/idea.md'), true);
    assert.strictEqual(matches('notes/d/idea.md'), false);
  });

  test('lists only the folders an exact true key names', () => {
    assert.deepStrictEqual(
      listExcludedFolders(
        [
          { root: '/w', exclude: { 'notes/archive': true, 'notes/old': false, '**/drafts': true, 'notes/\\[x\\]': true } },
          { root: '/v', exclude: 'nonsense' },
        ],
        join,
      ),
      ['/w/notes/archive', '/w/notes/[x]'],
    );
  });

  test('sets and takes out one key, leaving the rest', () => {
    assert.deepStrictEqual(withExcludeKey({ a: true }, 'notes/archive', true), { a: true, 'notes/archive': true });
    assert.deepStrictEqual(withExcludeKey({ a: true, 'notes/archive': true }, 'notes/archive', false), { a: true });
    assert.deepStrictEqual(withExcludeKey(undefined, 'b', true), { b: true });
  });

  test('refuses the notes folder, a folder outside it, and the templates folder', () => {
    const place = { workspaceFolder: '/w', notesFolder: '/w/notes', templatesFolder: '/w/notes/templates' };
    assert.match(refuseExclude({ ...place, folder: '/w/notes' }) ?? '', /cannot leave out the whole notes folder/);
    assert.match(refuseExclude({ ...place, folder: '/w' }) ?? '', /cannot leave out the whole notes folder/);
    assert.strictEqual(
      refuseExclude({ ...place, folder: '/w/archive' }),
      'Deckard does not index archive, since it is outside the "Notes Folder" folder.',
    );
    assert.strictEqual(
      refuseExclude({ ...place, folder: '/w/notes/templates/meetings' }),
      'Deckard already leaves the templates folder out.',
    );
    assert.strictEqual(refuseExclude({ ...place, folder: '/w/notes/archive/2019' }), undefined);
    assert.strictEqual(folderName({ ...place, folder: '/w/notes/archive/2019' }), 'notes/archive/2019');
  });

  test('a note from a template goes in the folder chosen', () => {
    const notes = vscode.Uri.file('/w/notes');
    const here = vscode.Uri.file('/w/notes/meetings');
    assert.strictEqual(noteFolderFor(notes, here), here);
    assert.strictEqual(noteFolderFor(notes), notes);
  });
});
