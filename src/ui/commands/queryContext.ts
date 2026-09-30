import * as vscode from 'vscode';

import { createQueryContext, QueryContext } from '../../domain/query/queryContext';
import { TaskPolicy } from '../../domain/tasks/taskPolicy';
import { readWeekStart } from './datePrompt';

/**
 * The QueryContext a view, command, or tool works in, read from settings at
 * the moment it starts its work: who `deckard.me` names, the week start of
 * `deckard.calendar.weekStart`, and the task policy, at `now`.
 *
 * Every entry point reads it once and hands it down, so a setting changed a
 * moment ago is what the next evaluation uses, and the pure code below never
 * reads a setting or the clock itself. The settings are read without a
 * scope, from the workspace as a whole.
 */
export function readQueryContext(now: number = Date.now()): QueryContext {
  return createQueryContext(now, {
    identity: vscode.workspace.getConfiguration('deckard').get<string>('me', ''),
    weekStart: readWeekStart(),
    taskPolicy: readTaskPolicy(),
  });
}

/**
 * How Deckard reads tasks, from settings: `deckard.tasks.needsNewDateAfterDays`
 * as a whole number of days, 0 or more (30 for anything that is not a
 * number); `deckard.board.statusNamespace` trimmed (`status` when empty); and
 * `deckard.tasks.onHoldStatuses` trimmed and lowercased, its blanks and
 * non-strings dropped (`waiting` and `someday` when it is not a list).
 */
export function readTaskPolicy(): TaskPolicy {
  const configuration = vscode.workspace.getConfiguration('deckard');
  const days = configuration.get<number>('tasks.needsNewDateAfterDays', 30);
  const onHold = configuration.get<unknown>('tasks.onHoldStatuses', ['waiting', 'someday']);
  return {
    needsNewDateAfterDays: Number.isFinite(days) ? Math.max(0, Math.round(days)) : 30,
    statusNamespace:
      configuration.get<string>('board.statusNamespace', 'status').trim() || 'status',
    onHoldStatuses: Array.isArray(onHold)
      ? onHold.filter((status): status is string => typeof status === 'string')
          .map((status) => status.trim().toLowerCase())
          .filter(Boolean)
      : ['waiting', 'someday'],
  };
}
