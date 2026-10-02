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
 * user's. A folder's settings never decide a window setting (setZenMode).
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
 * Keeps the context key in step with the setting however it changes: from
 * Deckard's own commands and gear, or from an edit to settings.json, the
 * Settings editor, or another window. Only the first two used to set it, so
 * after an edit the palette offered the command that changed nothing, and
 * hid the one that would. Sets it once now, as activation always did.
 */
export function watchZenModeContext(): vscode.Disposable {
  void syncZenModeContext();
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('deckard.zenMode')) {
      void syncZenModeContext();
    }
  });
}

/**
 * Turns zen on or off, where the value in force is set. Each page redraws
 * from its own configuration listener, so there is nothing to refresh here.
 *
 * Zen is a window setting, so a folder's settings.json never decides it on
 * its own: in a multi-root workspace VS Code ignores a folder's value, and
 * in a single folder that file is the workspace's settings. It used to be
 * written to a folder's settings whenever inspect() reported a folder value,
 * which happens only in a single folder that sets it, and there VS Code
 * refuses a window setting at the folder level: the switch threw, and zen
 * could be neither turned on nor off. It is written to the workspace's
 * settings in that case, which is the same file.
 */
export async function setZenMode(enabled: boolean): Promise<void> {
  if (await writeSetting('zenMode', enabled, zenModeTarget())) {
    await syncZenModeContext();
  }
}
