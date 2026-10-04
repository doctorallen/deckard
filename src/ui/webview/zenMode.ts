import * as vscode from 'vscode';

import { writeSetting } from '../commands/settings';
import { planZenMove, ZEN_EDITOR_SETTINGS, zenToggleTarget } from '../state/displayLevel';
import { DISPLAY_SETTINGS, readDisplayLevel } from '../commands/displaySettings';

/** The context key the palette's and title bar's Zen commands are gated on. */
export const zenModeContextKey = 'deckard.zenMode';

/** The step the reader was on before the Zen button took them to Zen. */
const BEFORE_ZEN_KEY = 'deckard.display.beforeZen';
/** Set once a reader's Zen mode has been moved to Display, in the scope it was set in. */
const MOVED_FROM_ZEN_KEY = 'deckard.display.movedFromZen';

/** Where the Zen button keeps the step to go back to, and where the move from Zen mode is noted. */
interface ZenMemory {
  readonly global: vscode.Memento;
  readonly workspace: vscode.Memento;
}

let memory: ZenMemory | undefined;

/**
 * Whether pages are drawn at the Zen step: `deckard.display.level` when the
 * reader has set it, else Zen mode, which is read as an alias for it.
 */
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
 * window, and moves a reader who has Zen mode on to Display, once.
 */
export function startZenMode(global: vscode.Memento, workspace: vscode.Memento): vscode.Disposable {
  memory = { global, workspace };
  void syncZenModeContext();
  void moveFromZenMode(memory);
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('deckard.zenMode') || event.affectsConfiguration(`deckard.${DISPLAY_SETTINGS.level.key}`)) {
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
  const before = memory?.global.get<string>(BEFORE_ZEN_KEY);
  const target = zenToggleTarget(current, before);
  if (!(await writeSetting(DISPLAY_SETTINGS.level.key, target, vscode.ConfigurationTarget.Global))) {
    return;
  }
  await memory?.global.update(BEFORE_ZEN_KEY, enabled ? current : undefined);
  await syncZenModeContext();
}

/** The Zen button and `Deckard: Toggle Zen`: into Zen, or back out of it. */
export function toggleZenMode(): Promise<void> {
  return setZenMode(!isZenModeEnabled());
}

/**
 * Moves a reader with Zen mode on to Display, once in the scope Zen mode was
 * set in: the user's Zen becomes the Zen step, and the editor settings Zen
 * turned off are turned off one by one where the reader has not set them.
 * One notice says so, with a way to each.
 */
async function moveFromZenMode(saved: ZenMemory): Promise<void> {
  const deckard = vscode.workspace.getConfiguration('deckard');
  const editor = Object.fromEntries(ZEN_EDITOR_SETTINGS.map((key) => [key, deckard.inspect(key)]));
  const move = planZenMove(deckard.inspect('zenMode'), deckard.inspect(DISPLAY_SETTINGS.level.key), editor);
  if (!move) {
    return;
  }
  const noted = move.scope === 'user' ? saved.global : saved.workspace;
  if (noted.get<boolean>(MOVED_FROM_ZEN_KEY)) {
    return;
  }
  const target = move.scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
  if (move.setLevel) {
    await writeSetting(DISPLAY_SETTINGS.level.key, 'zen', vscode.ConfigurationTarget.Global);
  }
  for (const key of move.editorOff) {
    await writeSetting(key, false, target);
  }
  if (move.clearZenMode) {
    await writeSetting('zenMode', undefined, vscode.ConfigurationTarget.Global);
  }
  await noted.update(MOVED_FROM_ZEN_KEY, true);
  void vscode.window
    .showInformationMessage(
      'Zen mode is now Display: Zen. Your pages look the same. The editor settings Zen turned off are now turned off one by one, so you can turn any back on.',
      'Display Settings',
      'Editor Settings',
    )
    .then((choice) => {
      if (choice === 'Display Settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'deckard.display');
      } else if (choice === 'Editor Settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', ZEN_EDITOR_SETTINGS.map((key) => `@id:deckard.${key}`).join(' '));
      }
    });
}
