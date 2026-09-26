import { stripTags } from '../../core/markdown/parser';
import { WorkspaceIndex } from '../../core/types';
import {
  findPeriodicNoteNames,
  formatLocalDate,
  getPeriodicNote,
  isPeriodicNoteName,
  listDailyNotes,
} from '../commands/dailyNote';

/** How many tasks and headings a day's tooltip names. */
const TOOLTIP_ITEMS = 5;

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
}

/** One row of the calendar: seven days, Sunday to Saturday. */
export interface CalendarWeek {
  /** The week's note name, such as week-2026-09-13-2026-09-19. */
  week: string;
  /** Its Sunday, as YYYY-MM-DD, which the week's note is found from. */
  date: string;
  /** The week's note, when it has one. */
  notePath?: string;
  days: CalendarDay[];
}

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
  weeks: CalendarWeek[];
}

const monthTitle = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
});

/**
 * One month as the calendar shows it: whole weeks from Sunday to Saturday,
 * with each day's daily note and the open tasks due that day, and the notes
 * kept for each week and for the month.
 *
 * A row is a week in its own right: the note it opens is named for the days
 * the row holds.
 */
export function createCalendar(
  index: WorkspaceIndex,
  month: string,
  now: Date,
): CalendarSnapshot {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const last = new Date(year, monthNumber, 0);
  const today = formatLocalDate(now);

  const dailyNotes = new Map<string, string>();
  for (const note of listDailyNotes(index)) {
    if (!dailyNotes.has(note.date)) {
      dailyNotes.set(note.date, note.filePath);
    }
  }
  // Weekly and monthly notes by name, under either naming.
  const periodicNotes = new Map<string, string>();
  for (const filePath of [...index.files.keys()].sort()) {
    const name = (filePath.split('/').pop() ?? '').replace(/\.md$/i, '');
    if (isPeriodicNoteName(name) && !periodicNotes.has(name)) {
      periodicNotes.set(name, filePath);
    }
  }
  /** The note a period keeps, whichever of its names it goes by. */
  const periodicNote = (period: 'week' | 'month', day: Date): string | undefined =>
    findPeriodicNoteNames(period, day)
      .map((name) => periodicNotes.get(name))
      .find(Boolean);
  const dueCounts = new Map<string, number>();
  const dueTitles = new Map<string, string[]>();
  for (const task of index.tasks.values()) {
    if (!task.completed && task.dueAt !== undefined) {
      const date = formatLocalDate(new Date(task.dueAt));
      dueCounts.set(date, (dueCounts.get(date) ?? 0) + 1);
      const titles = dueTitles.get(date) ?? [];
      if (titles.length < TOOLTIP_ITEMS) {
        titles.push(task.title.trim());
        dueTitles.set(date, titles);
      }
    }
  }
  /** A daily note's own headings, below its title, for a day's tooltip. */
  const headingsOf = (filePath: string): string[] =>
    (index.files.get(filePath)?.sections ?? [])
      .filter((section) => !section.isInline && section.headingLevel > 1)
      .map((section) => stripTags(section.heading).trim())
      .filter(Boolean)
      .slice(0, TOOLTIP_ITEMS);

  const weeks: CalendarWeek[] = [];
  for (
    let sunday = new Date(year, monthNumber - 1, 1 - first.getDay());
    sunday <= last;
    sunday = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 7)
  ) {
    // A row is a week: Sunday to Saturday, which is what its note is named
    // for and what its review covers.
    const week = getPeriodicNote('week', sunday).name;
    const days = Array.from({ length: 7 }, (_, offset): CalendarDay => {
      const day = new Date(
        sunday.getFullYear(),
        sunday.getMonth(),
        sunday.getDate() + offset,
      );
      const date = formatLocalDate(day);
      const notePath = dailyNotes.get(date);
      return {
        date,
        day: day.getDate(),
        inMonth: day.getMonth() === monthNumber - 1,
        isToday: date === today,
        ...(notePath ? { notePath, headings: headingsOf(notePath) } : {}),
        dueCount: dueCounts.get(date) ?? 0,
        ...(dueTitles.has(date) ? { dueTitles: dueTitles.get(date) } : {}),
      };
    });
    const notePath = periodicNote('week', sunday);
    weeks.push({
      week,
      date: formatLocalDate(sunday),
      ...(notePath ? { notePath } : {}),
      days,
    });
  }

  const notePath = periodicNote('month', first);
  return {
    month,
    title: monthTitle.format(first),
    today,
    previousMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    currentMonth: today.slice(0, 7),
    ...(notePath ? { notePath } : {}),
    weeks,
  };
}

/** The month some number of months before or after one, as YYYY-MM. */
export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return formatLocalDate(new Date(year, monthNumber - 1 + by, 1)).slice(0, 7);
}
