import * as vscode from 'vscode';

import { writeSetting } from '../commands/settings';
import { zenToggleTarget } from '../state/displayLevel';
import { DISPLAY_SETTINGS, readDisplayLevel } from '../commands/displaySettings';

/** The context key the palette's and title bar's Zen commands are gated on. */
export const zenModeContextKey = 'deckard.zenMode';

/** The step the reader was on before the Zen button took them to Zen. */
const BEFORE_ZEN_KEY = 'deckard.display.beforeZen';

/** Where the Zen button keeps the step to go back to: the machine's own store. */
let memory: vscode.Memento | undefined;

/** Whether pages are drawn at the Zen step, as `deckard.display.level` says. */
export function isZenModeEnabled(): boolean {
  return readDisplayLevel() === 'zen';
}

/**
 * Publishes whether Zen is on as a context key, so the palette and the
 * title bar offer whichever of Enter and Leave would change anything.
 */
export async function syncZenModeContext(): Promise<void> {
  await vscode.commands.executeCommand('setContext', zenModeContextKey, isZenModeEnabled());
}

/**
 * Starts Zen at activation: keeps the context key in step with the step
 * however it changes, from the gear, a command, settings.json, or another
 * window.
 */
export function startZenMode(global: vscode.Memento): vscode.Disposable {
  memory = global;
  void syncZenModeContext();
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`deckard.${DISPLAY_SETTINGS.level.key}`)) {
      void syncZenModeContext();
    }
  });
}

/**
 * Goes to Zen, or back from it to the step the reader was on, or to Full
 * when there is none, in the user's settings, as every Display setting is.
 * Each page redraws from its own configuration listener.
 */
export async function setZenMode(enabled: boolean): Promise<void> {
  const current = readDisplayLevel();
  if (enabled === (current === 'zen')) {
    await syncZenModeContext();
    return;
  }
  const before = memory?.get<string>(BEFORE_ZEN_KEY);
  const target = zenToggleTarget(current, before);
  if (!(await writeSetting(DISPLAY_SETTINGS.level.key, target, vscode.ConfigurationTarget.Global))) {
    return;
  }
  await memory?.update(BEFORE_ZEN_KEY, enabled ? current : undefined);
  await syncZenModeContext();
}

/** The Zen button and `Deckard: Toggle Zen`: into Zen, or back out of it. */
export function toggleZenMode(): Promise<void> {
  return setZenMode(!isZenModeEnabled());
}
