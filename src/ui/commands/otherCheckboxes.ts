import * as vscode from 'vscode';

import { pluralize } from '../../shared/text';

export { countOtherCheckboxes } from '../../domain/index/otherCheckboxes';

/**
 * Checkbox lines that are not tasks, said once.
 *
 * Only `- [ ]` and `- [x]` lines are tasks. A vault from Obsidian also
 * writes `- [/]` for in progress and `- [-]` for cancelled, which Deckard
 * reads as text, so its task count came up short with nothing saying why.
 * The first index that finds such lines in a workspace says how many, once;
 * Stats keeps saying it.
 */

/** The workspace-state key that records the notice was given. */
export const OTHER_CHECKBOXES_NOTICED = 'deckard.otherCheckboxesNoticed';
export const OPEN_STATS_BUTTON = 'Open Stats';

/** The notice, in one sentence. */
export function describeOtherCheckboxes(count: number): string {
  return `${pluralize(count, 'checkbox line', 'checkbox lines', { locale: true })} marked with something other than a space or an x, such as [/] or [-], ${count === 1 ? 'is' : 'are'} text to Deckard, not ${count === 1 ? 'a task' : 'tasks'}, so no task count includes ${count === 1 ? 'it' : 'them'}. Only - [ ] and - [x] lines are tasks.`;
}

/** How the notice asks and acts; the defaults are VS Code's. */
export interface OtherCheckboxesOptions {
  show?: (message: string, ...buttons: string[]) => Thenable<string | undefined>;
  run?: (command: string) => Thenable<unknown>;
}

/**
 * Says how many checkbox lines are not tasks, the first time a workspace has
 * any. The flag is written before the message, so it is said only once.
 */
export async function noticeOtherCheckboxesOnce(
  workspaceState: vscode.Memento,
  count: number,
  options: OtherCheckboxesOptions = {},
): Promise<void> {
  if (count === 0 || workspaceState.get<boolean>(OTHER_CHECKBOXES_NOTICED) === true) {
    return;
  }
  await workspaceState.update(OTHER_CHECKBOXES_NOTICED, true);
  const show = options.show ?? ((message, ...buttons) => vscode.window.showInformationMessage(message, ...buttons));
  const run = options.run ?? ((command) => vscode.commands.executeCommand(command));
  if ((await show(describeOtherCheckboxes(count), OPEN_STATS_BUTTON)) === OPEN_STATS_BUTTON) {
    await run('deckard.showStats');
  }
}
