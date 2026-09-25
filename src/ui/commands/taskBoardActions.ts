import * as vscode from 'vscode';

import { readCaptureText } from '../../core/markdown/captureWords';
import { parseMarkdown } from '../../core/markdown/parser';
import { Task } from '../../core/types';
import {
  isValidStatusName,
  resolveTaskMove,
  TaskBoardOptions,
} from '../state/taskBoardState';
import {
  readTaskMetadataFormat,
  toggleTask,
  quoteTaskTitle,
  updateTaskLine,
} from './taskActions';
import { writeSetting } from './settings';
import { captureToToday, formatCaptureLine } from './capture';

const DEFAULT_STATUSES = ['todo', 'doing', 'waiting'];

/**
 * Reads the task board settings. Every page that shows a board reads them
 * here, so the Task Board and the Dashboard lay out the same columns.
 */
export function readTaskBoardOptions(): TaskBoardOptions {
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
    now: Date.now(),
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
  task: Task,
  columnId: string,
): Promise<boolean> {
  const move = resolveTaskMove(task, columnId, readTaskBoardOptions());
  switch (move.kind) {
    case 'unchanged':
      return false;
    case 'complete':
      return toggleTask(task, true);
    case 'edit':
      return updateTaskLine(
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
  let line = readCaptureText(
    formatCaptureLine(text),
    readTaskMetadataFormat(configuration),
  ).line;
  const [task] = parseMarkdown('capture.md', line).tasks;
  const move = task ? resolveTaskMove(task, columnId, readTaskBoardOptions()) : undefined;
  if (move?.kind === 'refused') {
    void vscode.window.showInformationMessage(move.reason);
    return false;
  }
  if (move?.kind === 'edit') {
    line = move.edit(line);
  }
  return captureToToday(text, line);
}
