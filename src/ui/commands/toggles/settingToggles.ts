/**
 * The paired commands that turn one `deckard.*` setting on and off, as data.
 *
 * Each pair used to be two registrations a few lines apart, which could
 * drift: one written to the user's settings and its twin to the
 * workspace's. One row per pair keeps the two commands, the setting, the
 * values, and where they are written together.
 */

/**
 * Where a toggle writes its setting, and what follows the write, as each
 * pair always wrote it.
 *
 * - `where-set`: the workspace's settings when they set it, since they
 *   outrank the user's, else the user's.
 * - `user`: the user's settings, for every window; the context key that
 *   picks which command the palette offers follows (setOutlineFollowCursor).
 * - `zen`: where set, through zen's own setter, which also sets the
 *   context key that picks which command the palette offers (setZenMode).
 */
export type ToggleTarget = 'where-set' | 'user' | 'zen';

/** One setting, and the two commands that turn it on and off. */
export interface SettingToggle {
  /** The command that writes `values.enable`. */
  enable: string;
  /** The command that writes `values.disable`. */
  disable: string;
  /** The setting's key under `deckard.`. */
  setting: string;
  values: { enable: boolean; disable: boolean };
  target: ToggleTarget;
}

/** Every toggle pair, in the order their commands are registered. */
export const SETTING_TOGGLES: readonly SettingToggle[] = [
  // The day panel is a setting, turned on and off from the Calendar's own
  // menu, and written where it is already set.
  {
    enable: 'deckard.calendar.openDayPanel',
    disable: 'deckard.calendar.closeDayPanel',
    setting: 'calendar.dayPanel',
    values: { enable: true, disable: false },
    target: 'where-set',
  },
  {
    enable: 'deckard.calendar.includeWeekends',
    disable: 'deckard.calendar.hideWeekends',
    setting: 'calendar.showWeekends',
    values: { enable: true, disable: false },
    target: 'where-set',
  },
  {
    enable: 'deckard.calendar.showRepeats',
    disable: 'deckard.calendar.hideRepeats',
    setting: 'calendar.showRepeats',
    values: { enable: true, disable: false },
    target: 'where-set',
  },
  {
    enable: 'deckard.outline.enableFollowCursor',
    disable: 'deckard.outline.disableFollowCursor',
    setting: 'outline.followCursor',
    values: { enable: true, disable: false },
    target: 'user',
  },
  {
    enable: 'deckard.enableZenMode',
    disable: 'deckard.disableZenMode',
    setting: 'zenMode',
    values: { enable: true, disable: false },
    target: 'zen',
  },
];

/** One command a toggle pair registers: its id, and what it writes where. */
export interface ToggleCommand {
  id: string;
  setting: string;
  value: boolean;
  target: ToggleTarget;
}

/**
 * The commands a table of toggles registers, each pair's enable before its
 * disable, in the table's order.
 */
export function listToggleCommands(toggles: readonly SettingToggle[]): ToggleCommand[] {
  return toggles.flatMap(({ enable, disable, setting, values, target }) => [
    { id: enable, setting, value: values.enable, target },
    { id: disable, setting, value: values.disable, target },
  ]);
}
