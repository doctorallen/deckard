import * as path from 'path';

import * as vscode from 'vscode';

/**
 * Resolves a stored source key across absolute paths, URI schemes, and roots.
 *
 * Existing-file checks disambiguate multi-root relative paths; the first
 * candidate is still returned as a fallback so callers can surface a useful
 * VS Code error for a file that disappeared after indexing.
 */
export async function resolveSourceUri(
  filePath: string,
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode
    .workspace.workspaceFolders,
): Promise<vscode.Uri | undefined> {
  if (isAbsoluteFilePath(filePath)) {
    return vscode.Uri.file(filePath);
  }

  if (hasUriScheme(filePath)) {
    return vscode.Uri.parse(filePath);
  }

  const normalizedPath = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const candidates: vscode.Uri[] = [];

  for (const workspaceFolder of workspaceFolders ?? []) {
    const pathParts = normalizedPath.split('/');
    if (
      workspaceFolders &&
      workspaceFolders.length > 1 &&
      pathParts[0] === workspaceFolder.name
    ) {
      candidates.push(
        vscode.Uri.joinPath(workspaceFolder.uri, ...pathParts.slice(1)),
      );
    }
    candidates.push(vscode.Uri.joinPath(workspaceFolder.uri, ...pathParts));
  }

  for (const candidate of candidates) {
    try {
      await vscode.workspace.fs.stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return candidates[0];
}

/**
 * Opens a one-based source line and centers it without altering the document.
 */
export async function openSourceAt(
  filePath: string,
  line: number,
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
): Promise<vscode.TextEditor | undefined> {
  const uri = await resolveSourceUri(filePath, workspaceFolders);
  if (!uri) {
    void vscode.window.showWarningMessage(
      `Deckard could not resolve source file: ${filePath}`,
    );
    return undefined;
  }

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
    });
    const lineIndex = Math.min(
      Math.max(line - 1, 0),
      Math.max(document.lineCount - 1, 0),
    );
    const position = new vscode.Position(lineIndex, 0);
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      range,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
    return editor;
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Deckard could not open ${filePath}: ${String(error)}`,
    );
    return undefined;
  }
}

/**
 * Recognizes URI-like source keys before treating them as workspace paths.
 */
function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value);
}

/**
 * Handles native paths plus Windows drive and UNC paths on every host OS.
 */
function isAbsoluteFilePath(value: string): boolean {
  return (
    path.isAbsolute(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value)
  );
}
