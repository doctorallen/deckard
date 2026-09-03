import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { createDailyNote } from '../ui/commands/dailyNote';
import {
  extractHeadingNote,
  findTaggedHeadingAtLine,
  getExtractedNoteFileName,
} from '../ui/commands/extractHeading';
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

  test('moves a tagged heading section and removes it from its source', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const notesUri = vscode.Uri.joinPath(temporaryRoot, 'notes');
    const sourceUri = vscode.Uri.joinPath(notesUri, 'source.md');
    const sourceContent = [
      '# Case #case',
      'Introduction.',
      '',
      '## Lead #clue',
      'Lead details.',
      '',
      '### Detail #detail',
      'Nested details.',
      '',
      '## Next',
      'Next section.',
    ].join('\n');
    await vscode.workspace.fs.createDirectory(notesUri);
    await vscode.workspace.fs.writeFile(
      sourceUri,
      Buffer.from(sourceContent, 'utf8'),
    );

    const parsed = parseMarkdown('notes/source.md', sourceContent);
    const section = findTaggedHeadingAtLine(parsed.sections, 7);
    assert.strictEqual(section?.heading, 'Detail #detail');

    const extractedUri = await extractHeadingNote(
      parsed.sections[1],
      sourceUri,
      notesUri,
      'lead-note.md',
    );
    assert.ok(extractedUri);
    const extractedContent = Buffer.from(
      await vscode.workspace.fs.readFile(extractedUri!),
    ).toString('utf8');
    assert.strictEqual(
      extractedContent,
      [
        '## Lead #clue',
        'Lead details.',
        '',
        '### Detail #detail',
        'Nested details.',
        '',
      ].join('\n'),
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString(
        'utf8',
      ),
      ['# Case #case', 'Introduction.', '', '## Next', 'Next section.'].join(
        '\n',
      ),
    );

    await deleteTemporaryRoot(temporaryRoot);
  });

  test('rejects unsafe extraction names and preserves conflicts', async () => {
    assert.strictEqual(
      getExtractedNoteFileName('lead note.md'),
      'lead note.md',
    );
    assert.strictEqual(getExtractedNoteFileName('../lead-note'), undefined);
    assert.strictEqual(getExtractedNoteFileName('lead/note'), undefined);

    const temporaryRoot = await createTemporaryRoot();
    const notesUri = vscode.Uri.joinPath(temporaryRoot, 'notes');
    const parsed = parseMarkdown('notes/source.md', '# Case #case\nDetails.');
    const sourceUri = vscode.Uri.joinPath(notesUri, 'source.md');
    const noteUri = vscode.Uri.joinPath(notesUri, 'existing.md');
    await vscode.workspace.fs.createDirectory(notesUri);
    await vscode.workspace.fs.writeFile(
      sourceUri,
      Buffer.from('# Case #case\nDetails.', 'utf8'),
    );
    await vscode.workspace.fs.writeFile(
      noteUri,
      Buffer.from('Keep this note.\n', 'utf8'),
    );

    assert.strictEqual(
      await extractHeadingNote(
        parsed.sections[0],
        sourceUri,
        notesUri,
        'existing',
      ),
      undefined,
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(noteUri)).toString('utf8'),
      'Keep this note.\n',
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString(
        'utf8',
      ),
      '# Case #case\nDetails.',
    );

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
