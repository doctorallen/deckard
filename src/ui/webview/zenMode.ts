import * as vscode from 'vscode';

import { writeSetting } from '../commands/settings';
import { readZen, ZEN_SETTING } from '../commands/displaySettings';

/** The context key the title bar's Enter and Leave Zen pair is gated on. */
export const zenModeContextKey = 'deckard.zenMode';

/** Whether pages are drawn in Zen, as `deckard.display.zen` says. */
export function isZenModeEnabled(): boolean {
  return readZen();
}

/**
 * Publishes whether Zen is on as a context key, so the title bar offers
 * whichever of Enter and Leave would change anything.
 */
export async function syncZenModeContext(): Promise<void> {
  await vscode.commands.executeCommand('setContext', zenModeContextKey, isZenModeEnabled());
}

/**
 * Starts Zen at activation: keeps the context key in step with the setting
 * however it changes, from the gear, a command, settings.json, or another
 * window.
 */
export function startZenMode(): vscode.Disposable {
  void syncZenModeContext();
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`deckard.${ZEN_SETTING}`)) {
      void syncZenModeContext();
    }
  });
}

/**
 * Turns Zen on or off in the user's settings, as every Display setting is
 * written; off takes the setting out rather than writing its default. Each
 * page redraws from its own configuration listener.
 */
export async function setZenMode(enabled: boolean): Promise<void> {
  if (enabled === isZenModeEnabled()) {
    await syncZenModeContext();
    return;
  }
  if (!(await writeSetting(ZEN_SETTING, enabled ? true : undefined, vscode.ConfigurationTarget.Global))) {
    return;
  }
  await syncZenModeContext();
}

/** The Zen checkbox's counterpart in the palette, `Deckard: Toggle Zen`. */
export function toggleZenMode(): Promise<void> {
  return setZenMode(!isZenModeEnabled());
}
