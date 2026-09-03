import * as vscode from 'vscode';

/**
 * Creates today's note idempotently and opens it in the editor.
 *
 * Existing notes are never overwritten, making the command safe to invoke from
 * both the command palette and the Related Notes shortcut.
 */
export async function createDailyNote(
  workspaceFolder?: vscode.WorkspaceFolder,
): Promise<vscode.Uri | undefined> {
  const targetFolder = workspaceFolder ?? (await chooseWorkspaceFolder());
  if (!targetFolder) {
    return undefined;
  }

  const configuration = vscode.workspace.getConfiguration(
    'deckard',
    targetFolder.uri,
  );
  const notesFolder = configuration
    .get<string>('notesFolder', 'notes')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
  const template = configuration.get<string>(
    'dailyNoteTemplate',
    '# {date}\n\n',
  );
  const notesUri = notesFolder
    ? vscode.Uri.joinPath(
        targetFolder.uri,
        ...notesFolder.split('/').filter(Boolean),
      )
    : targetFolder.uri;
  const date = formatLocalDate(new Date());
  const noteUri = vscode.Uri.joinPath(notesUri, `${date}.md`);

  await vscode.workspace.fs.createDirectory(notesUri);
  try {
    await vscode.workspace.fs.stat(noteUri);
  } catch {
    const content = template.replaceAll('{date}', date);
    await vscode.workspace.fs.writeFile(noteUri, Buffer.from(content, 'utf8'));
  }

  const document = await vscode.workspace.openTextDocument(noteUri);
  await vscode.window.showTextDocument(document, { preview: false });
  return noteUri;
}

/**
 * Chooses a root only when multi-root ambiguity makes implicit selection unsafe.
 */
async function chooseWorkspaceFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage(
      'Open a workspace before creating a Deckard daily note.',
    );
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: 'Choose a workspace for the daily note' },
  );
  return picked?.folder;
}

/**
 * Uses local calendar fields so a daily note is named for the user's day, not
 * the previous or next UTC day around a timezone boundary.
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
