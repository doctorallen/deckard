/**
 * What both calendars, the sidebar view and the page, draw from, and the
 * words and choices they share: a day's tone and label, which days are
 * drawn, and which one takes Tab.
 *
 * Each calendar keeps one store (decision 0014). Its snapshot is the host's
 * last; what the reader did since is kept beside it, as the template script
 * kept it in variables. A full draw draws everything from that state, as
 * the script's render did. Choosing a day, and moving between days with the
 * keys, only marked the chosen day and moved the tab stop, as the script's
 * selectDay did, until the next full draw; `marked` and `tabStop` are those
 * marks, and `drawnSelected` and `drawnFocus` what the last full draw drew
 * with, so a calendar draws what the script drew at every step
 * (`session.ts`).
 */
import { chooseFocusDay, isWeekend } from '../../../domain/markdown/calendar';
import type { CalendarDay, CalendarSnapshot, CalendarWeek } from '../../../ui/protocol/calendar';
import { formatPageDay } from '../dateFormats';

/** A calendar's state: the host's snapshot, and what the reader did since. */
export interface CalendarState {
  /** The host's last snapshot; undefined until the first arrives. */
  readonly snapshot: CalendarSnapshot | undefined;
  /** The day the reader chose here since the host last sent one. */
  readonly chosen?: string;
  /** The chosen day the last full draw drew with. */
  readonly drawnSelected?: string;
  /**
   * The day that held the grid's tab stop when the last full draw drew; the
   * session keeps the day as it moves, apart from the snapshot, which each
   * message from the host replaces.
   */
  readonly drawnFocus?: string;
  /** The day marked chosen since the last full draw, if one was. */
  readonly marked?: string;
  /** The day given the tab stop since the last full draw, if one was. */
  readonly tabStop?: string;
  /** The day panel's groups the reader asked to see whole, until the page reloads. */
  readonly shownGroups: readonly string[];
}

/** A calendar's state with a snapshot to draw, which is all its parts ever see. */
export type DrawnCalendar = CalendarState & { readonly snapshot: CalendarSnapshot };

/** The weekday names across the top when the snapshot names none. */
const WEEKDAYS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The day chosen now: the one chosen here since the last snapshot, or the snapshot's. */
export function selectedDateOf(state: CalendarState): string | undefined {
  return state.chosen ?? state.snapshot?.selectedDate;
}

/** Whether a day is drawn: every day, or none on a weekend with them hidden. */
export function isDrawn(snapshot: CalendarSnapshot, day: CalendarDay): boolean {
  return !snapshot.hideWeekends || !isWeekend(day.date);
}

/** The weekday names the grid draws across the top. */
export function drawnWeekdays(snapshot: CalendarSnapshot): string[] {
  return (snapshot.weekdays || WEEKDAYS).filter((name) => !snapshot.hideWeekends || (name !== 'Sat' && name !== 'Sun'));
}

/**
 * How a day's due count is drawn: a day past `needsNewDateAfterDays` keeps
 * its count but not the warning, since its tasks need a new date, not doing
 * today; a day past that is not is overdue.
 */
export function dueTone(snapshot: CalendarSnapshot, day: CalendarDay): { readonly stale: boolean; readonly overdue: boolean } {
  const stale = day.dueCount > 0 && Boolean(snapshot.needsNewDateBefore) && day.date < String(snapshot.needsNewDateBefore);
  return { stale, overdue: day.dueCount > 0 && day.date < snapshot.today && !stale };
}

/** A day as a screen reader hears it: its date, today, its note, and its counts. */
export function describeDay(day: CalendarDay, tone: { readonly stale: boolean; readonly overdue: boolean }): string {
  const parts = [formatPageDay(day.date)];
  if (day.isToday) {
    parts.push('today');
  }
  if (day.notePath) {
    parts.push('daily note');
  }
  if (day.dueCount > 0) {
    parts.push(describeDue(day.dueCount, tone));
  }
  if (day.scheduledCount > 0) {
    parts.push(`${day.scheduledCount} scheduled`);
  }
  const repeats = day.repeatCount ?? 0;
  if (repeats > 0) {
    parts.push(`${repeats}${repeats === 1 ? ' repeat' : ' repeats'}`);
  }
  return parts.join(', ');
}

/** The due count in words: needing a new date, overdue, or due. */
function describeDue(count: number, tone: { readonly stale: boolean; readonly overdue: boolean }): string {
  if (tone.stale) {
    return `${count}${count === 1 ? ' needs' : ' need'} a new date`;
  }
  return `${count}${tone.overdue ? ' overdue' : ' due'}`;
}

/** The classes of a day's date: outside the month, today, and chosen. */
export function dayClasses(day: CalendarDay, selected: boolean): string {
  const classes = ['day'];
  if (!day.inMonth) {
    classes.push('outside');
  }
  if (day.isToday) {
    classes.push('today');
  }
  if (selected) {
    classes.push('selected');
  }
  return classes.join(' ');
}

/** The chosen day as a day's marks show it: the one marked since the last full draw, or the one drawn. */
export function markedDate(state: CalendarState): string | undefined {
  return state.marked ?? state.drawnSelected;
}

/**
 * The day that takes Tab: the one given it since the last full draw, or,
 * as the last full draw chose, the chosen day when the focused day is not
 * drawn, else the focused day, else today, else the first of the month.
 * It is chosen among the days of `weeks`, the weeks the grid draws: the
 * page's Week layout draws one of the month's, and a day of another week
 * would leave the grid with no day in the Tab order.
 */
export function tabStopDate(state: DrawnCalendar, weeks: readonly CalendarWeek[]): string | undefined {
  if (state.tabStop !== undefined) {
    return state.tabStop;
  }
  const snapshot = state.snapshot;
  const days = weeks.flatMap((week) => week.days.filter((day) => isDrawn(snapshot, day)));
  return chooseFocusDay(days, state.drawnFocus, snapshot.dayPanel ? state.drawnSelected : undefined);
}

/** The day panel's groups shown whole, with one more, which stays shown until the page reloads. */
export function withGroupShown(groups: readonly string[], group: string): readonly string[] {
  return groups.includes(group) ? groups : [...groups, group];
}
