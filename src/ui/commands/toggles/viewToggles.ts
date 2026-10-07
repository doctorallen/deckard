/**
 * The paired commands that turn one view choice on and off, as data: the
 * sidebar Calendar's day panel and weekends, and the Outline following the
 * cursor. Each choice is kept in the preferences
 * (core/storage/preferencesViewChoices.ts) and published as a context key,
 * which the view's title or menu reads to offer whichever of the pair
 * changes something.
 *
 * Each pair used to be two registrations a few lines apart, which could
 * drift. One row per pair keeps the two commands and the choice together.
 */
import type { ViewChoice } from '../../../core/storage/preferencesViewChoices';

/** One view choice, and the two commands that turn it on and off. */
export interface ViewToggle {
  /** The command that turns the choice on. */
  enable: string;
  /** The command that turns it off. */
  disable: string;
  choice: ViewChoice;
}

/** Every toggle pair, in the order their commands are registered. */
export const VIEW_TOGGLES: readonly ViewToggle[] = [
  // The day panel and the weekends are turned on and off from the
  // Calendar's own menu.
  { enable: 'deckard.calendar.openDayPanel', disable: 'deckard.calendar.closeDayPanel', choice: 'calendarDayPanel' },
  { enable: 'deckard.calendar.includeWeekends', disable: 'deckard.calendar.hideWeekends', choice: 'calendarWeekends' },
  { enable: 'deckard.outline.enableFollowCursor', disable: 'deckard.outline.disableFollowCursor', choice: 'outlineFollowCursor' },
];

/** The context key each choice is published as, which its view's title or menu reads. */
export const VIEW_CHOICE_CONTEXT_KEYS: Readonly<Record<ViewChoice, string>> = {
  calendarDayPanel: 'deckard.calendarDayPanel',
  calendarWeekends: 'deckard.calendarWeekends',
  outlineFollowCursor: 'deckard.outlineFollowCursor',
};

/** One command a toggle pair registers: its id, and what it turns the choice to. */
export interface ToggleCommand {
  id: string;
  choice: ViewChoice;
  value: boolean;
}

/**
 * The commands a table of toggles registers, each pair's enable before its
 * disable, in the table's order.
 */
export function listToggleCommands(toggles: readonly ViewToggle[]): ToggleCommand[] {
  return toggles.flatMap(({ enable, disable, choice }) => [
    { id: enable, choice, value: true },
    { id: disable, choice, value: false },
  ]);
}
