import * as assert from 'assert';

import { WorkspaceScanner } from '../core/workspace/scanner';
import { createFakeAccess, fakeFolder, joinUri } from './fakeWorkspace';

suite('Pausing Deckard in a workspace', () => {
  test('reads, watches, and counts no note while paused, and all of them again after', async () => {
    const folder = fakeFolder('/tmp/deckard-pause', 'w');
    let paused = true;
    const note = joinUri(folder.uri, 'notes', 'a.md');
    const scanner = new WorkspaceScanner(createFakeAccess({
      workspaceFolders: [folder],
      findFiles: async () => [note],
      readFile: async () => new TextEncoder().encode('# A\n- [ ] Task\n'),
      isPaused: () => paused,
    }));
    assert.deepStrictEqual(await scanner.scan(), []);
    assert.deepStrictEqual(scanner.getPatterns(), []);
    assert.strictEqual(scanner.isNotesFile(note), false);
    paused = false;
    assert.strictEqual((await scanner.scan()).length, 1);
    assert.strictEqual(scanner.getPatterns().length, 1);
    assert.strictEqual(scanner.isNotesFile(note), true);
  });
});
