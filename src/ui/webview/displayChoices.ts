import * as vscode from 'vscode';

import { writeSetting } from '../commands/settings';
import type { DisplayChoices } from './components';

/**
 * How a reader chose to have cards and tags drawn on every page:
 * `deckard.display.cardFrames` (raised cards, or flat rows parted by a
 * divider) and `deckard.display.tags` (framed chips, or plain text). Each is
 * personal, an application setting, so a workspace's settings never decide
 * how someone else's pages look; each is written to the user's settings.
 */

/** The setting each choice is kept in, under `deckard.`, and the value that is not its default. */
export const DISPLAY_SETTINGS = {
  cardFrames: { key: 'display.cardFrames', values: ['raised', 'flat'] },
  tags: { key: 'display.tags', values: ['chips', 'text'] },
} as const;

/** One of the display choices, by its setting's name. */
export type DisplaySetting = keyof typeof DISPLAY_SETTINGS;

/** The choices as they are set now, each only when it isn't the default. */
export function readDisplayChoices(): DisplayChoices {
  const deckard = vscode.workspace.getConfiguration('deckard');
  return {
    ...(deckard.get<string>(DISPLAY_SETTINGS.cardFrames.key) === 'flat' ? { cards: 'flat' as const } : {}),
    ...(deckard.get<string>(DISPLAY_SETTINGS.tags.key) === 'text' ? { tags: 'text' as const } : {}),
  };
}

/** Whether a settings change alters how cards or tags are drawn. */
export function affectsDisplayChoices(event: vscode.ConfigurationChangeEvent): boolean {
  return Object.values(DISPLAY_SETTINGS).some((setting) => event.affectsConfiguration(`deckard.${setting.key}`));
}

/**
 * Sets one choice from a page's gear, in the user's settings. Each page
 * redraws from its own configuration listener, so there is nothing to
 * refresh here.
 */
export async function setDisplayChoice(setting: DisplaySetting, value: string): Promise<void> {
  const known: readonly string[] = DISPLAY_SETTINGS[setting].values;
  if (known.includes(value)) {
    await writeSetting(DISPLAY_SETTINGS[setting].key, value, vscode.ConfigurationTarget.Global);
  }
}
