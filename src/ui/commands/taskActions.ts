import * as vscode from 'vscode';

import { getTaskLineId } from '../../core/markdown/parser';
import {
  createNextOccurrence,
  formatIsoDate,
  parseTaskMetadata,
  setTaskLineCompletion,
  TaskMetadataFormat,
} from '../../core/markdown/taskMetadata';
import { Task } from '../../core/types';
import { openSourceAt, resolveSourceUri } from './navigation';

/**
 * Carries a task's place in the rank order from the line it was to the line
 * it becomes. Set once, where the preferences live, the way the timing log is.
 */
type TaskRankKeeper = (previousId: string, nextId: string) => void;

let keepTaskRank: TaskRankKeeper | undefined;

export function setTaskRankKeeper(keeper: TaskRankKeeper | undefined): void {
  keepTaskRank = keeper;
}

/**
 * Tells the rank order that a task's line was rewritten, so a completed task
 * and a task put back by Undo both keep the place they were dragged to.
 */
function carryRank(
  filePath: string,
  lineNumber: number,
  previousId: string,
  replacement: string,
): void {
  if (!keepTaskRank) {
    return;
  }
  // A completion may add a line above, so the task is the last line written.
  const lines = replacement.split(/\r?\n/);
  const nextId = getTaskLineId(
    filePath,
    lineNumber + lines.length - 1,
    lines[lines.length - 1],
  );
  if (nextId) {
    keepTaskRank(previousId, nextId);
  }
}

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
  /**
   * What to tell the reader was written, such as "Completed 'Send proposal'".
   * An edit that says what it did is offered with an Undo; one that passes
   * nothing is silent, for edits the reader is already watching happen. A
   * function is read after the edit, for an edit that only then knows what it
   * did, such as a completion that started the next occurrence.
   */
  description?: string | (() => string),
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
    carryRank(task.filePath, task.lineNumber, task.id, replacement);
    const said = typeof description === 'function' ? description() : description;
    if (said) {
      offerUndo(
        said,
        uri,
        task.lineNumber,
        replacement,
        line,
        task.filePath,
      );
    }
    return true;
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Deckard could not update this task: ${String(error)}`,
    );
    return false;
  }
}

/**
 * Says what was written to a note, and offers to put it back.
 *
 * A board move or a checkbox writes to a file the reader may not have open,
 * saves it, and leaves no trace on screen. The message is the only account of
 * the edit, so it carries the way out of it.
 */
function offerUndo(
  description: string,
  uri: vscode.Uri,
  lineNumber: number,
  replacement: string,
  original: string,
  filePath: string,
): void {
  void vscode.window
    .showInformationMessage(description, 'Undo')
    .then((choice) => {
      if (choice === 'Undo') {
        void revertTaskLine(uri, lineNumber, replacement, original, filePath);
      }
    });
}

/**
 * Puts a task line back the way it was.
 *
 * The edit may have added a line, such as the next occurrence of a repeating
 * task, so the whole written range goes back. Anything that has changed the
 * range since is left alone rather than overwritten.
 */
async function revertTaskLine(
  uri: vscode.Uri,
  lineNumber: number,
  replacement: string,
  original: string,
  filePath?: string,
): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const writtenLines = replacement.split(/\r?\n/).length;
    const lastLine = lineNumber - 2 + writtenLines;
    if (lineNumber < 1 || lastLine >= document.lineCount) {
      void vscode.window.showWarningMessage(
        'Deckard could not undo this task edit because the note changed.',
      );
      return;
    }
    const range = new vscode.Range(
      new vscode.Position(lineNumber - 1, 0),
      document.lineAt(lastLine).range.end,
    );
    if (document.getText(range) !== replacement) {
      void vscode.window.showWarningMessage(
        'Deckard could not undo this task edit because the note changed.',
      );
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, original);
    if (await vscode.workspace.applyEdit(edit)) {
      await document.save();
      // The line is the one it was, so the task is too: give it back the
      // place in the rank order the edit carried away.
      if (filePath) {
        const written = replacement.split(/\r?\n/);
        const writtenId = getTaskLineId(
          filePath,
          lineNumber + written.length - 1,
          written[written.length - 1],
        );
        const restoredId = getTaskLineId(filePath, lineNumber, original);
        if (writtenId && restoredId && keepTaskRank) {
          keepTaskRank(writtenId, restoredId);
        }
      }
    }
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Deckard could not undo this task edit: ${String(error)}`,
    );
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
  // A repeating task is completed and immediately replaced by its next
  // occurrence, which looks like nothing happened unless the edit says so.
  let startedNext: string | undefined;
  const description = () =>
    completed
      ? `Completed ${quoteTaskTitle(task)}${
          startedNext ? `, and started the next one${startedNext}.` : '.'
        }`
      : `Reopened ${quoteTaskTitle(task)}.`;
  return updateTaskLine(
    task,
    (line, { uri, eol }) => {
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

      const nextOccurrence = createNextOccurrence(
        line,
        task.checkboxColumn,
        now,
      );
      if (nextOccurrence !== undefined) {
        startedNext = describeNextOccurrence(nextOccurrence);
        return `${nextOccurrence}${eol}${replacement}`;
      }
      if (task.recurrence) {
        void vscode.window.showWarningMessage(
          `Deckard completed the task but could not read its repeat rule "${task.recurrence}", so it did not add the next occurrence.`,
        );
      }
      return replacement;
    },
    description,
  );
}

/** When the occurrence a completion started is next wanted, if it says. */
function describeNextOccurrence(line: string): string {
  const { metadata } = parseTaskMetadata(line);
  const when = metadata.due ?? metadata.scheduled ?? metadata.start;
  return when ? `, ${metadata.due ? 'due' : 'scheduled'} ${when}` : '';
}

/** A task's title, short enough to sit in a notification. */
export function quoteTaskTitle(task: Task): string {
  const title = task.title.trim();
  return `"${title.length > 60 ? `${title.slice(0, 57)}…` : title}"`;
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
