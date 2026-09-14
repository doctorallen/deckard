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
  updateTaskLine,
} from './taskActions';

const DEFAULT_STATUSES = ['todo', 'doing', 'waiting'];

/**
 * Reads the task board settings. Every page that shows a board reads them
 * here, so the Task Board and the Dashboard lay out the same columns.
 */
export function readTaskBoardOptions(): TaskBoardOptions {
  const configuration = vscode.workspace.getConfiguration('deckard');
  const namespace = configuration.get<string>('board.statusNamespace', 'status');
  const statuses = configuration.get<unknown>('board.statuses', DEFAULT_STATUSES);
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
      return updateTaskLine(task, (line) => move.edit(line));
    case 'refused':
      void vscode.window.showInformationMessage(move.reason);
      return false;
  }
}
