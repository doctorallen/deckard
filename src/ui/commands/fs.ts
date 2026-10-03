import * as vscode from 'vscode';

/**
 * Whether anything, a file or a folder, is at `uri`. Any failure to stat it
 * counts as nothing there, so a missing parent folder or a permission error
 * answers false rather than throwing: every caller asks only so it can
 * create the thing or refuse to overwrite it.
 *
 * `fs` is VS Code's file system unless a caller hands in its own, as the
 * sample workspace does so its tests can run on an in-memory one.
 */
export async function fileExists(
  uri: vscode.Uri,
  fs: Pick<vscode.FileSystem, 'stat'> = vscode.workspace.fs,
): Promise<boolean> {
  try {
    await fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
