import * as vscode from 'vscode';

import { carryMovedSettings, MOVED_SETTINGS, type MovedSetting } from '../core/storage/movedSettings';
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
