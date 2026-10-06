import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import type { Task } from '../../domain/model';
import { readTaskStatus } from '../../domain/tasks/taskStatuses';
import { readStatusNamespace } from '../../domain/tasks/taskPolicy';
import { isTaskLine } from '../../domain/markdown/taskDraft';
import { setTaskStatusTo, TaskWrites } from './taskActions';
import { createStatusPicks, readDraftStatusReading } from './taskEditor';

/**
 * Set Task Status…: every status a task can have, in a quick pick, and the
 * one chosen written as the board and the task editor write it. It works on
 * the task on the cursor's line, or on the task a view or a card's menu
 * passes.
 */
export async function setTaskStatusCommand(
  indexer: Pick<IndexReader, 'getSnapshot' | 'getFilePath'>,
  writes: TaskWrites,
  given?: Task,
): Promise<void> {
  const task = given ?? findCursorTask(indexer);
  if (!task) {
    void vscode.window.showInformationMessage(
      'Put the cursor on a task line to set its status, or choose Set Task Status… on a task in the Tasks view or the Task board.',
    );
    return;
  }
  const scope = vscode.window.activeTextEditor?.document.uri;
  const reading = readDraftStatusReading(scope);
  const current = readTaskStatus(task, reading.statuses, readStatusNamespace(vscode.workspace.getConfiguration('deckard', scope)));
  const chosen = await vscode.window.showQuickPick(createStatusPicks(reading.statuses, current.name), {
    title: `Set the status of "${task.title}"`,
    placeHolder: `Now ${current.name}`,
  });
  if (chosen && chosen.status.name !== current.name) {
    await setTaskStatusTo(writes, task, chosen.status);
  }
}

/**
 * The task the index has on the cursor's line, when the line still reads as
 * the index read it. A task typed a moment ago is found once the index has
 * read it again.
 */
function findCursorTask(indexer: Pick<IndexReader, 'getSnapshot' | 'getFilePath'>): Task | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    return undefined;
  }
  const line = editor.document.lineAt(editor.selection.active.line);
  if (!isTaskLine(line.text)) {
    return undefined;
  }
  const filePath = indexer.getFilePath(editor.document.uri);
  return [...indexer.getSnapshot().tasks.values()].find(
    (task) => task.filePath === filePath && task.lineNumber === line.lineNumber + 1 && task.sourceLineText === line.text,
  );
}
