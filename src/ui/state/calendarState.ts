import { WorkspaceIndex } from '../../core/types';
import {
  formatLocalDate,
  getPeriodicNote,
  listDailyNotes,
} from '../commands/dailyNote';

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
}

/** One ISO week in the calendar, Monday first. */
export interface CalendarWeek {
  /** The ISO week, such as 2026-W37. */
  week: string;
  /** Its Monday, as YYYY-MM-DD. */
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
 * One month as the calendar shows it: whole ISO weeks, Monday first, with each
 * day's daily note and the open tasks due that day, and the notes kept for
 * each week and for the month.
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
  // Weekly and monthly notes by name, such as 2026-W37 or 2026-09.
  const periodicNotes = new Map<string, string>();
  for (const filePath of [...index.files.keys()].sort()) {
    const name = (filePath.split('/').pop() ?? '').replace(/\.md$/i, '');
    if (/^\d{4}-(?:W\d{2}|\d{2})$/.test(name) && !periodicNotes.has(name)) {
      periodicNotes.set(name, filePath);
    }
  }
  const dueCounts = new Map<string, number>();
  for (const task of index.tasks.values()) {
    if (!task.completed && task.dueAt !== undefined) {
      const date = formatLocalDate(new Date(task.dueAt));
      dueCounts.set(date, (dueCounts.get(date) ?? 0) + 1);
    }
  }

  const weeks: CalendarWeek[] = [];
  for (
    let monday = new Date(year, monthNumber - 1, 1 - ((first.getDay() + 6) % 7));
    monday <= last;
    monday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)
  ) {
    const week = getPeriodicNote('week', monday).name;
    const days = Array.from({ length: 7 }, (_, offset): CalendarDay => {
      const day = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + offset,
      );
      const date = formatLocalDate(day);
      const notePath = dailyNotes.get(date);
      return {
        date,
        day: day.getDate(),
        inMonth: day.getMonth() === monthNumber - 1,
        isToday: date === today,
        ...(notePath ? { notePath } : {}),
        dueCount: dueCounts.get(date) ?? 0,
      };
    });
    const notePath = periodicNotes.get(week);
    weeks.push({
      week,
      date: formatLocalDate(monday),
      ...(notePath ? { notePath } : {}),
      days,
    });
  }

  const notePath = periodicNotes.get(month);
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
