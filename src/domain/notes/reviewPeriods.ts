import type { Weekday } from '../markdown/dates';
import { getPeriodEnd, getPeriodicNote, getPeriodStart, NotePeriod, parseLocalDate } from './periodicNotes';
import { formatIsoDate } from '../markdown/calendar';

/**
 * Which days a week's or a month's review covers: the period a day falls
 * in, or the period a periodic note's own name says it is for.
 */

/** The stretch of days a review covers, as the review's writer reads it. */
export interface ReviewPeriod {
  /** What the period's note is called, such as `2026-W38` or `2026-09`. */
  name: string;
  /** What the review is called: the days it covers, first to last. */
  title: string;
  /** Local midnight the period starts, and the midnight after it ends. */
  start: number;
  end: number;
}

/** What a periodic note's name says about the period it is for. */
export interface PeriodicNoteName {
  period: Exclude<NotePeriod, 'day'>;
  /** A day in the period: its first. */
  day: Date;
  /** A week note's own first day, and the midnight after its last. */
  start?: Date;
  end?: Date;
  /** The note's name, for a week note, whose name says its days. */
  name?: string;
}

/** The days a period covers: its first midnight, and the midnight after it. */
export function getReviewRange(
  period: Exclude<NotePeriod, 'day'>,
  day: Date,
  weekStart: Weekday = 0,
): ReviewPeriod {
  const { name } = getPeriodicNote(period, day, weekStart);
  const start = getPeriodStart(period, day, weekStart);
  const last = getPeriodEnd(period, start);
  // The day after the last, so a date inside the period is `>= start` and
  // `< end` whatever hour it carries.
  const end = new Date(
    last.getFullYear(),
    last.getMonth(),
    last.getDate() + 1,
  );
  return {
    name,
    title: `${formatIsoDate(start.getTime())} to ${formatIsoDate(last.getTime())}`,
    start: start.getTime(),
    end: end.getTime(),
  };
}

/** The Monday of an ISO week, which is the day its note is named for. */
export function getIsoWeekStart(year: number, week: number): Date {
  const january4 = new Date(year, 0, 4);
  const weekday = (january4.getDay() + 6) % 7;
  return new Date(year, 0, 4 - weekday + (week - 1) * 7);
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * How each name Deckard has given a periodic note is read, tried in order:
 * the days a week holds, the month by name, and the ISO week and year-month
 * Deckard wrote before. A reader returns undefined when the name matches
 * the pattern but names no period, such as an unknown month.
 */
const NOTE_NAMES: readonly {
  pattern: RegExp;
  read: (match: RegExpExecArray, fileName: string) => PeriodicNoteName | undefined;
}[] = [
  {
    pattern: /^week-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/i,
    read: (match, fileName) => {
      const start = parseLocalDate(match[1]);
      const last = parseLocalDate(match[2]);
      if (!start || !last) {
        return undefined;
      }
      return {
        period: 'week',
        day: start,
        start,
        end: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
        name: fileName,
      };
    },
  },
  {
    pattern: /^month-([a-z]+)-(\d{4})$/i,
    read: (match) => {
      const month = MONTHS.indexOf(match[1].toLowerCase());
      return month >= 0 ? { period: 'month', day: new Date(Number(match[2]), month, 1) } : undefined;
    },
  },
  {
    pattern: /^(\d{4})-W(\d{2})$/,
    read: (match, fileName) => {
      const monday = getIsoWeekStart(Number(match[1]), Number(match[2]));
      return {
        period: 'week',
        day: monday,
        start: monday,
        end: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7),
        name: fileName,
      };
    },
  },
  {
    pattern: /^(\d{4})-(\d{2})$/,
    read: (match) => ({ period: 'month', day: new Date(Number(match[1]), Number(match[2]) - 1, 1) }),
  },
];

/**
 * The period a note is for, from its file name without `.md`, whichever name
 * it goes by: the days a note holds, or the ISO week and year-month Deckard
 * wrote before. Undefined for any other note, a daily note among them.
 */
export function parsePeriodicNoteName(fileName: string): PeriodicNoteName | undefined {
  if (!fileName) {
    return undefined;
  }
  for (const { pattern, read } of NOTE_NAMES) {
    const match = pattern.exec(fileName);
    const found = match ? read(match, fileName) : undefined;
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * The days a note is reviewed for when its own name says them: a week note
 * is reviewed for the days it holds, whatever week start was set when it was
 * made. Undefined for a note whose name gives only its period.
 */
export function reviewPeriodOfNote(note: PeriodicNoteName, fileName: string): ReviewPeriod | undefined {
  if (!note.start || !note.end) {
    return undefined;
  }
  const last = new Date(note.end.getFullYear(), note.end.getMonth(), note.end.getDate() - 1);
  return {
    name: note.name ?? fileName,
    title: `${formatIsoDate(note.start.getTime())} to ${formatIsoDate(last.getTime())}`,
    start: note.start.getTime(),
    end: note.end.getTime(),
  };
}
