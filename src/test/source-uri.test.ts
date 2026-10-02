import * as assert from 'assert';

import * as vscode from 'vscode';

import { resolveSourceUri, sourceScopeUri } from '../ui/commands/navigation';

/** A source key is a path in a workspace folder unless it is a whole URI. */
suite('Source keys with a colon', () => {
  const folder: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/notes'), name: 'notes', index: 0 };
  const work: vscode.WorkspaceFolder = { uri: vscode.Uri.file('/work'), name: 'Work: 2026', index: 1 };

  test('a note whose name has a colon is a note in the folder, not a URI', async () => {
    assert.strictEqual((await resolveSourceUri('Meeting: Q3.md', [folder]))?.path, '/notes/Meeting: Q3.md');
    assert.strictEqual(sourceScopeUri('Idea: lamps.md', [folder])?.path, '/notes/Idea: lamps.md');
  });

  test('so is a note in a folder whose name has a colon, in a multi-root workspace', async () => {
    assert.strictEqual((await resolveSourceUri('Work: 2026/plan.md', [folder, work]))?.path, '/work/plan.md');
    assert.strictEqual(sourceScopeUri('Work: 2026/plan.md', [folder, work])?.path, '/work/plan.md');
  });

  test('a whole URI is still read as one', async () => {
    const key = 'vscode-vfs://github/me/notes/plan.md';
    assert.strictEqual((await resolveSourceUri(key, [folder]))?.toString(), key);
    assert.strictEqual(sourceScopeUri(key, [folder])?.toString(), key);
  });
});
