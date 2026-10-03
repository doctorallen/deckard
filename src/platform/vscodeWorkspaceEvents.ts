import * as vscode from 'vscode';

import type { WorkspaceEvents } from '../ports/workspaceEvents';
import { toRelativePattern } from './vscodeWorkspace';

/**
 * The VS Code workspace's own events behind the port. Each subscription
 * goes to the `vscode.workspace` event it names when it is made, with
 * exactly the arguments it was given, and each watcher is a VS
 * Code file-system watcher over the same `RelativePattern` the index asked
 * for, reporting creates, changes, and deletes.
 */
export function createVscodeWorkspaceEvents(): WorkspaceEvents<vscode.Uri> {
  return {
    onDidChangeConfiguration: (...args) => vscode.workspace.onDidChangeConfiguration(...args),
    onDidChangeWorkspaceFolders: (...args) => vscode.workspace.onDidChangeWorkspaceFolders(...args),
    onDidSaveTextDocument: (...args) => vscode.workspace.onDidSaveTextDocument(...args),
    createFileSystemWatcher: (pattern) =>
      vscode.workspace.createFileSystemWatcher(toRelativePattern(pattern)),
  };
}
