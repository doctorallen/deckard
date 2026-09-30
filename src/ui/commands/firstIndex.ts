import * as vscode from 'vscode';

import { QueryContext } from '../../core/query/queryContext';
import { pluralize } from '../../core/text';
import { WorkspaceIndex } from '../../core/types';
import { createAgenda } from '../state/agendaState';
import { openSettingAction, settingLabel } from './notify';
import { readQueryContext } from './queryContext';

/**
 * What a workspace's first index found, said once.
 *
 * The first scan of a workspace used to finish in silence, so a reader could
 * not tell whether Deckard had read their notes or found nothing in them. It
 * now says how many notes, open tasks, and tags it read, once per workspace,
 * and only for a workspace Deckard had never stored anything for.
 */

export const FIRST_INDEX_SUMMARY_SHOWN = 'deckard.firstIndexSummaryShown';
/** At this many notes, the summary also says how to leave folders out. */
export const LARGE_WORKSPACE_NOTES = 3000;

export interface FirstIndexCounts {
  notes: number;
  openTasks: number;
  overdue: number;
  tags: number;
}

/** One sentence: `Deckard read 412 notes: 1,204 open tasks (17 overdue) and 185 tags.` */
export function describeFirstIndex(counts: FirstIndexCounts): string {
  const notes = pluralize(counts.notes, 'note', 'notes', { locale: true });
  const tasks =
    counts.openTasks > 0
      ? `${pluralize(counts.openTasks, 'open task', 'open tasks', { locale: true })}${
          counts.overdue > 0 ? ` (${counts.overdue.toLocaleString('en-US')} overdue)` : ''
        }`
      : '';
  const tags = counts.tags > 0 ? pluralize(counts.tags, 'tag', 'tags', { locale: true }) : '';
  if (tasks && tags) {
    return `Deckard read ${notes}: ${tasks} and ${tags}.`;
  }
  if (tasks) {
    return `Deckard read ${notes}: ${tasks}.`;
  }
  if (tags) {
    return `Deckard read ${notes} and ${tags}.`;
  }
  return `Deckard read ${notes}.`;
}

/**
 * The counts, with overdue as the Tasks view's Overdue group over every open
 * task on the context's today, so a task long past its date that needs a new
 * one is not counted.
 */
export function countFirstIndex(
  index: WorkspaceIndex,
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
): FirstIndexCounts {
  const open = [...index.tasks.values()].filter((task) => !task.completed);
  const overdue =
    createAgenda(index, context, { tasks: open, upcomingDays: 7 }).find((group) => group.id === 'overdue')
      ?.entries.length ?? 0;
  return { notes: index.files.size, openTasks: open.length, overdue, tags: index.tags.size };
}

export interface FirstIndexGate {
  /** Nothing was stored for this workspace before this activation. */
  newToDeckard: boolean;
  hasFolder: boolean;
  alreadyShown: boolean;
  notes: number;
  /** The sample, whose README takes this moment. */
  isSample: boolean;
}

/** Whether to say what the first index found. */
export function shouldSummarize(gate: FirstIndexGate): boolean {
  return gate.newToDeckard && gate.hasFolder && !gate.alreadyShown && gate.notes > 0 && !gate.isSample;
}

/**
 * Says what the first index found, when it should. The flag is written
 * before the message, and by an empty first index too, so the summary never
 * arrives later in the middle of work. Returns whether the exclude hint was
 * said with it.
 */
export async function summarizeFirstIndex(
  context: Pick<vscode.ExtensionContext, 'workspaceState'>,
  index: WorkspaceIndex,
  gate: Omit<FirstIndexGate, 'alreadyShown' | 'notes'>,
  options: { excludeHintShownKey: string; excludeIsEmpty: boolean; now?: number },
): Promise<boolean> {
  const alreadyShown = context.workspaceState.get<boolean>(FIRST_INDEX_SUMMARY_SHOWN) === true;
  if (!gate.newToDeckard || !gate.hasFolder || alreadyShown || gate.isSample) {
    return false;
  }
  await context.workspaceState.update(FIRST_INDEX_SUMMARY_SHOWN, true);
  if (!shouldSummarize({ ...gate, alreadyShown, notes: index.files.size })) {
    return false;
  }
  const counts = countFirstIndex(index, readQueryContext(options.now));
  const large = counts.notes >= LARGE_WORKSPACE_NOTES && options.excludeIsEmpty;
  const text =
    describeFirstIndex(counts) +
    (large
      ? ` If some folders hold Markdown you do not want read, the "${settingLabel('exclude')}" setting leaves them out.`
      : '');
  if (large) {
    await context.workspaceState.update(options.excludeHintShownKey, true);
  }
  const buttons = ['Open Dashboard', 'Get Started', ...(large ? ['Leave Folders Out…'] : [])];
  void vscode.window.showInformationMessage(text, ...buttons).then(async (choice) => {
    if (choice === 'Open Dashboard') {
      await vscode.commands.executeCommand('deckard.showDashboard');
    } else if (choice === 'Get Started') {
      await vscode.commands.executeCommand('deckard.openWalkthrough');
    } else if (choice === 'Leave Folders Out…') {
      await openSettingAction('exclude').run();
    }
  });
  return large;
}
