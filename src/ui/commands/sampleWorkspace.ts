import * as vscode from 'vscode';

/**
 * Somewhere to start.
 *
 * The walkthrough says what a tag and a hub note are; it cannot show one
 * being found. Seven small notes, written the way Deckard reads them, can.
 * They are copied into a folder the reader chooses, in a folder of their
 * own so nothing already there is touched, and offered to be opened.
 */

export const SAMPLE_FOLDER_NAME = 'deckard-sample';

interface SampleFileAccess {
  copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }): Thenable<void>;
  stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
  readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
}

/** Where the shipped sample lives, inside the installed extension. */
export function getSampleSourceUri(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'resources', 'sample');
}

/**
 * Copies the sample into `parent`, as `parent/deckard-sample`. Refuses,
 * rather than merging, when that folder is already there: a sample that
 * lands on top of someone's notes is not a sample.
 */
export async function installSample(
  extensionUri: vscode.Uri,
  parent: vscode.Uri,
  fs: SampleFileAccess = vscode.workspace.fs,
): Promise<{ target: vscode.Uri; files: string[] }> {
  const target = vscode.Uri.joinPath(parent, SAMPLE_FOLDER_NAME);
  if (await exists(fs, target)) {
    throw new Error(
      `There is already a "${SAMPLE_FOLDER_NAME}" folder in ${parent.fsPath}. Move it aside, or choose another folder.`,
    );
  }
  await fs.copy(getSampleSourceUri(extensionUri), target, { overwrite: false });
  const files = (await fs.readDirectory(target))
    .filter(([, type]) => type === vscode.FileType.File)
    .map(([name]) => name)
    .sort();
  return { target, files };
}

export async function createSampleWorkspace(extensionUri: vscode.Uri): Promise<void> {
  const chosen = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Put the sample here',
    title: `Deckard will create a "${SAMPLE_FOLDER_NAME}" folder inside the folder you choose`,
  });
  const parent = chosen?.[0];
  if (!parent) {
    return;
  }
  let created: { target: vscode.Uri; files: string[] };
  try {
    created = await installSample(extensionUri, parent);
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Created ${created.files.length} sample notes in ${created.target.fsPath}. Open it? Its README says what to try.`,
    'Open',
    'Open in New Window',
  );
  if (choice) {
    await vscode.commands.executeCommand('vscode.openFolder', created.target, {
      forceNewWindow: choice === 'Open in New Window',
    });
  }
}

async function exists(fs: SampleFileAccess, uri: vscode.Uri): Promise<boolean> {
  try {
    await fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
