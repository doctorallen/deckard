import * as vscode from 'vscode';

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
  await configuration.update(`board.${key}`, value, target);
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
