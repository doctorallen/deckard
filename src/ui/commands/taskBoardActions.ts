import * as vscode from 'vscode';

import { readCaptureText } from '../../domain/markdown/captureWords';
import { readDateOptions } from './datePrompt';
import { resolveColumnCapture } from '../../domain/tasks/boardMoves';
import { QueryContext } from '../../domain/query/queryContext';
import { Task } from '../../core/types';
import {
  isValidStatusName,
  resolveTaskMove,
  TaskBoardOptions,
  TaskMoveContext,
} from '../state/taskBoardState';
import {
  readTaskMetadataFormat,
  TaskWrites,
  toggleTask,
  quoteTaskTitle,
  updateTaskLine,
} from './taskActions';
import { writeSetting } from './settings';
import { captureToToday, formatCaptureLine } from './capture';
import { appendTagToLine } from './bulkEdit';
import { readQueryContext } from './queryContext';

const DEFAULT_STATUSES = ['todo', 'doing', 'waiting'];

/**
 * Reads the task board settings. Every page that shows a board reads them
 * here, so the Task Board and the Dashboard lay out the same columns. The
 * board is built in `queryContext`, which its caller read as it began.
 */
export function readTaskBoardOptions(queryContext: QueryContext): TaskBoardOptions {
  const configuration = vscode.workspace.getConfiguration('deckard');
  const namespace = configuration.get<string>(
    'board.statusNamespace',
    'status',
  );
  const statuses = configuration.get<unknown>(
    'board.statuses',
    DEFAULT_STATUSES,
  );
  return {
    queryContext,
    statusNamespace: /^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace)
      ? namespace.toLowerCase()
      : 'status',
    statuses: (Array.isArray(statuses) ? statuses : DEFAULT_STATUSES)
      .filter(
        (status): status is string =>
          typeof status === 'string' && isValidStatusName(status),
      )
      .map((status) => status.toLowerCase()),
    format: readTaskMetadataFormat(configuration),
    limits: readBoardLimits(configuration.get<unknown>('board.limits', {})),
  };
}

/**
 * Writes one of the `deckard.board` settings from the Task Board's view
 * options, where the reader already chose it. The value goes where it is
 * already set, so a workspace that sets its own columns keeps them there.
 */
export async function updateTaskBoardSetting(
  key: 'statuses' | 'statusNamespace',
  value: string[] | string,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('deckard');
  const current = configuration.inspect(`board.${key}`);
  const target =
    current?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await writeSetting(`board.${key}`, value, target, configuration);
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
 * Captures a task straight into a board column: the words read as Capture
 * reads them, then the edit the column stands for made to the line, so the
 * task lands in today's note already in the column it was added from.
 */
export async function captureIntoColumn(columnId: string): Promise<boolean> {
  const text = await vscode.window.showInputBox({
    title: 'Add a task to this column',
    prompt: "It goes in today's note. A date, priority, or repeat rule at the end is read as Capture reads it: Call Ren friday p2",
    placeHolder: 'Call Ren about the #project/atlas budget',
  });
  if (!text?.trim()) {
    return false;
  }
  const configuration = vscode.workspace.getConfiguration('deckard');
  const queryContext = readQueryContext();
  const line = readCaptureText(
    formatCaptureLine(text),
    readTaskMetadataFormat(configuration),
    queryContext.now,
    readDateOptions(),
  ).line;
  const captured = resolveColumnCapture(line, (task) =>
    resolveTaskMove(task, columnId, readTaskBoardOptions(queryContext)),
  );
  if (captured.kind === 'refused') {
    void vscode.window.showInformationMessage(captured.reason);
    return false;
  }
  return captureToToday(text, captured.line);
}

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
 * words are read as Capture reads them, the tag is written at the end, and
 * the task goes into today's note.
 */
export async function captureNextAction(tagLabel: string): Promise<boolean> {
  const text = await vscode.window.showInputBox({
    title: `Next action for ${tagLabel}`,
    prompt: "It goes in today's note, with the tag. A date, priority, or repeat rule at the end is read as Capture reads it: Call Ren friday p2",
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
