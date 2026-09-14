import * as vscode from 'vscode';

import {
  createNextOccurrence,
  formatIsoDate,
  setTaskLineCompletion,
  TaskMetadataFormat,
} from '../../core/markdown/taskMetadata';
import { Task } from '../../core/types';
import { openSourceAt, resolveSourceUri } from './navigation';

/** What an edit to a task line may need to know about its document. */
export interface TaskLineContext {
  uri: vscode.Uri;
  /** The document's line ending, for an edit that adds a line. */
  eol: string;
}

/**
 * Rewrites a task's line after proving the indexed source is unchanged.
 *
 * The line comparison prevents a delayed webview action from overwriting edits
 * made after the task was indexed. Every edit Deckard makes to a task, from
 * its checkbox to a task-board move, goes through here.
 */
export async function updateTaskLine(
  task: Task,
  transform: (line: string, context: TaskLineContext) => string,
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

    const sourceLine = document.lineAt(task.lineNumber - 1);
    const line = sourceLine.text;
    if (
      line !== task.sourceLineText ||
      line[task.checkboxColumn] !== task.checkboxValue ||
      line[task.checkboxColumn - 1] !== '[' ||
      line[task.checkboxColumn + 1] !== ']'
    ) {
      void vscode.window.showWarningMessage(
        'Deckard could not update this task because the source line changed.',
      );
      return false;
    }

    const replacement = transform(line, {
      uri,
      eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    });
    if (replacement === line) {
      return true;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, sourceLine.range, replacement);
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
 * Completes or reopens a task.
 *
 * Besides the checkbox, the edit keeps the Obsidian Tasks metadata in step: a
 * done date is added on completion and removed on reopening, and completing a
 * task with a repeat rule writes its next occurrence on the line above, where
 * Tasks puts it.
 */
export async function toggleTask(
  task: Task,
  completed: boolean,
): Promise<boolean> {
  return updateTaskLine(task, (line, { uri, eol }) => {
    const now = Date.now();
    const configuration = vscode.workspace.getConfiguration('deckard', uri);
    const addDoneDate = configuration.get<boolean>('tasks.addDoneDate', true);
    const replacement = setTaskLineCompletion(
      line,
      task.checkboxColumn,
      completed,
      addDoneDate ? formatIsoDate(now) : undefined,
      readTaskMetadataFormat(configuration),
    );
    if (!completed || task.completed) {
      return replacement;
    }

    const nextOccurrence = createNextOccurrence(line, task.checkboxColumn, now);
    if (nextOccurrence !== undefined) {
      return `${nextOccurrence}${eol}${replacement}`;
    }
    if (task.recurrence) {
      void vscode.window.showWarningMessage(
        `Deckard completed the task but could not read its repeat rule "${task.recurrence}", so it did not add the next occurrence.`,
      );
    }
    return replacement;
  });
}

/**
 * The Tasks format Deckard writes for a task that has no metadata yet. A task
 * that already has some keeps its own format.
 */
export function readTaskMetadataFormat(
  configuration: vscode.WorkspaceConfiguration,
): TaskMetadataFormat {
  return configuration.get<string>('tasks.metadataFormat', 'emoji') ===
    'dataview'
    ? 'dataview'
    : 'emoji';
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
