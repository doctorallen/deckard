/**
 * Display: how much a page draws, as a scale of three steps over every
 * Display setting but the page width, each of which a reader can also set
 * on their own. A setting left at `auto` follows the step; any other value
 * is the reader's and wins whatever the step. Full is Deckard as it ships;
 * Quiet takes off each theme's decoration and the lines that teach, and
 * draws tags as text, at today's spacing; Zen also tightens the spacing,
 * draws cards flat, and leaves out counts, file and line, and the date
 * beside how far off a task is due.
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
  cardFrames: ['auto', 'raised', 'flat'],
  tags: ['auto', 'chips', 'text'],
  counts: ['auto', 'shown', 'hidden'],
  fileAndLine: ['auto', 'hover', 'always', 'never'],
  dates: ['auto', 'both', 'relative', 'date'],
} as const;
/** One of the settings the scale moves, by its name under `deckard.display.`. */
export type ScaleSetting = keyof typeof SCALE_SETTINGS;

/** What the scale settings come to on a page. */
export interface ScaleValues {
  themeStyling: 'styled' | 'plain';
  helpText: 'shown' | 'hidden';
  density: 'comfortable' | 'compact';
  cardFrames: 'raised' | 'flat';
  tags: 'chips' | 'text';
  counts: 'shown' | 'hidden';
  fileAndLine: 'hover' | 'always' | 'never';
  dates: 'both' | 'relative' | 'date';
}

/** Each step's values for the settings it moves. */
export const STEP_VALUES: Readonly<Record<DisplayLevel, ScaleValues>> = {
  full: {
    themeStyling: 'styled', helpText: 'shown', density: 'comfortable',
    cardFrames: 'raised', tags: 'chips', counts: 'shown', fileAndLine: 'hover', dates: 'both',
  },
  quiet: {
    themeStyling: 'plain', helpText: 'hidden', density: 'comfortable',
    cardFrames: 'raised', tags: 'text', counts: 'shown', fileAndLine: 'hover', dates: 'both',
  },
  zen: {
    themeStyling: 'plain', helpText: 'hidden', density: 'compact',
    cardFrames: 'flat', tags: 'text', counts: 'hidden', fileAndLine: 'never', dates: 'relative',
  },
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
  return {
    themeStyling: pick('themeStyling'),
    helpText: pick('helpText'),
    density: pick('density'),
    cardFrames: pick('cardFrames'),
    tags: pick('tags'),
    counts: pick('counts'),
    fileAndLine: pick('fileAndLine'),
    dates: pick('dates'),
  };
}

/** The scale settings set to something other than `auto`, which the gear counts as changed. */
export function changedScaleSettings(set: Partial<Record<ScaleSetting, unknown>>): ScaleSetting[] {
  return (Object.keys(SCALE_SETTINGS) as ScaleSetting[]).filter((key) => {
    const value = set[key];
    const allowed: readonly string[] = SCALE_SETTINGS[key];
    return typeof value === 'string' && value !== 'auto' && allowed.includes(value);
  });
}

/**
 * What Zen mode turned off outside the pages, each now its own setting under
 * `deckard.`: the counts above headings, the unlinked-mention lens, the due
 * hints after a task, the band behind the section being edited, and the
 * Outline's counts.
 */
export const ZEN_EDITOR_SETTINGS = [
  'editor.referenceCounts',
  'editor.unlinkedMentions',
  'editor.taskDueHints',
  'highlightNoteSections',
  'outline.showCounts',
] as const;

/**
 * Where the Zen button goes from a step: into Zen from any other, and out of
 * Zen back to the step the reader came from, or to Full when there is none.
 */
export function zenToggleTarget(current: DisplayLevel, before: unknown): DisplayLevel {
  if (current !== 'zen') {
    return 'zen';
  }
  return isDisplayLevel(before) && before !== 'zen' ? before : 'full';
}

/** A setting's values in each scope, as `inspect()` reports them. */
export interface ScopedValue {
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
}

/** What moving a reader from Zen mode to Display writes. */
export interface ZenMove {
  /** Whose Zen mode it was: the user's settings, or this workspace's. */
  readonly scope: 'user' | 'workspace';
  /** Set the step to Zen, in the user's settings, when they set no step yet. */
  readonly setLevel: boolean;
  /** Take `deckard.zenMode` out of the user's settings, which the step now says. */
  readonly clearZenMode: boolean;
  /** The editor settings to turn off, in the same scope: those set nowhere. */
  readonly editorOff: readonly string[];
}

/**
 * What to write for a reader who has Zen mode on, or nothing when it is off.
 * The user's Zen becomes the Zen step; a workspace's is left where it is and
 * read as the step for that workspace, since Display is personal and a
 * committed file is not rewritten. Either way the editor settings Zen turned
 * off are turned off one by one, in the same scope, only where the reader
 * has not set them.
 */
export function planZenMove(
  zenMode: ScopedValue | undefined,
  level: ScopedValue | undefined,
  editor: Readonly<Record<string, ScopedValue | undefined>>,
): ZenMove | undefined {
  const user = zenMode?.globalValue === true;
  if (!user && zenMode?.workspaceValue !== true) {
    return undefined;
  }
  const unset = (value: ScopedValue | undefined): boolean =>
    value?.globalValue === undefined && value?.workspaceValue === undefined && value?.workspaceFolderValue === undefined;
  return {
    scope: user ? 'user' : 'workspace',
    setLevel: user && level?.globalValue === undefined,
    clearZenMode: user,
    editorOff: ZEN_EDITOR_SETTINGS.filter((key) => unset(editor[key])),
  };
}

/**
 * How a page is drawn, as Display resolves it (ui/state/displayLevel.ts),
 * each value named only when it isn't the default: plain theme styling,
 * help text hidden, compact density, flat rows rather than raised cards,
 * tags as text rather than chips, counts beside names hidden, an entry's
 * file and line always or never drawn, and due dates as only how far off
 * or only the date, and pages as wide as their panel (`full`).
 */
export interface DisplayChoices {
  /** The step, when it isn't Full, for the gear's Display row. */
  readonly level?: 'quiet' | 'zen';
  /** How many of the settings the step moves the reader has set themselves. */
  readonly changed?: number;
  readonly styling?: 'plain';
  readonly help?: 'hidden';
  readonly density?: 'compact';
  readonly cards?: 'flat';
  readonly tags?: 'text';
  readonly counts?: 'hidden';
  readonly fileAndLine?: 'always' | 'never';
  readonly dates?: 'relative' | 'date';
  readonly width?: 'full';
}
