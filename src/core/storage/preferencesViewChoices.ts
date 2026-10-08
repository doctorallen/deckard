/**
 * The view choices kept in the preferences blob: whether the calendars draw
 * weekends, which the calendar page's gear sets, and the Outline following
 * the cursor, which a pair of commands turns on and off. Each is stored
 * only when it isn't the default, so a blob that never chose one holds
 * nothing for it.
 */
import type { PersistedPreferences } from '../../domain/model/preferences';

/** One of the choices a view keeps. */
export type ViewChoice = 'calendarWeekends' | 'outlineFollowCursor';

/** Every view choice. */
export const VIEW_CHOICES: readonly ViewChoice[] = ['calendarWeekends', 'outlineFollowCursor'];

/** The preferences the view choices are kept in. */
export type ViewChoicePreferences = Pick<PersistedPreferences, 'calendarHideWeekends' | 'outlineFollowCursorOff'>;

/** Whether a choice is on: the weekends and following the cursor are, until they are turned off. */
export function readViewChoice(preferences: ViewChoicePreferences, choice: ViewChoice): boolean {
  switch (choice) {
    case 'calendarWeekends':
      return preferences.calendarHideWeekends !== true;
    case 'outlineFollowCursor':
      return preferences.outlineFollowCursorOff !== true;
  }
}

/** What turning a choice on or off keeps: its key, or nothing for the default. */
export function viewChoiceChange(choice: ViewChoice, on: boolean): Partial<PersistedPreferences> {
  switch (choice) {
    case 'calendarWeekends':
      return { calendarHideWeekends: on ? undefined : true };
    case 'outlineFollowCursor':
      return { outlineFollowCursorOff: on ? undefined : true };
  }
}
