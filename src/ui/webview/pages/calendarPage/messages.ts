/**
 * The calendar page's narrowing table: the sidebar Calendar's, and its
 * gear's and help's.
 */
import type { CalendarPagePageToHost } from '../../../protocol/calendar';
import {
  Narrower,
  narrowGoToPage,
  NarrowingTable,
  narrowSetDisplay,
  narrowSetZenMode,
  narrowWith,
  onlyType,
} from '../../host/narrowing';
import { CALENDAR_MESSAGES } from '../calendar/messages';

/** The gear's Weekends row: the choice and nothing else. */
const narrowShowWeekends: Narrower<{ type: 'setShowWeekends'; show: boolean }> = (value) =>
  typeof value.show === 'boolean' && Object.keys(value).length === 2 ? { type: 'setShowWeekends', show: value.show } : undefined;

/** Each message the calendar page may send, and what it must hold. */
export const CALENDAR_PAGE_MESSAGES: NarrowingTable<CalendarPagePageToHost> = {
  ...CALENDAR_MESSAGES,
  setShowWeekends: narrowShowWeekends,
  setZenMode: narrowSetZenMode,
  setDisplay: narrowSetDisplay,
  chooseTheme: onlyType('chooseTheme'),
  openHelp: onlyType('openHelp'),
  openGoTo: onlyType('openGoTo'),
  listGoTo: onlyType('listGoTo'),
  goToPage: narrowGoToPage,
};

/** A message from the calendar page, narrowed by its table, or undefined. */
export const narrowCalendarPageMessage = narrowWith(CALENDAR_PAGE_MESSAGES);
