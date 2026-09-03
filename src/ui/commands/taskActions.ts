import * as vscode from 'vscode';

import { Task } from '../../core/types';
import { openSourceAt, resolveSourceUri } from './navigation';

/**
 * Updates only a task's checkbox after proving the indexed source is unchanged.
 *
 * The line comparison prevents a delayed webview action from overwriting edits
 * made after the task was indexed.
 */
export async function toggleTask(
  task: Task,
  completed: boolean,
): Promise<boolean> {
  const uri = await resolveSourceUri(task.filePath);
  if (!uri) {
    return false;
  }

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    if (task.lineNumber < 1 || task.lineNumber > document.lineCount) {
      return false;
    }

    const line = document.lineAt(task.lineNumber - 1).text;
    const currentValue = line[task.checkboxColumn];
    if (
      line !== task.sourceLineText ||
      currentValue !== task.checkboxValue ||
      line[task.checkboxColumn - 1] !== '[' ||
      line[task.checkboxColumn + 1] !== ']'
    ) {
      void vscode.window.showWarningMessage(
        'Deckard could not update this task because the source line changed.',
      );
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    const checkboxPosition = new vscode.Position(
      task.lineNumber - 1,
      task.checkboxColumn,
    );
    edit.replace(
      uri,
      new vscode.Range(checkboxPosition, checkboxPosition.translate(0, 1)),
      completed ? 'x' : ' ',
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      return false;
    }

    const updatedDocument =
      vscode.workspace.textDocuments.find(
        (openDocument) => openDocument.uri.toString() === uri.toString(),
      ) ?? (await vscode.workspace.openTextDocument(uri));
    await updatedDocument.save();
    return true;
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Deckard could not update this task: ${String(error)}`,
    );
    return false;
  }
}

/**
 * Reuses the shared source navigation path so task clicks and section clicks
 * resolve relative and multi-root paths identically.
 */
export async function openTask(
  task: Task,
): Promise<vscode.TextEditor | undefined> {
  return openSourceAt(task.filePath, task.lineNumber);
}
