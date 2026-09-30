/**
 * The calendar's protocol, for the sidebar Calendar and the calendar page:
 * the chosen day as its panel shows it, and the messages both send.
 */
import type { DashboardTask } from './shared';

/** Messages from the sidebar calendar. The host finds each note itself. */
export type CalendarMessage =
  | { type: 'ready' }
  | { type: 'openMonth' }
  /** With a date, the day chosen in that month. */
  | { type: 'showMonth'; month: string; date?: string }
  | { type: 'openDay'; date: string }
  | { type: 'openWeek'; date: string }
  | { type: 'selectDay'; date: string }
  | { type: 'createDay'; date: string }
  | { type: 'openNote'; filePath: string }
  | { type: 'openTask'; taskId: string }
  | { type: 'toggleTask'; taskId: string; completed: boolean }
  | { type: 'moveTask'; taskId: string; field: 'due' | 'scheduled'; date: string }
  | { type: 'searchCreated'; date: string };

/** The chosen day, as the panel under the month shows it. */
export interface CalendarDayDetail {
  date: string;
  /** Such as "Friday, September 25", with the year when it is not this one. */
  title: string;
  /** Today, Yesterday, or Tomorrow, when the day is one of them. */
  relative?: string;
  /** The day's daily note, when it has one. */
  notePath?: string;
  /** Open tasks due that day, most important first. */
  due: DashboardTask[];
  /** Open tasks scheduled that day and not due on it. */
  scheduled: DashboardTask[];
  /** Tasks completed that day. */
  done: DashboardTask[];
  /** Repeating tasks whose rule lands on the day, projected: opened, never completed, from here. */
  repeats?: DashboardTask[];
  /**
   * Where the row's button moves a task: tomorrow, or the day after a later
   * day, never earlier.
   */
  move: { date: string; label: 'Tomorrow' | 'Next day' };
  /** Notes created that day, oldest first, daily, weekly, and monthly aside. */
  notes: { filePath: string; title: string; folder: string }[];
  /** How many there are, listed or not. */
  notesTotal: number;
}

/** What the calendar page asks besides what the sidebar Calendar does. */
export type CalendarPageMessage =
  | CalendarMessage
  | { type: 'setShowRepeats'; show: boolean }
  | { type: 'setShowWeekends'; show: boolean }
  | { type: 'setZenMode'; enabled: boolean }
  | { type: 'chooseTheme' }
  | { type: 'openHelp' };
