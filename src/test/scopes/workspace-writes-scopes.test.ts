import * as assert from 'assert';

import * as vscode from 'vscode';

import { WorkspaceWriteHistory } from '../../ui/commands/workspaceWrites';
import { firstFolder, isMultiRoot } from './scopes';

/** A note's text on disk. */
async function readDisk(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

/**
 * Inside a workspace folder VS Code reads a loaded note again soon after
 * its file changes; an Undo that wrote the file straight to disk left the
 * document on the old text until then, and a write made in that moment
 * edited the old text, so its save failed and the disk kept neither.
 */
suite(`Workspace writes inside a workspace folder (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  test('a write right after an Undo of a note loaded but shown nowhere lands on what the Undo put back', async () => {
    const note = vscode.Uri.joinPath(firstFolder().uri, 'notes', `undo-then-write-${Date.now()}.md`);
    await vscode.workspace.fs.writeFile(note, Buffer.from('line one\nline two\n', 'utf8'));
    try {
      const document = await vscode.workspace.openTextDocument(note);
      const history = new WorkspaceWriteHistory('never');
      const first = new vscode.WorkspaceEdit();
      first.replace(note, new vscode.Range(0, 0, 0, 'line one'.length), 'CHANGED');
      assert.ok((await history.write(first, { label: 'first' })).applied);
      assert.strictEqual((await history.undo())?.restored, 1);

      const second = new vscode.WorkspaceEdit();
      second.insert(note, new vscode.Position(1, 0), 'added\n');
      const written = await history.write(second, { label: 'second' });

      assert.ok(written.applied);
      assert.strictEqual(await readDisk(note), 'line one\nadded\nline two\n');
      assert.strictEqual(document.getText(), 'line one\nadded\nline two\n');
      assert.strictEqual(document.isDirty, false);
    } finally {
      await vscode.workspace.fs.delete(note, { useTrash: false });
    }
  });
});
