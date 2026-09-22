import * as vscode from 'vscode';
import { writeSetting } from '../commands/settings';

/** The context key the palette's two zen commands are gated on. */
export const zenModeContextKey = 'deckard.zenMode';

/**
 * Reads the zen setting that every page and its gear share.
 *
 * Zen is chrome, not content: it hides Deckard's own decoration, thins the
 * frame, and folds each row's file and line away until the row is hovered or
 * focused. Nothing it touches is removed from the page, so a reader who
 * cannot see the fold still hears it.
 */
export function isZenModeEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('zenMode', false);
}

/**
 * Publishes the setting as a context key so the palette offers whichever of
 * the two commands is the one that would change anything.
 */
export async function syncZenModeContext(): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    zenModeContextKey,
    isZenModeEnabled(),
  );
}

/**
 * Turns zen on or off for every window, matching how the setting reads. Each
 * page redraws from its own configuration listener, so there is nothing to
 * refresh here.
 */
export async function setZenMode(enabled: boolean): Promise<void> {
  const written = await writeSetting(
    'zenMode',
    enabled,
    vscode.ConfigurationTarget.Global,
  );
  if (written) {
    await syncZenModeContext();
  }
}
