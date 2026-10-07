/**
 * The view choices a pair of commands turns on and off, each kept in the
 * preferences blob: the sidebar Calendar's day panel and its weekends, and
 * the Outline following the cursor. Each is stored only when it isn't the
 * default, so a blob that never chose one holds nothing for it.
 */
import type { PersistedPreferences } from '../../domain/model/preferences';

/** One of the choices a view's pair of commands turns on and off. */
export type ViewChoice = 'calendarDayPanel' | 'calendarWeekends' | 'outlineFollowCursor';

/** Every view choice, in the order their commands are registered. */
export const VIEW_CHOICES: readonly ViewChoice[] = ['calendarDayPanel', 'calendarWeekends', 'outlineFollowCursor'];

/** The preferences the view choices are kept in. */
export type ViewChoicePreferences = Pick<PersistedPreferences, 'calendarDayPanel' | 'calendarHideWeekends' | 'outlineFollowCursorOff'>;

/**
 * Whether a choice is on: the day panel only once it is turned on, the
 * weekends and following the cursor until they are turned off.
 */
export function readViewChoice(preferences: ViewChoicePreferences, choice: ViewChoice): boolean {
  switch (choice) {
    case 'calendarDayPanel':
      return preferences.calendarDayPanel === true;
    case 'calendarWeekends':
      return preferences.calendarHideWeekends !== true;
    case 'outlineFollowCursor':
      return preferences.outlineFollowCursorOff !== true;
  }
}

/** What turning a choice on or off keeps: its key, or nothing for the default. */
export function viewChoiceChange(choice: ViewChoice, on: boolean): Partial<PersistedPreferences> {
  switch (choice) {
    case 'calendarDayPanel':
      return { calendarDayPanel: on ? true : undefined };
    case 'calendarWeekends':
      return { calendarHideWeekends: on ? undefined : true };
    case 'outlineFollowCursor':
      return { outlineFollowCursorOff: on ? undefined : true };
  }
}
