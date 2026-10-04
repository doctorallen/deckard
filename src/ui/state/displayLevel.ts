/**
 * Display: how much of Deckard's chrome a page draws, as a scale of three
 * steps over three settings, each of which a reader can also set on their
 * own. A setting left at `auto` follows the step; any other value is the
 * reader's and wins whatever the step. Full is Deckard as it ships; Quiet
 * takes off each theme's decoration and the lines that teach, at today's
 * spacing; Zen also tightens the spacing, and draws pages as Zen mode did.
 */

/** The scale's steps, in order. */
export const DISPLAY_LEVELS = ['full', 'quiet', 'zen'] as const;
/** One of the scale's steps. */
export type DisplayLevel = (typeof DISPLAY_LEVELS)[number];

/** The settings the scale moves, each with its values, `auto` first. */
export const SCALE_SETTINGS = {
  themeStyling: ['auto', 'styled', 'plain'],
  helpText: ['auto', 'shown', 'hidden'],
  density: ['auto', 'comfortable', 'compact'],
} as const;
/** One of the settings the scale moves, by its name under `deckard.display.`. */
export type ScaleSetting = keyof typeof SCALE_SETTINGS;

/** What the scale settings come to on a page. */
export interface ScaleValues {
  themeStyling: 'styled' | 'plain';
  helpText: 'shown' | 'hidden';
  density: 'comfortable' | 'compact';
}

/** Each step's values for the settings it moves. */
export const STEP_VALUES: Readonly<Record<DisplayLevel, ScaleValues>> = {
  full: { themeStyling: 'styled', helpText: 'shown', density: 'comfortable' },
  quiet: { themeStyling: 'plain', helpText: 'hidden', density: 'comfortable' },
  zen: { themeStyling: 'plain', helpText: 'hidden', density: 'compact' },
};

/** Whether a value names a step. */
export function isDisplayLevel(value: unknown): value is DisplayLevel {
  return typeof value === 'string' && (DISPLAY_LEVELS as readonly string[]).includes(value);
}

/**
 * The step in force: the one set, else Zen for a reader who had
 * `deckard.zenMode` on and has set no step since, else Full.
 */
export function resolveDisplayLevel(level: unknown, zenMode: boolean): DisplayLevel {
  if (isDisplayLevel(level)) {
    return level;
  }
  return zenMode ? 'zen' : 'full';
}

/**
 * The scale settings as drawn: each set value wins, and `auto`, or anything
 * unknown, follows the step.
 */
export function resolveScaleValues(level: DisplayLevel, set: Partial<Record<ScaleSetting, unknown>>): ScaleValues {
  const step = STEP_VALUES[level];
  const pick = <K extends ScaleSetting>(key: K): ScaleValues[K] => {
    const value = set[key];
    const allowed: readonly string[] = SCALE_SETTINGS[key];
    return typeof value === 'string' && value !== 'auto' && allowed.includes(value) ? (value as ScaleValues[K]) : step[key];
  };
  return { themeStyling: pick('themeStyling'), helpText: pick('helpText'), density: pick('density') };
}

/** The scale settings set to something other than `auto`, which the gear counts as changed. */
export function changedScaleSettings(set: Partial<Record<ScaleSetting, unknown>>): ScaleSetting[] {
  return (Object.keys(SCALE_SETTINGS) as ScaleSetting[]).filter((key) => {
    const value = set[key];
    const allowed: readonly string[] = SCALE_SETTINGS[key];
    return typeof value === 'string' && value !== 'auto' && allowed.includes(value);
  });
}
