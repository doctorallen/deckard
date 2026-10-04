import * as vscode from 'vscode';

import { reportError } from '../../shared/timing';

/**
 * Esper Themes, suggested once.
 *
 * Deckard's looks also come as VS Code color themes, in a separate extension
 * from the same makers. A machine without it is told so once, when the first
 * index is done, with a button that installs it. The walkthrough's Make it
 * yours step keeps a link to it for later.
 */

/** The Marketplace identifier of Esper Themes. */
export const ESPER_THEMES_ID = 'esperinnovations.esper-themes';
/** The global-state key that records the suggestion was made, so it is made once per machine. */
export const ESPER_THEMES_SUGGESTED = 'deckard.esperThemesSuggested';
export const ESPER_THEMES_MESSAGE =
  "Esper Themes, from Deckard's makers, brings looks such as Cooper, Replicant, and LCARS to the whole editor as VS Code color themes.";
export const INSTALL_BUTTON = 'Install';
export const SEE_THEMES_BUTTON = 'See Themes';

/** How the suggestion asks and acts; the defaults are VS Code's. */
export interface EsperThemesOptions {
  isInstalled?: () => boolean;
  show?: (message: string, ...buttons: string[]) => Thenable<string | undefined>;
  run?: (command: string, ...args: unknown[]) => Thenable<unknown>;
}

/** Whether to suggest it: not suggested on this machine yet, and not installed. */
export function shouldSuggestEsperThemes(gate: { alreadySuggested: boolean; installed: boolean }): boolean {
  return !gate.alreadySuggested && !gate.installed;
}

/**
 * Suggests Esper Themes, when it should. The flag is written before the
 * message, and when the theme is already installed too, so it is never
 * asked twice, even after a reload while the message is up.
 */
export async function suggestEsperThemesOnce(
  globalState: vscode.Memento,
  options: EsperThemesOptions = {},
): Promise<void> {
  const alreadySuggested = globalState.get<boolean>(ESPER_THEMES_SUGGESTED) === true;
  if (alreadySuggested) {
    return;
  }
  const installed = (options.isInstalled ?? (() => vscode.extensions.getExtension(ESPER_THEMES_ID) !== undefined))();
  await globalState.update(ESPER_THEMES_SUGGESTED, true);
  if (!shouldSuggestEsperThemes({ alreadySuggested, installed })) {
    return;
  }
  const show = options.show ?? ((message, ...buttons) => vscode.window.showInformationMessage(message, ...buttons));
  const run = options.run ?? ((command, ...args) => vscode.commands.executeCommand(command, ...args));
  const choice = await show(ESPER_THEMES_MESSAGE, INSTALL_BUTTON, SEE_THEMES_BUTTON);
  try {
    if (choice === INSTALL_BUTTON) {
      await run('workbench.extensions.installExtension', ESPER_THEMES_ID);
    } else if (choice === SEE_THEMES_BUTTON) {
      await run('extension.open', ESPER_THEMES_ID);
    }
  } catch (error: unknown) {
    reportError('Deckard could not install Esper Themes. Search for it in the Extensions view.', error);
  }
}
