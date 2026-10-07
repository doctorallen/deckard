import * as vscode from 'vscode';

import { readCaptureText } from '../../domain/markdown/captureWords';
import { readDateOptions } from './datePrompt';
import { ColumnCapture, resolveColumnCapture } from '../../domain/tasks/boardMoves';
import { QueryContext } from '../../domain/query/queryContext';
import { resolveTaskMove, TaskBoardOptions, TaskMoveContext } from '../state/taskBoardState';
import {
  readTaskMetadataFormat,
  TaskWrites,
  toggleTask,
  quoteTaskTitle,
  updateTaskLine,
} from './taskActions';
import { captureToToday } from './capture';
import { appendTagToLine } from './bulkEdit';
import { readQueryContext } from './queryContext';
import { formatCaptureLine } from '../../domain/capture/captureLines';
import { Task } from '../../domain/model';

/**
 * Reads the task board settings. Every page that shows a board reads them
 * here, so the Task Board and the Dashboard lay out the same columns. The
 * board is built in `queryContext`, which its caller read as it began.
 */
export function readTaskBoardOptions(queryContext: QueryContext): TaskBoardOptions {
  const configuration = vscode.workspace.getConfiguration('deckard');
  return {
    queryContext,
    format: readTaskMetadataFormat(configuration),
    limits: readBoardLimits(configuration.get<unknown>('board.limits', {})),
  };
}

/**
 * Writes a card's move to another column into its task line.
 *
 * Returns false when nothing was saved, so the page can redraw the board and
 * put a card it moved ahead of time back where it belongs.
 */
export async function moveTaskToColumn(
  writes: TaskWrites,
  task: Task,
  columnId: string,
  context: TaskMoveContext = {},
): Promise<boolean> {
  const move = resolveTaskMove(task, columnId, readTaskBoardOptions(readQueryContext()), context);
  switch (move.kind) {
    case 'unchanged':
      return false;
    case 'complete':
      return toggleTask(writes, task, true);
    case 'edit':
      return updateTaskLine(
        writes,
        task,
        (line) => move.edit(line),
        `Moved ${quoteTaskTitle(task)} to ${move.label}`,
      );
    case 'refused':
      void vscode.window.showInformationMessage(move.reason);
      return false;
  }
}

/**
 * The task a board column's + Add task starts Add Task on: an empty task
 * with the edit the column stands for made to it, so it opens already in
 * the column, its status, priority, due date, person, or tag filled in.
 * A column that names no edit for a new task, such as Done, starts an
 * empty one; one that refuses says why.
 */
export function startColumnTask(columnId: string): ColumnCapture {
  const queryContext = readQueryContext();
  return resolveColumnCapture(COLUMN_TASK, (task) =>
    resolveTaskMove(task, columnId, readTaskBoardOptions(queryContext)),
  );
}

/** The empty task a column's edit is made to. */
const COLUMN_TASK = '- [ ] ';

/** `deckard.board.limits`, keeping only whole numbers of one or more. */
export function readBoardLimits(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] >= 1,
    ),
  );
}

/**
 * A next action for a tag with nothing open, the stuck-projects review: the
 * words are read as Add Task reads them, the tag is written at the end, and
 * the task goes into today's note.
 */
export async function captureNextAction(tagLabel: string): Promise<boolean> {
  const text = await vscode.window.showInputBox({
    title: `Next action for ${tagLabel}`,
    prompt: "It goes in today's note, with the tag. A date, priority, or repeat rule at the end fills its field: Call Ren friday p2",
    placeHolder: 'Draft the kickoff agenda',
    ignoreFocusOut: true,
  });
  if (!text?.trim()) {
    return false;
  }
  const line = readCaptureText(
    formatCaptureLine(text),
    readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard')),
    Date.now(),
    readDateOptions(),
  ).line;
  return captureToToday(text, appendTagToLine(line, tagLabel));
}
