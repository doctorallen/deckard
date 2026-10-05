import * as vscode from 'vscode';

import { writeSetting } from './settings';
import { changedScaleSettings, resolveDisplayLevel, resolveScaleValues, SCALE_SETTINGS, type DisplayChoices, type DisplayLevel, type ScaleSetting } from '../state/displayLevel';

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
  cardFrames: { key: 'display.cardFrames', values: ['auto', 'raised', 'flat'] },
  tags: { key: 'display.tags', values: ['auto', 'chips', 'text'] },
  counts: { key: 'display.counts', values: ['auto', 'shown', 'hidden'] },
  fileAndLine: { key: 'display.fileAndLine', values: ['auto', 'hover', 'always', 'never'] },
  dates: { key: 'display.dates', values: ['auto', 'both', 'relative', 'date'] },
  pageWidth: { key: 'display.pageWidth', values: ['limited', 'full'] },
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

/** The scale settings as the reader set them, `auto` or a value of their own. */
export function readScaleSettings(): Record<ScaleSetting, unknown> {
  const deckard = vscode.workspace.getConfiguration('deckard');
  const set = {} as Record<ScaleSetting, unknown>;
  for (const key of Object.keys(SCALE_SETTINGS) as ScaleSetting[]) {
    set[key] = deckard.get(DISPLAY_SETTINGS[key].key);
  }
  return set;
}

/**
 * How pages are drawn now, each value only when it isn't the default.
 * `previewed` is a step Choose Display… is showing on the open pages before
 * anything is written.
 */
export function readDisplayChoices(previewed?: DisplayLevel): DisplayChoices {
  const deckard = vscode.workspace.getConfiguration('deckard');
  const level = previewed ?? readDisplayLevel();
  const set = readScaleSettings();
  const scale = resolveScaleValues(level, set);
  const changed = changedScaleSettings(set).length;
  return {
    ...(level === 'full' ? {} : { level }),
    ...(changed ? { changed } : {}),
    ...(scale.themeStyling === 'plain' ? { styling: 'plain' as const } : {}),
    ...(scale.helpText === 'hidden' ? { help: 'hidden' as const } : {}),
    ...(scale.density === 'compact' ? { density: 'compact' as const } : {}),
    ...(scale.cardFrames === 'flat' ? { cards: 'flat' as const } : {}),
    ...(scale.tags === 'text' ? { tags: 'text' as const } : {}),
    ...(scale.counts === 'hidden' ? { counts: 'hidden' as const } : {}),
    ...(scale.fileAndLine === 'hover' ? {} : { fileAndLine: scale.fileAndLine }),
    ...(scale.dates === 'both' ? {} : { dates: scale.dates }),
    ...(deckard.get<string>(DISPLAY_SETTINGS.pageWidth.key) === 'full' ? { width: 'full' as const } : {}),
  };
}

/** Whether a settings change alters how pages are drawn. */
export function affectsDisplayChoices(event: vscode.ConfigurationChangeEvent): boolean {
  return Object.values(DISPLAY_SETTINGS).some((setting) => event.affectsConfiguration(`deckard.${setting.key}`));
}

/**
 * Puts the step's own values back: each setting the step moves goes back to
 * Auto, in the user's settings, where every Display setting is written.
 */
export async function useStepValues(): Promise<void> {
  for (const key of Object.keys(SCALE_SETTINGS) as ScaleSetting[]) {
    await writeSetting(DISPLAY_SETTINGS[key].key, undefined, vscode.ConfigurationTarget.Global);
  }
}

/** Opens Settings on Display's settings, where each one changed shows as Modified with its own Reset. */
export async function customizeDisplay(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'deckard.display');
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
