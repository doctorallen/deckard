/**
 * The calendar's protocol, for the sidebar Calendar and the calendar page:
 * the month and the chosen day as they are drawn, and the messages both
 * send.
 */
import type { Correlated, MessageOf, StateMessage } from './messaging';
import type {
  ChooseThemeMessage,
  DashboardTask,
  OpenHelpMessage,
  OpenTagMessage,
  SetZenModeMessage,
  SidebarReadyMessage,
  ToggleTaskMessage,
} from './shared';

/** One day in the calendar. */
export interface CalendarDay {
  /** YYYY-MM-DD. */
  date: string;
  /** The day of the month. */
  day: number;
  /** Whether the day is in the month shown, rather than a neighbor's. */
  inMonth: boolean;
  isToday: boolean;
  /** The day's daily note, when it has one. */
  notePath?: string;
  /** Open tasks due that day. */
  dueCount: number;
  /** The first few of them by name, and the daily note's headings, for its tooltip. */
  dueTitles?: string[];
  headings?: string[];
  /**
   * Open tasks scheduled (⏳) that day. A task due and scheduled on the same
   * day is counted once, as due.
   */
  scheduledCount: number;
  scheduledTitles?: string[];
  /**
   * Repeating tasks whose rule lands on the day after their current date,
   * with `deckard.calendar.showRepeats`: projected, not due.
   */
  repeatCount?: number;
  repeatTitles?: string[];
  /** The calendar page's day: every task on it, by name, most important first. */
  entries?: CalendarEntry[];
}

/** One task on a day of the calendar page. */
export interface CalendarEntry {
  taskId: string;
  title: string;
  /** Due that day, scheduled that day, or a repeat's later date. */
  kind: 'due' | 'scheduled' | 'repeat';
  /** A due date past: overdue, or past `needsNewDateAfterDays`. */
  tone?: 'overdue' | 'stale';
}

/** One row of the calendar: seven days, from the week's first day. */
export interface CalendarWeek {
  /** The week's note name, such as week-2026-09-13-2026-09-19. */
  week: string;
  /** Its first day, as YYYY-MM-DD, which the week's note is found from. */
  date: string;
  /** The week's note, when it has one. */
  notePath?: string;
  days: CalendarDay[];
}

/**
 * The month, or the page's week, as a calendar draws it: its days and
 * weeks, their notes and tasks, and the chosen day.
 */
export interface CalendarSnapshot {
  /** The month shown, as YYYY-MM. */
  month: string;
  /** Such as "September 2026". */
  title: string;
  today: string;
  previousMonth: string;
  nextMonth: string;
  /** Today's month, which the Today button returns to. */
  currentMonth: string;
  /** The month's note, when it has one. */
  notePath?: string;
  /** The weekday names across the top, from the week's first day. */
  weekdays: string[];
  /**
   * Days before this one, YYYY-MM-DD, are past `needsNewDateAfterDays`: their
   * due counts are drawn muted and say the tasks need a new date. Absent
   * when the setting is 0.
   */
  needsNewDateBefore?: string;
  weeks: CalendarWeek[];
  /** Whether repeats are drawn, from `deckard.calendar.showRepeats`. */
  showRepeats?: boolean;
  /**
   * Saturday and Sunday are left out of the grid, from
   * `deckard.calendar.showWeekends`. The weeks still hold them, for their
   * notes and for a step that lands on one.
   */
  hideWeekends?: boolean;
  /** The page's chosen day is in the Related Notes sidebar, so the page draws no panel of its own. */
  dayInSidebar?: boolean;
  /** Whether the chosen day is shown below the month, from `deckard.calendar.dayPanel`. */
  dayPanel?: boolean;
  /** The day chosen, YYYY-MM-DD: today until another is. */
  selectedDate?: string;
  /** The chosen day, when the panel is on. */
  selected?: CalendarDayDetail;
}

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

/** The month's title: its note, or the offer to make one. */
export interface CalendarOpenMonthMessage {
  type: 'openMonth';
}

/** A step to another month. */
export interface CalendarShowMonthMessage {
  type: 'showMonth';
  /** YYYY-MM. */
  month: string;
  /** The day chosen in that month, when the step chose one. */
  date?: string;
}

