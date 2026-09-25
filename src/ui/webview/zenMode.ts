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
 * Where turning zen on or off has to be written to take effect.
 *
 * It was always written to user settings, so a workspace that sets
 * deckard.zenMode itself, which outranks them, kept zen on whatever the gear
 * said: the switch wrote, and nothing changed. It is written where the value
 * in force comes from: the workspace's settings when they set it, else the
 * user's. A folder's own setting is found and written by setZenMode.
 */
export function zenModeTarget(
  setting:
    | {
        workspaceValue?: unknown;
      }
    | undefined = vscode.workspace
    .getConfiguration('deckard')
    .inspect<boolean>('zenMode'),
): vscode.ConfigurationTarget {
  if (setting?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
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
  // A folder that sets it is written through a configuration for that folder.
  const folder = vscode.workspace.workspaceFolders?.find(
    (candidate) =>
      vscode.workspace
        .getConfiguration('deckard', candidate.uri)
        .inspect<boolean>('zenMode')?.workspaceFolderValue !== undefined,
  );
  const written = folder
    ? await writeSetting(
        'zenMode',
        enabled,
        vscode.ConfigurationTarget.WorkspaceFolder,
        vscode.workspace.getConfiguration('deckard', folder.uri),
      )
    : await writeSetting('zenMode', enabled, zenModeTarget());
  if (written) {
    await syncZenModeContext();
  }
}
