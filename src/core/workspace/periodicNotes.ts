import {
  findFileDailyNoteDate,
  isPeriodicNotePath,
} from '../markdown/parser';
import { WorkspaceIndex } from '../types';
import { Weekday } from '../markdown/dates';

/** A daily note in the index, by the day it is for. */
export interface DailyNoteEntry {
  date: string;
  filePath: string;
}

/**
 * The index's daily notes, oldest first: notes named for a day, or whose top
 * heading holds one.
 */
export function listDailyNotes(index: WorkspaceIndex): DailyNoteEntry[] {
  return [...index.files.values()]
    .flatMap((file) => {
      const date = findFileDailyNoteDate(file);
      return date ? [{ date, filePath: file.filePath }] : [];
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.filePath.localeCompare(right.filePath),
    );
}

/** The nearest daily note before or after a day, skipping days without one. */
export function findAdjacentDailyNote(
  notes: readonly DailyNoteEntry[],
  from: string,
  direction: 'previous' | 'next',
): DailyNoteEntry | undefined {
  return direction === 'previous'
    ? [...notes].reverse().find((note) => note.date < from)
    : notes.find((note) => note.date > from);
}

/** A stretch of the calendar a note can be kept for. */
export type NotePeriod = 'day' | 'week' | 'month';

/** The values a periodic note's template can use. */
export type PeriodicNoteVariables = Record<'date' | 'week' | 'month', string>;

/**
 * The note for the period containing a day: its name, and the values its
 * template can use.
 *
 * A week starts on the day `deckard.calendar.weekStart` names, Sunday unless
 * it is changed, as the Calendar draws it, and both names
 * say which days they hold — `week-2026-09-13-2026-09-19`,
 * `month-september-2026` — because a file name is read far from the note it
 * belongs to, where `2026-W38` says little. The names Deckard wrote before,
 * `2026-W38` and `2026-09`, are still read; see `findPeriodicNoteNames`.
 */
export function getPeriodicNote(
  period: NotePeriod,
  day: Date,
  weekStart: Weekday = 0,
): { name: string; variables: PeriodicNoteVariables } {
  const start = getPeriodStart(period, day, weekStart);
  const date = formatLocalDate(start);
  const end = getPeriodEnd(period, start);
  const variables = {
    date,
    week: `${date} to ${formatLocalDate(end)}`,
    month: `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`,
  };
  return {
    name:
      period === 'day'
        ? date
        : period === 'week'
          ? `week-${date}-${formatLocalDate(end)}`
          : `month-${MONTH_NAMES[start.getMonth()].toLowerCase()}-${start.getFullYear()}`,
    variables,
  };
}

/** The first day of the period holding a day: a week's first day, a month's 1st. */
export function getPeriodStart(
  period: NotePeriod,
  day: Date,
  weekStart: Weekday = 0,
): Date {
  if (period === 'week') {
    return new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate() - ((day.getDay() - weekStart + 7) % 7),
    );
  }
  return period === 'month'
    ? new Date(day.getFullYear(), day.getMonth(), 1)
    : day;
}

/** The last day a period holds, which its name ends with. */
export function getPeriodEnd(period: NotePeriod, start: Date): Date {
  if (period === 'week') {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  }
  return period === 'month'
    ? new Date(start.getFullYear(), start.getMonth() + 1, 0)
    : start;
}

/**
 * Every name a period's note may go by: the one Deckard writes now, and the
 * ISO-week or year-month name it wrote before, so a workspace that already
 * keeps `2026-W38.md` goes on using it rather than gaining a second note for
 * the same week.
 *
 * A week note written under another week start is found too. Week notes tile
 * seven days apart, so exactly one of them holds this week's middle day, and
 * it shares at least four days with this week: after a switch from Sunday to
 * Monday, the week of Mon Sep 21 opens `week-2026-09-20-2026-09-26`.
 */
export function findPeriodicNoteNames(
  period: NotePeriod,
  day: Date,
  weekStart: Weekday = 0,
): string[] {
  const { name } = getPeriodicNote(period, day, weekStart);
  if (period === 'day') {
    return [name];
  }
  const start = getPeriodStart(period, day, weekStart);
  if (period === 'month') {
    return [name, formatLocalDate(start).slice(0, 7)];
  }
  const middle = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3);
  // An ISO week is named for the week its Monday to Sunday holds, which is
  // the week an earlier note would have been written for.
  const { year, week } = getIsoWeek(middle);
  const names = [name, `${year}-W${String(week).padStart(2, '0')}`];
  for (let other = 0; other < 7; other += 1) {
    if (other !== weekStart) {
      names.push(getPeriodicNote('week', middle, other as Weekday).name);
    }
  }
  return [...new Set(names)];
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Whether a name is a week or month note, in either naming. */
export function isPeriodicNoteName(name: string): boolean {
  return isPeriodicNotePath(`${name}.md`);
}

/**
 * The ISO week a day falls in. It is the week of that week's Thursday, so the
 * first days of January can belong to the last week of the year before.
 */
export function getIsoWeek(day: Date): { year: number; week: number } {
  const thursday = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() - getWeekday(day) + 3,
  );
  const year = thursday.getFullYear();
  const january4 = new Date(year, 0, 4);
  const firstThursday = new Date(year, 0, 4 - getWeekday(january4) + 3);
  // Rounding absorbs the hour a daylight-saving change adds or removes.
  const week =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return { year, week };
}

/** A YYYY-MM-DD date as local midnight, or undefined when it is not a real day. */
export function parseLocalDate(date: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return undefined;
  }
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return formatLocalDate(day) === date ? day : undefined;
}

/** Monday is 0 and Sunday is 6, as in an ISO week. */
function getWeekday(day: Date): number {
  return (day.getDay() + 6) % 7;
}

/**
 * Uses local calendar fields so a daily note is named for the user's day, not
 * the previous or next UTC day around a timezone boundary.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
