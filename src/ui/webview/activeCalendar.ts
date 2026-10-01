import type { CalendarDayDetail, CalendarMessage } from '../protocol/calendar';
import { ActiveSource } from './host/activeSource';

/** A calendar whose chosen day the Related Notes sidebar can show: the calendar page. */
export interface CalendarDaySource {
  /** The day chosen, as the day panel draws it, or undefined before the first draw. */
  getDay(): CalendarDayDetail | undefined;
  /** Does what the sidebar's copy of the panel asks, as the page's own panel would. */
  handleDayMessage(message: CalendarMessage): Promise<void>;
}

/**
 * Knows whether the calendar page is the active editor, and whether the
 * Related Notes sidebar is open to show its chosen day.
 *
 * While both are so, the day is shown in the sidebar and the page gives the
 * month its whole width; with the sidebar closed, or another editor in
 * front, the page keeps its own panel beside the month. It is the
 * `ActiveSource` every page with a part in the sidebar shares, for the
 * calendar page.
 */
export class ActiveCalendar extends ActiveSource<CalendarDaySource> {}
