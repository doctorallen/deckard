import * as vscode from 'vscode';

import type { Configuration } from '../ports/configuration';
import type { FileSystem } from '../ports/fileSystem';
import type { FolderPattern, WorkspaceFiles } from '../ports/workspace';

/**
 * The VS Code workspace as the ports the index reads it through: its
 * folders, finding and naming files, the settings, and its file system, all
 * in VS Code's own `Uri`.
 */
export type VscodeWorkspace = WorkspaceFiles<vscode.Uri> &
  Configuration<vscode.Uri> &
  FileSystem<vscode.Uri> & { isPaused(): boolean };

/**
 * The live VS Code workspace behind the ports, and whether Deckard is
 * paused in it, as `options` says. Each call goes straight to
 * the VS Code API it names, with the arguments it was given, and
 * `workspaceFolders` is read each time it is asked for, so a folder added
 * or removed is seen at once.
 */
export function createVscodeWorkspace(options: { isPaused?: () => boolean } = {}): VscodeWorkspace {
  return {
    isPaused: () => options.isPaused?.() ?? false,
    get workspaceFolders() {
      return vscode.workspace.workspaceFolders;
    },
    findFiles: (include, exclude, maxResults) =>
      vscode.workspace.findFiles(
        toRelativePattern(include),
        exclude ? toRelativePattern(exclude) : undefined,
        maxResults,
      ),
    asRelativePath: (uri, includeWorkspaceFolder) =>
      vscode.workspace.asRelativePath(uri, includeWorkspaceFolder),
    // Forwards exactly the arguments given, so a read without a scope stays
    // one without a scope.
    getConfiguration: (...args: [section: string, scope?: vscode.Uri]) =>
      vscode.workspace.getConfiguration(...args),
    joinPath: (base, ...segments) => vscode.Uri.joinPath(base, ...segments),
    stat: (uri) => vscode.workspace.fs.stat(uri),
    readFile: (uri) => vscode.workspace.fs.readFile(uri),
    writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
    readDirectory: (uri) => vscode.workspace.fs.readDirectory(uri),
    createDirectory: (uri) => vscode.workspace.fs.createDirectory(uri),
    delete: (uri) => vscode.workspace.fs.delete(uri),
  };
}

/**
 * The `RelativePattern` a folder pattern names, built on the workspace
 * folder itself, as the scanner built it before it had ports.
 */
export function toRelativePattern(
  pattern: FolderPattern<vscode.Uri>,
): vscode.RelativePattern {
  return new vscode.RelativePattern(pattern.folder, pattern.pattern);
}
