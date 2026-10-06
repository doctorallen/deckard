import * as vscode from 'vscode';

import { pluralize } from '../../shared/text';
import { settingLabel } from './notify';

export { countOtherCheckboxes, countUnknownStatuses } from '../../domain/index/otherCheckboxes';

/**
 * Tasks whose status Deckard doesn't know, said once.
 *
 * Any character between a task's brackets is a task, as in Obsidian Tasks,
 * so a vault's counts match; one no status in `deckard.tasks.statuses`
 * names, such as `[?]`, is read as to do. The first index that finds such
 * tasks in a workspace says how many, once, with a way to name them; Stats
 * keeps saying it.
 */

/** The workspace-state key that records the notice was given. */
export const UNKNOWN_STATUSES_NOTICED = 'deckard.unknownStatusesNoticed';
export const OPEN_STATS_BUTTON = 'Open Stats';
export const OPEN_SETTING_BUTTON = 'Open Setting';

/** The notice, in one sentence. */
export function describeUnknownStatuses(count: number, symbols: readonly string[]): string {
  const characters = symbols.slice(0, 3).map((symbol) => `[${symbol}]`).join(', ');
  return `${pluralize(count, 'task uses', 'tasks use', { locale: true })} a status Deckard doesn't know, such as ${characters}; ${count === 1 ? 'it counts' : 'they count'} as to do. Name them in the "${settingLabel('tasks.statuses')}" setting.`;
}

/** How the notice asks and acts; the defaults are VS Code's. */
export interface UnknownStatusesOptions {
  show?: (message: string, ...buttons: string[]) => Thenable<string | undefined>;
  run?: (command: string, ...args: unknown[]) => Thenable<unknown>;
}

/**
 * Says how many tasks use a status Deckard doesn't know, the first time a
 * workspace has any. The flag is written before the message, so it is said
 * only once.
 */
export async function noticeUnknownStatusesOnce(
  workspaceState: vscode.Memento,
  unknown: { count: number; symbols: readonly string[] },
  options: UnknownStatusesOptions = {},
): Promise<void> {
  if (unknown.count === 0 || workspaceState.get<boolean>(UNKNOWN_STATUSES_NOTICED) === true) {
    return;
  }
  await workspaceState.update(UNKNOWN_STATUSES_NOTICED, true);
  const show = options.show ?? ((message, ...buttons) => vscode.window.showInformationMessage(message, ...buttons));
  const run = options.run ?? ((command, ...args) => vscode.commands.executeCommand(command, ...args));
  const chosen = await show(describeUnknownStatuses(unknown.count, unknown.symbols), OPEN_SETTING_BUTTON, OPEN_STATS_BUTTON);
  if (chosen === OPEN_SETTING_BUTTON) {
    await run('workbench.action.openSettings', 'deckard.tasks.statuses');
  } else if (chosen === OPEN_STATS_BUTTON) {
    await run('deckard.showStats');
  }
}
