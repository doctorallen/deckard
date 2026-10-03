/**
 * The calendar page's narrowing table: the sidebar Calendar's, and its
 * gear's and help's.
 */
import type { CalendarPagePageToHost } from '../../../protocol/calendar';
import { Narrower, NarrowingTable, narrowSetZenMode, narrowWith, onlyType } from '../../host/narrowing';
import { CALENDAR_MESSAGES } from '../calendar/messages';

/** A gear row that turns a calendar setting on or off: the choice and nothing else. */
function narrowShow<T extends 'setShowRepeats' | 'setShowWeekends'>(type: T): Narrower<{ type: T; show: boolean }> {
  return (value) =>
    typeof value.show === 'boolean' && Object.keys(value).length === 2 ? { type, show: value.show } : undefined;
}

/** Each message the calendar page may send, and what it must hold. */
export const CALENDAR_PAGE_MESSAGES: NarrowingTable<CalendarPagePageToHost> = {
  ...CALENDAR_MESSAGES,
  setShowRepeats: narrowShow('setShowRepeats'),
  setShowWeekends: narrowShow('setShowWeekends'),
  setZenMode: narrowSetZenMode,
  chooseTheme: onlyType('chooseTheme'),
  openHelp: onlyType('openHelp'),
};

/** A message from the calendar page, narrowed by its table, or undefined. */
export const narrowCalendarPageMessage = narrowWith(CALENDAR_PAGE_MESSAGES);
