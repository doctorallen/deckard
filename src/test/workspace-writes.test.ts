import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import {
  applyWorkspaceWrite,
  shouldPreview,
  WorkspaceWriteHistory,
} from '../ui/commands/workspaceWrites';

suite('Workspace writes', () => {
  test('shows a write that reaches more than one note', () => {
    assert.strictEqual(shouldPreview('severalNotes', 1), false);
    assert.strictEqual(shouldPreview('severalNotes', 2), true);
    assert.strictEqual(shouldPreview('always', 1), true);
    assert.strictEqual(shouldPreview('always', 0), false, 'nothing to show');
    assert.strictEqual(shouldPreview('never', 9), false);
  });

  test('saves what it wrote, and puts every note back on an undo', async () => {
    const root = await createTemporaryRoot();
    const first = vscode.Uri.joinPath(root, 'first.md');
    const second = vscode.Uri.joinPath(root, 'second.md');
    await write(first, '# Atlas #project/atlas\n');
    await write(second, 'Also #project/atlas here.\n');
    const history = new WorkspaceWriteHistory();

    const edit = new vscode.WorkspaceEdit();
    edit.replace(first, lineRange(0, 8, 22), '#project/argent');
    edit.replace(second, lineRange(0, 5, 19), '#project/argent');
    const written = await applyWorkspaceWrite(
      edit,
      { label: 'the rename of #project/atlas', preview: 'never' },
      history,
    );

    assert.strictEqual(written.applied, true);
    assert.strictEqual(written.notes.length, 2);
    assert.strictEqual(await read(first), '# Atlas #project/argent\n');
    assert.strictEqual(await read(second), 'Also #project/argent here.\n');
    assert.strictEqual(
      history.lastWrite?.label,
      'the rename of #project/atlas',
    );

    const undone = await history.undo();
    assert.deepStrictEqual(undone, {
      label: 'the rename of #project/atlas',
      restored: 2,
      skipped: 0,
    });
    assert.strictEqual(await read(first), '# Atlas #project/atlas\n');
    assert.strictEqual(await read(second), 'Also #project/atlas here.\n');
    assert.strictEqual(
      history.lastWrite,
      undefined,
      'one write is kept, and an undo spends it',
    );
    await deleteTemporaryRoot(root);
  });

  test('leaves a note changed since the write as its author left it', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.joinPath(root, 'note.md');
    const other = vscode.Uri.joinPath(root, 'other.md');
    await write(note, 'One #a tag.\n');
    await write(other, 'Another #a tag.\n');
    const history = new WorkspaceWriteHistory();

    const edit = new vscode.WorkspaceEdit();
    edit.replace(note, lineRange(0, 4, 6), '#b');
    edit.replace(other, lineRange(0, 8, 10), '#b');
    await applyWorkspaceWrite(
      edit,
      { label: 'the rename of #a', preview: 'never' },
      history,
    );
    await write(other, 'Rewritten by hand.\n');

    const undone = await history.undo();
    assert.deepStrictEqual(undone, {
      label: 'the rename of #a',
      restored: 1,
      skipped: 1,
    });
    assert.strictEqual(await read(note), 'One #a tag.\n');
    assert.strictEqual(await read(other), 'Rewritten by hand.\n');
    await deleteTemporaryRoot(root);
  });

  test('puts back what the write changed outside the notes', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.joinPath(root, 'note.md');
    await write(note, 'One #a tag.\n');
    const history = new WorkspaceWriteHistory();
    let favorites = ['#b'];

    const edit = new vscode.WorkspaceEdit();
    edit.replace(note, lineRange(0, 4, 6), '#b');
    await applyWorkspaceWrite(
      edit,
      {
        label: 'the rename of #a',
        preview: 'never',
        restore: async () => {
          favorites = ['#a'];
        },
      },
      history,
    );

    await history.undo();
    assert.deepStrictEqual(favorites, ['#a']);
    await deleteTemporaryRoot(root);
  });

  test('has nothing to undo until something is written', async () => {
    const history = new WorkspaceWriteHistory();
    assert.strictEqual(history.lastWrite, undefined);
    assert.strictEqual(await history.undo(), undefined);

    const edit = new vscode.WorkspaceEdit();
    const written = await applyWorkspaceWrite(
      edit,
      { label: 'nothing', preview: 'never' },
      history,
    );
    assert.deepStrictEqual(written, { applied: true, notes: [] });
    assert.strictEqual(history.lastWrite, undefined);
  });
});

function lineRange(line: number, start: number, end: number): vscode.Range {
  return new vscode.Range(line, start, line, end);
}

async function write(uri: vscode.Uri, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

async function read(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

async function createTemporaryRoot(): Promise<vscode.Uri> {
  const directoryName = `deckard-writes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const temporaryRoot = vscode.Uri.file(path.join(os.tmpdir(), directoryName));
  await vscode.workspace.fs.createDirectory(temporaryRoot);
  return temporaryRoot;
}

async function deleteTemporaryRoot(temporaryRoot: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(temporaryRoot, {
    recursive: true,
    useTrash: false,
  });
}
