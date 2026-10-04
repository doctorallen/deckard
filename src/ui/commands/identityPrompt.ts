import * as vscode from 'vscode';

import { openSettingAction, settingLabel } from './notify';

/**
 * Who you are in your notes, asked where it matters.
 *
 * `is:mine` and `is:waiting` compare a task's assignee to `deckard.me`.
 * With it empty, `is:mine` finds only the tasks for nobody, which looks
 * like a search that works and quietly answers the wrong question. The
 * first search in a window that uses either, while it is empty, says so
 * once, with the setting a click away.
 */

/** A search that asks about the reader: `is:mine`, `is:me`, or `is:waiting`. */
const ABOUT_ME = /\bis:(?:mine|me|waiting)\b/i;

let askedThisSession = false;

/** Whether a search asks about the reader while no one is named as the reader. */
export function needsIdentity(query: string, identity: string | undefined): boolean {
  return ABOUT_ME.test(query) && !(identity ?? '').trim();
}

/** Says, once a window, that `deckard.me` is empty when a search needs it. */
export function askForIdentityOnce(query: string): void {
  const identity = vscode.workspace.getConfiguration('deckard').get<string>('me', '');
  if (askedThisSession || !needsIdentity(query, identity)) {
    return;
  }
  askedThisSession = true;
  const open = openSettingAction('me');
  void vscode.window
    .showInformationMessage(
      `is:mine and is:waiting need to know who you are in your notes. Set "${settingLabel('me')}" to the tag you write for yourself, such as @dana; until then is:mine finds only the tasks for nobody.`,
      open.title,
    )
    .then((choice) => (choice === open.title ? open.run() : undefined));
}
