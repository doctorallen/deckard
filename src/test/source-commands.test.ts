import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { createDailyNote } from '../ui/commands/dailyNote';
import { openSourceAt, resolveSourceUri } from '../ui/commands/navigation';
import { toggleTask } from '../ui/commands/taskActions';

suite('Source commands', () => {
  test('toggles a checklist character without changing the rest of the source line', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'notes.md');
    const originalContent = '# Today\n\n- [ ] Follow the lead\n';
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(originalContent, 'utf8'),
    );

    const parsed = parseMarkdown(fileUri.fsPath, originalContent);
    const updated = await toggleTask(parsed.tasks[0], true);
    const content = Buffer.from(
      await vscode.workspace.fs.readFile(fileUri),
    ).toString('utf8');

    assert.strictEqual(updated, true);
    assert.strictEqual(content, '# Today\n\n- [x] Follow the lead\n');
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('rejects a task whose source line changed after indexing', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'stale.md');
    const originalContent = '- [ ] Original title\n';
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(originalContent, 'utf8'),
    );
    const parsed = parseMarkdown(fileUri.fsPath, originalContent);
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      fileUri,
      new vscode.Range(0, 0, 0, document.lineAt(0).text.length),
      '- [ ] Changed title',
    );
    assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
    assert.strictEqual(await toggleTask(parsed.tasks[0], true), false);
    assert.strictEqual(document.lineAt(0).text, '- [ ] Changed title');
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('opens a source document at the requested one-based line', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'navigation.md');
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from('first\nsecond\nthird\n', 'utf8'),
    );

    const editor = await openSourceAt(fileUri.fsPath, 2);

    assert.ok(editor);
    assert.strictEqual(editor.document.uri.toString(), fileUri.toString());
    assert.strictEqual(editor.selection.active.line, 1);
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('treats Windows drive paths as file paths', async () => {
    const uri = await resolveSourceUri(
      'C:\\Users\\david\\deckard\\notes\\case.md',
      [],
    );

    assert.ok(uri);
    assert.strictEqual(uri.scheme, 'file');
  });

  test('creates a daily note and does not overwrite an existing one', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceFolder = {
      uri: temporaryRoot,
      name: 'temporary',
      index: 0,
    } as vscode.WorkspaceFolder;

    const noteUri = await createDailyNote(workspaceFolder);
    assert.ok(noteUri);
    const firstContent = Buffer.from(
      await vscode.workspace.fs.readFile(noteUri!),
    ).toString('utf8');
    assert.match(firstContent, /^# \d{4}-\d{2}-\d{2}\n\n$/);

    const preservedContent = '# Preserved\n';
    await vscode.workspace.fs.writeFile(
      noteUri!,
      Buffer.from(preservedContent, 'utf8'),
    );
    await createDailyNote(workspaceFolder);
    const secondContent = Buffer.from(
      await vscode.workspace.fs.readFile(noteUri!),
    ).toString('utf8');

    assert.strictEqual(secondContent, preservedContent);
    await deleteTemporaryRoot(temporaryRoot);
  });
});

async function createTemporaryRoot(): Promise<vscode.Uri> {
  const directoryName = `deckard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
