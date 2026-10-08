import * as vscode from 'vscode';

import { carryMovedSettings, carryRenamedSettings, MOVED_SETTINGS, type MovedSetting, type RenamedSettingWrite, type ScopedValues } from '../core/storage/movedSettings';
import type { PreferencesRepository } from '../core/storage/preferencesRepository';
import type { KeyValueStore } from '../ports/keyValueStore';

/** Set in each store once the moved settings it holds have been carried. */
export const MOVED_SETTINGS_CARRIED_KEY = 'deckard.movedSettingsCarried';

/** Where each scope's values are noted as carried: the machine's and the workspace's. */
export interface CarryMemory {
  readonly global: KeyValueStore;
  readonly workspace: KeyValueStore;
}

/** A moved setting's values in the scopes carried, as `inspect()` reports them. */
type ReadSetting = (setting: MovedSetting) => { readonly globalValue?: unknown; readonly workspaceValue?: unknown } | undefined;

/**
 * Carries the values a reader had set for the settings that moved into
 * the views' preferences, once: the user's once per machine, and the
 * workspace's once per workspace, a workspace's value over the user's,
 * as VS Code read them. The in-memory preferences change at once, so a
 * view built after this draws as the reader left it; the settings are
 * never read again.
 */
export async function carryMovedSettingsOnce(
  repository: Pick<PreferencesRepository, 'update'>,
  memory: CarryMemory,
  read: ReadSetting = (setting) => vscode.workspace.getConfiguration('deckard').inspect(setting),
): Promise<void> {
  const userCarried = memory.global.get<boolean>(MOVED_SETTINGS_CARRIED_KEY) === true;
  const workspaceCarried = memory.workspace.get<boolean>(MOVED_SETTINGS_CARRIED_KEY) === true;
  if (userCarried && workspaceCarried) {
    return;
  }
  const set: Partial<Record<MovedSetting, unknown>> = {};
  for (const setting of MOVED_SETTINGS) {
    const values = read(setting);
    if (!userCarried && values?.globalValue !== undefined) {
      set[setting] = values.globalValue;
    }
    if (!workspaceCarried && values?.workspaceValue !== undefined) {
      set[setting] = values.workspaceValue;
    }
  }
  const changes = carryMovedSettings(set);
  if (Object.keys(changes).length > 0) {
    await repository.update(changes);
  }
  await memory.global.update(MOVED_SETTINGS_CARRIED_KEY, true);
  await memory.workspace.update(MOVED_SETTINGS_CARRIED_KEY, true);
}

/** Set in each store once the renamed settings it holds have been carried. */
export const RENAMED_SETTINGS_CARRIED_KEY = 'deckard.renamedSettingsCarried';

/** Where the renamed settings are read, written, and announced: VS Code's settings and a notice, or a test's. */
export interface RenamedSettingsPorts {
  readonly read: (key: string) => ScopedValues | undefined;
  readonly write: (write: RenamedSettingWrite) => PromiseLike<void>;
  readonly notify: (message: string) => void;
}

/** VS Code's settings, written where each value was found, and an information message. */
const vscodeRenamedSettingsPorts: RenamedSettingsPorts = {
  read: (key) => vscode.workspace.getConfiguration('deckard').inspect(key),
  write: ({ key, value, scope }) =>
    vscode.workspace.getConfiguration('deckard').update(key, value, scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace),
  notify: (message) => void vscode.window.showInformationMessage(message),
};

/**
 * Carries the values a reader had set for the settings that became another
 * setting, once: the user's once per machine, and the workspace's once per
 * workspace, each written in the scope it was found in. When any was found,
 * one notice names each family that moved; the old settings are never read
 * again, and removing them from settings.json is the reader's.
 */
export async function carryRenamedSettingsOnce(
  memory: CarryMemory,
  ports: RenamedSettingsPorts = vscodeRenamedSettingsPorts,
): Promise<void> {
  const user = memory.global.get<boolean>(RENAMED_SETTINGS_CARRIED_KEY) !== true;
  const workspace = memory.workspace.get<boolean>(RENAMED_SETTINGS_CARRIED_KEY) !== true;
  if (!user && !workspace) {
    return;
  }
  const { writes, notices } = carryRenamedSettings(ports.read, { user, workspace });
  for (const write of writes) {
    await ports.write(write);
  }
  await memory.global.update(RENAMED_SETTINGS_CARRIED_KEY, true);
  await memory.workspace.update(RENAMED_SETTINGS_CARRIED_KEY, true);
  if (notices.length > 0) {
    ports.notify(`Deckard moved settings you had set. ${notices.join('. ')}.`);
  }
}
