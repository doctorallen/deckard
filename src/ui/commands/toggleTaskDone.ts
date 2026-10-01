import * as vscode from 'vscode';

import { selectedLines, ToggleResult } from '../../domain/tasks/toggleLines';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { TaskService } from '../../services/taskService';
import { describeRejectedEdit, noteName, reportFailure } from './notify';
import { describeCompletion, quoteTitle } from './taskActions';

// Toggle Task Done's rule moved to domain/tasks; its names stay here for the
// modules that import them from the command.
export { selectedLines, toggleTaskLines } from '../../domain/tasks/toggleLines';
export type { ToggledLine, ToggleResult } from '../../domain/tasks/toggleLines';

/** The sentence a toggle says in the status bar, or as a warning. */
export function describeToggle(result: ToggleResult): { text: string; severity: 'info' | 'warning' } {
  const [first] = result.lines;
  if (result.lines.length === 1) {
    return result.completed
      ? describeCompletion(first.title, first.next, first.unreadRule)
      : { text: `Reopened ${quoteTitle(first.title)}.`, severity: 'info' };
  }
  const count = result.lines.length;
  if (!result.completed) {
    return { text: `Reopened ${count} tasks.`, severity: 'info' };
  }
  const unread = result.lines.find((line) => line.unreadRule !== undefined);
  if (unread) {
    return {
      text: `Completed ${count} tasks. Deckard could not read the repeat rule "${unread.unreadRule}" of ${quoteTitle(unread.title)}, so no next one was added.`,
      severity: 'warning',
    };
  }
  const started = result.lines.filter((line) => line.next !== undefined).length;
  return {
    text:
      started > 0
        ? `Completed ${count} tasks, and started the next one of ${started === 1 ? '1 repeating task' : `${started} repeating tasks`}.`
        : `Completed ${count} tasks.`,
    severity: 'info',
  };
}

/** Where a task's rank is kept: the index's own path for the note. */
interface RankPaths {
  getFilePath(uri: vscode.Uri): string;
}

/**
 * What Toggle Task Done writes through: the task service, which toggles the
 * lines and carries each task's rank, and the index's path for the note,
 * which the ranks are kept by.
 */
export interface TaskToggle {
  tasks: TaskService<vscode.Uri, unknown>;
  paths: RankPaths;
}

/**
 * Completes or reopens every task under the editor's cursors in one edit, so
 * one Undo takes it all back. It writes into the buffer rather than through
 * the index, so an unsaved note works like any other.
 */
export async function toggleTaskDoneCommand(
  toggle: TaskToggle,
  now: number = Date.now(),
): Promise<ToggleResult | undefined> {
  const editor = vscode.window.activeTextEditor;
  // An untitled note set to Markdown is a note too; it has no file name yet.
  if (
    !editor ||
    !(isMarkdownFile(editor.document.uri) || editor.document.languageId === 'markdown')
  ) {
    void vscode.window.showInformationMessage('Put the cursor on a task to mark it done.');
    return undefined;
  }
  const document = editor.document;
  const outcome = await toggle.tasks.toggleLines(
    {
      uri: document.uri,
      lines: selectedLines(editor.selections).map((line) => ({ line, text: document.lineAt(line).text })),
      documentLines: document.getText().split(/\r?\n/),
      eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
      now,
      // Each task keeps its place in the rank order; an untitled note has
      // no place in the index to keep it by.
      ...(document.isUntitled ? {} : { filePath: toggle.paths.getFilePath(document.uri) }),
    },
    (lines) =>
      editor.edit((builder) => {
        for (const toggled of [...lines].reverse()) {
          builder.replace(document.lineAt(toggled.line).range, toggled.after);
        }
      }),
  );
  if (outcome.kind === 'none') {
    void vscode.window.showInformationMessage('Put the cursor on a task to mark it done.');
    return undefined;
  }
  if (outcome.kind === 'rejected') {
    void reportFailure(describeRejectedEdit(noteName(document.uri)));
    return undefined;
  }

  const said = describeToggle(outcome.result);
  if (said.severity === 'warning') {
    void vscode.window.showWarningMessage(said.text);
  } else {
    vscode.window.setStatusBarMessage(said.text, 5000);
  }
  return outcome.result;
}
