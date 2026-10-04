import * as vscode from 'vscode';

import { writeSetting } from '../commands/settings';
import { resolveDisplayLevel, resolveScaleValues, type DisplayLevel } from '../state/displayLevel';
import type { DisplayChoices } from './components';

/**
 * Display, read from the settings and written from the gear: the step
 * (`deckard.display.level`), the three settings it moves, and how cards and
 * tags are drawn. Each is personal, an application setting, so a
 * workspace's settings never decide how someone else's pages look; each is
 * written to the user's settings. What the values come to is
 * ui/state/displayLevel.ts's.
 */

/** The setting each choice is kept in, under `deckard.`, and its values. */
export const DISPLAY_SETTINGS = {
  level: { key: 'display.level', values: ['full', 'quiet', 'zen'] },
  themeStyling: { key: 'display.themeStyling', values: ['auto', 'styled', 'plain'] },
  helpText: { key: 'display.helpText', values: ['auto', 'shown', 'hidden'] },
  density: { key: 'display.density', values: ['auto', 'comfortable', 'compact'] },
  cardFrames: { key: 'display.cardFrames', values: ['raised', 'flat'] },
  tags: { key: 'display.tags', values: ['chips', 'text'] },
  counts: { key: 'display.counts', values: ['shown', 'hidden'] },
  fileAndLine: { key: 'display.fileAndLine', values: ['hover', 'always', 'never'] },
  dates: { key: 'display.dates', values: ['both', 'relative', 'date'] },
  pageWidth: { key: 'display.pageWidth', values: ['column', 'wide'] },
} as const;

/** One of the display choices, by its setting's name. */
export type DisplaySetting = keyof typeof DISPLAY_SETTINGS;

/**
 * The step in force: `deckard.display.level` when the reader has set it,
 * else Zen for one who had `deckard.zenMode` on, else Full.
 */
export function readDisplayLevel(): DisplayLevel {
  const deckard = vscode.workspace.getConfiguration('deckard');
  const set = deckard.inspect<string>(DISPLAY_SETTINGS.level.key)?.globalValue;
  return resolveDisplayLevel(set, deckard.get<boolean>('zenMode', false));
}

/** How pages are drawn now, each value only when it isn't the default. */
export function readDisplayChoices(): DisplayChoices {
  const deckard = vscode.workspace.getConfiguration('deckard');
  const scale = resolveScaleValues(readDisplayLevel(), {
    themeStyling: deckard.get(DISPLAY_SETTINGS.themeStyling.key),
    helpText: deckard.get(DISPLAY_SETTINGS.helpText.key),
    density: deckard.get(DISPLAY_SETTINGS.density.key),
  });
  return {
    ...(scale.themeStyling === 'plain' ? { styling: 'plain' as const } : {}),
    ...(scale.helpText === 'hidden' ? { help: 'hidden' as const } : {}),
    ...(scale.density === 'compact' ? { density: 'compact' as const } : {}),
    ...(deckard.get<string>(DISPLAY_SETTINGS.cardFrames.key) === 'flat' ? { cards: 'flat' as const } : {}),
    ...(deckard.get<string>(DISPLAY_SETTINGS.tags.key) === 'text' ? { tags: 'text' as const } : {}),
    ...(deckard.get<string>(DISPLAY_SETTINGS.counts.key) === 'hidden' ? { counts: 'hidden' as const } : {}),
    ...fileAndLine(deckard.get<string>(DISPLAY_SETTINGS.fileAndLine.key)),
    ...dates(deckard.get<string>(DISPLAY_SETTINGS.dates.key)),
    ...(deckard.get<string>(DISPLAY_SETTINGS.pageWidth.key) === 'wide' ? { width: 'wide' as const } : {}),
  };
}

/** File & line, when it isn't on hover. */
function fileAndLine(value: string | undefined): Pick<DisplayChoices, 'fileAndLine'> {
  return value === 'always' || value === 'never' ? { fileAndLine: value } : {};
}

/** Dates, when they aren't written both ways. */
function dates(value: string | undefined): Pick<DisplayChoices, 'dates'> {
  return value === 'relative' || value === 'date' ? { dates: value } : {};
}

/** Whether a settings change alters how pages are drawn. */
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