/** A day's note, or the offer to make one. */
export interface CalendarOpenDayMessage {
  type: 'openDay';
  date: string;
}

/** The week's note, from its first day, or the offer to make one. */
export interface CalendarOpenWeekMessage {
  type: 'openWeek';
  date: string;
}

/** A day chosen for the day panel, which opens nothing. */
export interface CalendarSelectDayMessage {
  type: 'selectDay';
  date: string;
}

/** The day panel's Create, which makes the day's note without asking. */
export interface CalendarCreateDayMessage {
  type: 'createDay';
  date: string;
}

/** A note the day panel lists, opened at its first line. */
export interface CalendarOpenNoteMessage {
  type: 'openNote';
  filePath: string;
}

/** The day panel's Search all: the notes created that day. */
export interface CalendarSearchCreatedMessage {
  type: 'searchCreated';
  date: string;
}

/** A task the calendar shows, opened at its line. */
export interface CalendarOpenTaskMessage {
  type: 'openTask';
  taskId: string;
}

/**
 * A task moved to another day, by its due or its scheduled date. The page
 * numbers each move, and a refusal carries the number back; a move without
 * one is still made, as it was before moves were numbered.
 */
export interface CalendarMoveTaskMessage extends Partial<Correlated> {
  type: 'moveTask';
  taskId: string;
  field: 'due' | 'scheduled';
  date: string;
}

/** The page's gear: whether repeats are drawn, written to the setting. */
export interface CalendarSetShowRepeatsMessage {
  type: 'setShowRepeats';
  show: boolean;
}

/** The page's gear: whether weekends are drawn, written to the setting. */
export interface CalendarSetShowWeekendsMessage {
  type: 'setShowWeekends';
  show: boolean;
}

/**
 * Says a task the page moved at once was not moved after all, so the page
 * puts it back and says so. It carries the move's number when the move had
 * one, so the page knows which of its moves it was.
 */
export interface CalendarMoveRefusedMessage extends Partial<Correlated> {
  type: 'moveRefused';
  taskId: string;
}

/**
 * What the sidebar Calendar sends its host, by type. Dates and months are
 * checked for their shape; the host finds each note and task itself.
 */
export interface CalendarPageToHost {
  ready: SidebarReadyMessage;
  openMonth: CalendarOpenMonthMessage;
  showMonth: CalendarShowMonthMessage;
  openDay: CalendarOpenDayMessage;
  openWeek: CalendarOpenWeekMessage;
  selectDay: CalendarSelectDayMessage;
  createDay: CalendarCreateDayMessage;
  openNote: CalendarOpenNoteMessage;
  openTask: CalendarOpenTaskMessage;
  toggleTask: ToggleTaskMessage;
  moveTask: CalendarMoveTaskMessage;
  searchCreated: CalendarSearchCreatedMessage;
  /** A tag written in a task's title in the day panel, which opens its page. */
  openTag: OpenTagMessage;
}

/** What the host sends the sidebar Calendar, by type. */
export interface CalendarHostToPage {
  state: StateMessage<CalendarSnapshot>;
  /** A task the day panel asked to move that was not moved. */
  moveRefused: CalendarMoveRefusedMessage;
}

/**
 * What the calendar page sends its host, by type: the sidebar Calendar's
 * messages, and its gear's and help's.
 */
export interface CalendarPagePageToHost extends CalendarPageToHost {
  setShowRepeats: CalendarSetShowRepeatsMessage;
  setShowWeekends: CalendarSetShowWeekendsMessage;
  setZenMode: SetZenModeMessage;
  chooseTheme: ChooseThemeMessage;
  openHelp: OpenHelpMessage;
}

/** What the host sends the calendar page, by type. */
export interface CalendarPageHostToPage {
  state: StateMessage<CalendarSnapshot>;
  moveRefused: CalendarMoveRefusedMessage;
}

/** Messages from the sidebar calendar. The host finds each note itself. */
export type CalendarMessage = MessageOf<CalendarPageToHost>;

/** What the calendar page asks besides what the sidebar Calendar does. */
export type CalendarPageMessage = MessageOf<CalendarPagePageToHost>;
