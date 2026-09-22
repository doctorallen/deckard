import * as vscode from 'vscode';

/**
 * Writes one `deckard.*` setting, and says something useful when VS Code
 * refuses because it does not know the setting exists.
 *
 * Deckard installs from a VSIX, and VS Code keeps the manifest it read when
 * the window opened until the whole application is restarted — a reload is
 * not enough. So after an update, the running code can name a setting the
 * window's registry has never heard of, and the write fails with "unable to
 * write to user settings because deckard.x is not a registered
 * configuration". That is one sentence to a reader: restart VS Code.
 *
 * Returns whether the value was written, so a caller can skip the steps
 * that assumed it was. Any other failure is thrown as it was.
 */
export async function writeSetting(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget,
  configuration: Pick<vscode.WorkspaceConfiguration, 'update'> = vscode.workspace.getConfiguration('deckard'),
): Promise<boolean> {
  try {
    await configuration.update(key, value, target);
    return true;
  } catch (error) {
    if (!isUnregisteredSettingError(error)) {
      throw error;
    }
    void vscode.window.showWarningMessage(
      describeUnregisteredSetting(key),
    );
    return false;
  }
}

/** Whether a failed write says the setting is not in VS Code's registry. */
export function isUnregisteredSettingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not a registered configuration/i.test(message);
}

/** The sentence a reader gets instead of the registry's. */
export function describeUnregisteredSetting(key: string): string {
  return `Deckard was updated, and this window still has the older version's settings, so deckard.${key} could not be saved. Quit and reopen VS Code — Reload Window is not enough — then try again.`;
}
