import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createLinkRewriteEdit, LinkMaintenance } from '../ui/commands/linkMaintenance';
import {
  WorkspaceWriteHistory,
} from '../ui/commands/workspaceWrites';
import { planNoteRenameRewrites } from '../domain/links/linkRewrites';
import type { LinkService } from '../services/linkService';
import { WorkspaceIndex } from '../domain/model';

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

suite('Link maintenance', () => {
  test('rewrites the notes on disk, and skips a link that has since changed', async () => {
    const root = await createTemporaryRoot();
    const write = async (name: string, content: string): Promise<string> => {
      const uri = vscode.Uri.joinPath(root, name);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      return uri.fsPath;
    };
    const logPath = await write('Log.md', 'Read [[Vendor review]] today.\n');
    const movedPath = await write('Moved.md', 'Read [[Vendor review]] too.\n');
    const reviewPath = await write('Vendor review.md', '# Vendor review\n');
    const onDisk = indexOf({
      [logPath]: 'Read [[Vendor review]] today.\n',
      [movedPath]: 'Read [[Vendor review]] too.\n',
      [reviewPath]: '# Vendor review\n',
    });

    const rewrites = planNoteRenameRewrites(
      onDisk,
      reviewPath,
      'Supplier review',
    );
    // The note moved on between planning and applying: its link is gone.
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(movedPath),
      Buffer.from('Read [[Something else]] now.\n', 'utf8'),
    );

    const { edit } = await createLinkRewriteEdit(rewrites);
    const written = await new WorkspaceWriteHistory().write(edit, {
      label: 'the rename',
      preview: 'never',
    });
    const updated = written.notes.length;
    const read = async (file: string): Promise<string> =>
      Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.file(file)),
      ).toString('utf8');

    assert.strictEqual(updated, 1);
    assert.strictEqual(await read(logPath), 'Read [[Supplier review]] today.\n');
    assert.strictEqual(
      await read(movedPath),
      'Read [[Something else]] now.\n',
      'the note that changed is left as its author left it',
    );
    await deleteTemporaryRoot(root);
  });

  test('plans the rename of a note as one edit over the workspace', async () => {
    const root = await createTemporaryRoot();
    const logUri = vscode.Uri.joinPath(root, 'Log.md');
    const reviewUri = vscode.Uri.joinPath(root, 'Vendor review.md');
    await vscode.workspace.fs.writeFile(
      logUri,
      Buffer.from('Read [[Vendor review]] today.\n', 'utf8'),
    );
    await vscode.workspace.fs.writeFile(
      reviewUri,
      Buffer.from('# Vendor review\n', 'utf8'),
    );
    const snapshot = indexOf({
      [logUri.fsPath]: 'Read [[Vendor review]] today.\n',
      [reviewUri.fsPath]: '# Vendor review\n',
    });
    const maintenance = new LinkMaintenance({
      ready: Promise.resolve(),
      getSnapshot: () => snapshot,
      getFilePath: (uri) => uri.fsPath,
      isNotesFile: () => true,
    });

    try {
      const edit = await maintenance.planRenames([
        {
          oldUri: reviewUri,
          newUri: vscode.Uri.joinPath(root, 'Supplier review.md'),
        },
      ]);
      const entries = edit.entries();
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0][0].fsPath, logUri.fsPath);
      assert.strictEqual(entries[0][1][0].newText, '[[Supplier review]]');

      const ignored = await maintenance.planRenames([
        {
          oldUri: vscode.Uri.joinPath(root, 'Notes.txt'),
          newUri: vscode.Uri.joinPath(root, 'Other.txt'),
        },
      ]);
      assert.strictEqual(ignored.entries().length, 0);
    } finally {
      maintenance.dispose();
      await deleteTemporaryRoot(root);
    }
  });

  test('says how many links it updated only once the rename is made, and nothing for one cancelled', async () => {
    const willRename = new vscode.EventEmitter<vscode.FileWillRenameEvent>();
    const didRename = new vscode.EventEmitter<vscode.FileRenameEvent>();
    const links = {
      planNoteRenames: async () => ({ edits: [], rewritten: 2, notes: 1 }),
    } as unknown as LinkService<vscode.Uri>;
    const snapshot = indexOf({});
    const maintenance = new LinkMaintenance(
      { ready: Promise.resolve(), getSnapshot: () => snapshot, getFilePath: (uri) => uri.fsPath, isNotesFile: () => true },
      links,
      { onWillRenameFiles: willRename.event, onDidRenameFiles: didRename.event },
    );
    const window = vscode.window as unknown as Record<string, unknown>;
    const showInformationMessage = window.showInformationMessage;
    const shown: unknown[] = [];
    window.showInformationMessage = async (message: unknown) => void shown.push(message);
    const files = [{ oldUri: vscode.Uri.file('/notes/Vendor review.md'), newUri: vscode.Uri.file('/notes/Supplier review.md') }];
    /** Asks for the rename as VS Code does, and waits on the edit it is handed. */
    const plan = async (): Promise<void> => {
      const waited: Thenable<unknown>[] = [];
      willRename.fire({
        files,
        token: new vscode.CancellationTokenSource().token,
        waitUntil: (thenable: Thenable<unknown>) => void waited.push(thenable),
      } as vscode.FileWillRenameEvent);
      await Promise.all(waited);
    };
    try {
      await plan();
      assert.deepStrictEqual(shown, [], 'nothing is said while VS Code waits on the edit');
      // The reader cancels the rename, so VS Code never says it was made.
      await plan();
      didRename.fire({ files: [{ oldUri: files[0].oldUri, newUri: vscode.Uri.file('/notes/Other.md') }] });
      assert.deepStrictEqual(shown, [], 'nor for another rename made meanwhile');
      didRename.fire({ files });
      assert.deepStrictEqual(shown, ['Deckard updated 2 links in 1 note.']);
      didRename.fire({ files });
      assert.strictEqual(shown.length, 1, 'it is said once');
    } finally {
      window.showInformationMessage = showInformationMessage;
      maintenance.dispose();
      willRename.dispose();
      didRename.dispose();
    }
  });
});

async function createTemporaryRoot(): Promise<vscode.Uri> {
  const directoryName = `deckard-links-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
