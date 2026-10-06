import * as vscode from 'vscode';

import { getEntityNamespaceAliases } from '../../domain/markdown/parser';
import { createQueryContext, QueryContext } from '../../domain/query/queryContext';
import { readStatusNamespace, TaskPolicy } from '../../domain/tasks/taskPolicy';
import { readTaskStatusSettings } from '../../domain/tasks/taskStatuses';
import { readWeekStart } from './datePrompt';
import { readDateFormats } from './displaySettings';

/**
 * The QueryContext a view, command, or tool works in, read from settings at
 * the moment it starts its work: who `deckard.me` names, the week start of
 * `deckard.calendar.weekStart`, the task policy, and the namespace aliases
 * of `deckard.entityNamespaceAliases` over the built-in ones (the aliases the
 * index was built with, so a tag written the way a note writes it is found),
 * at `now`.
 *
 * Every entry point reads it once and hands it down, so a setting changed a
 * moment ago is what the next evaluation uses, and the pure code below never
 * reads a setting or the clock itself. The settings are read without a
 * scope, from the workspace as a whole.
 */
export function readQueryContext(now: number = Date.now()): QueryContext {
  const configuration = vscode.workspace.getConfiguration('deckard');
  return createQueryContext(now, {
    identity: configuration.get<unknown>('me', '') as string,
    weekStart: readWeekStart(),
    taskPolicy: readTaskPolicy(),
    entityNamespaceAliases: getEntityNamespaceAliases(configuration.get<unknown>('entityNamespaceAliases', {})),
    dateFormats: readDateFormats(),
  });
}

/**
 * How Deckard reads tasks, from settings: `deckard.tasks.needsNewDateAfterDays`
 * as a whole number of days, 0 or more (30 for anything that is not a
 * number); `deckard.board.statusNamespace` as readStatusNamespace reads it; and
 * `deckard.tasks.statuses` as readTaskStatusSettings reads it.
 */
export function readTaskPolicy(): TaskPolicy {
  const configuration = vscode.workspace.getConfiguration('deckard');
  const days = configuration.get<number>('tasks.needsNewDateAfterDays', 30);
  return {
    needsNewDateAfterDays: Number.isFinite(days) ? Math.max(0, Math.round(days)) : 30,
    statusNamespace: readStatusNamespace(configuration),
    statuses: readTaskStatusSettings(configuration),
  };
}
