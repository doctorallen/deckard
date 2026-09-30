import {
  addDays,
  addMonths,
  DAY_MS,
  formatIsoDate,
  makeDay,
  MONTH_NUMBERS,
  parseIsoDate,
  SHORT_WEEKDAY_NAMES,
  startOfDay,
  WEEKDAY_NAMES,
} from './calendar';

export { MONTH_NUMBERS, WEEKDAY_NAMES } from './calendar';

/**
 * One way to read a date written in plain words.
 *
 * Deckard had four readers for a date typed into a box, each taking a
 * different set of words: the task editor read `friday`, bulk edit read only
 * `today` and ISO dates, and the query language read neither. Every date box
 * now reads through `parseDatePhrase`, and says back the day it read with
 * `describeDay`, so a date typed anywhere means the same day.
 *
 * The indexer's reader for dates inside prose (`parser.ts`) stays its own: it
 * anchors a date to the note's day, not to today. It shares calendar.ts, the
 * month and weekday tables and the day arithmetic, and nothing else.
 */

/** A day of the week, 0 for Sunday, as `Date.getDay()` numbers them. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DatePhraseOptions {
  /** The day a week starts on, for `next week` and `end of week`. Sunday by default. */
  weekStart?: Weekday;
  /**
   * The order a numeric date such as `10/3` is read in. Absent, numeric
   * dates are not read at all: only a box that says the day back before
   * writing it reads them, since `10/3` means two different days.
   */
  numericOrder?: 'mdy' | 'dmy';
  /**
   * Which way a bare weekday or a month-day without a year points: the next
   * one for a date a task is due, the last one for a date a note was written.
   */
  direction?: 'future' | 'past';
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const LONG_MONTHS = [
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

/** A weekday written in full or short: `fri`, `tues`, `thurs`, `wednesday`. */
const WEEKDAY_WORD =
  '(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?';
const MONTH_WORD =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** The number of a weekday written in full or short, or -1. */
function weekdayNumber(word: string): number {
  return WEEKDAY_NAMES.findIndex((name) => name.startsWith(word.slice(0, 3)));
}

/** The number of a month written in full or short, or undefined. */
function monthNumber(word: string): number | undefined {
  const full = MONTH_NUMBERS[word];
  if (full !== undefined) {
    return full;
  }
  const short = MONTH_NUMBERS[word.slice(0, 3)];
  return short;
}

/** The first day of the week `at` falls in, at midnight. */
export function startOfWeek(at: number, weekStart: Weekday = 0): number {
  const day = startOfDay(at);
  return addDays(day, -((new Date(day).getDay() - weekStart + 7) % 7));
}

/**
 * A month and day with no year: the next one on or after today, or for the
 * past direction the last one on or before today.
 */
function nearestYear(
  month: number,
  day: number,
  today: number,
  direction: 'future' | 'past',
): number | undefined {
  const year = new Date(today).getFullYear();
  const candidates = [year - 1, year, year + 1]
    .map((each) => makeDay(each, month, day))
    .filter((at): at is number => at !== undefined);
  if (candidates.length === 0) {
    // February 29th, most years: say so rather than pick another day.
    return undefined;
  }
  return direction === 'future'
    ? candidates.find((at) => at >= today)
    : [...candidates].reverse().find((at) => at <= today);
}

function fullYear(written: string): number {
  const year = Number(written);
  return written.length <= 2 ? 2000 + year : year;
}

/**
 * Reads a date written in plain words, as the day it means.
 *
 * Returns the date as `YYYY-MM-DD`, `{ date: undefined }` for an empty value,
 * which clears a field, or undefined when the words are not a day, which a
 * box reports rather than guessing.
 */
export function parseDatePhrase(
  written: string,
  now: number = Date.now(),
  options: DatePhraseOptions = {},
): { date: string | undefined } | undefined {
  const text = written
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .replace(/(\d)(?:st|nd|rd|th)\b/g, '$1');
  if (!text) {
    return { date: undefined };
  }
  const at = readPhrase(text, startOfDay(now), options);
  return at === undefined ? undefined : { date: formatIsoDate(at) };
}

function readPhrase(
  text: string,
  today: number,
  options: DatePhraseOptions,
): number | undefined {
  const weekStart = options.weekStart ?? 0;
  const direction = options.direction ?? 'future';

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (iso) {
    return makeDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  if (text === 'today') {
    return today;
  }
  if (text === 'tomorrow') {
    return addDays(today, 1);
  }
  if (text === 'yesterday') {
    return addDays(today, -1);
  }

  // "in 3 days", "+2w", "3 weeks", and "3 days ago"
  const distance =
    /^(?:in )?(\+)?(\d+) ?(d|w|m|y|days?|weeks?|months?|years?)( ago)?$/.exec(text);
  if (distance && !(distance[1] && distance[4])) {
    const count = Number(distance[2]) * (distance[4] ? -1 : 1);
    const unit = distance[3][0];
    if (unit === 'd') {
      return addDays(today, count);
    }
    if (unit === 'w') {
      return addDays(today, count * 7);
    }
    return addMonths(today, unit === 'm' ? count : count * 12);
  }

  // "friday", "next friday", "this friday", "on friday", "last friday"
  const weekday = new RegExp(`^(?:(next|this|on|last) )?${WEEKDAY_WORD}$`).exec(text);
  if (weekday) {
    const wanted = weekdayNumber(weekday[2]);
    const current = new Date(today).getDay();
    const back =
      weekday[1] === 'last' || (direction === 'past' && weekday[1] !== 'next');
    return back
      ? addDays(today, -(((current - wanted + 7) % 7) || 7))
      : addDays(today, ((wanted - current + 7) % 7) || 7);
  }

  if (text === 'next week') {
    const next = addDays(startOfWeek(today, weekStart), 7);
    return addDays(next, (1 - weekStart + 7) % 7);
  }
  if (/^(?:end of (?:the )?week|eow)$/.test(text)) {
    return addDays(startOfWeek(today, weekStart), 6);
  }
  if (/^(?:end of (?:the )?month|eom)$/.test(text)) {
    const date = new Date(today);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getTime();
  }
  if (text === 'next month') {
    const date = new Date(today);
    return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  }
  if (/^(?:this |the )?weekend$/.test(text)) {
    const current = new Date(today).getDay();
    return current === 0 || current === 6 ? today : addDays(today, 6 - current);
  }

  const withoutOn = text.replace(/^on /, '');
  // "oct 3", "october 3, 2027"
  const monthFirst = new RegExp(`^${MONTH_WORD} (\\d{1,2}),? ?(\\d{4})?$`).exec(withoutOn);
  // "3 oct", "3 october 2027"
  const dayFirst = new RegExp(`^(\\d{1,2}) ${MONTH_WORD},? ?(\\d{4})?$`).exec(withoutOn);
  if (monthFirst || dayFirst) {
    const month = monthNumber(monthFirst ? monthFirst[1] : dayFirst![2]);
    const day = Number(monthFirst ? monthFirst[2] : dayFirst![1]);
    const year = monthFirst ? monthFirst[3] : dayFirst![3];
    if (month === undefined) {
      return undefined;
    }
    return year
      ? makeDay(Number(year), month, day)
      : nearestYear(month, day, today, direction);
  }

  // "10/3", "10/3/27", "3.10.2026": only where the order is known.
  const numeric = /^(\d{1,2})([/.])(\d{1,2})(?:\2(\d{2}|\d{4}))?$/.exec(withoutOn);
  if (numeric && options.numericOrder) {
    const first = Number(numeric[1]);
    const second = Number(numeric[3]);
    const orders: [number, number][] =
      options.numericOrder === 'mdy'
        ? [
            [first, second],
            [second, first],
          ]
        : [
            [second, first],
            [first, second],
          ];
    for (const [month, day] of orders) {
      const found = numeric[4]
        ? makeDay(fullYear(numeric[4]), month - 1, day)
        : nearestYear(month - 1, day, today, direction);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  return undefined;
}

/**
 * A day said back as a box shows it: its weekday, the date, and how far it is
 * from today, `Monday 2026-09-28 · in 3 days`. Beyond a month the distance
 * is left to the date.
 */
export function describeDay(date: string, now: number = Date.now()): string {
  const at = parseIsoDate(date);
  if (at === undefined) {
    return date;
  }
  const distance = describeDistance(at, now);
  return distance ? `${nameDay(date)} · ${distance}` : nameDay(date);
}

/** A day with its weekday and nothing else: `Friday 2026-09-25`. */
export function nameDay(date: string): string {
  const at = parseIsoDate(date);
  if (at === undefined) {
    return date;
  }
  const weekday = WEEKDAY_NAMES[new Date(at).getDay()];
  return `${weekday[0].toUpperCase()}${weekday.slice(1)} ${date}`;
}

/** `today`, `in 3 days`, `3 days ago`; nothing beyond 31 days. */
export function describeDistance(at: number, now: number = Date.now()): string | undefined {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return 'tomorrow';
  }
  if (days === -1) {
    return 'yesterday';
  }
  if (Math.abs(days) > 31) {
    return undefined;
  }
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** A day written short, `Fri, Oct 2`, with its year when it is not this one. */
export function formatShortDay(date: string, now: number = Date.now()): string {
  const at = parseIsoDate(date);
  if (at === undefined) {
    return date;
  }
  const day = new Date(at);
  const text = `${SHORT_WEEKDAY_NAMES[day.getDay()]}, ${SHORT_MONTHS[day.getMonth()]} ${day.getDate()}`;
  return day.getFullYear() === new Date(now).getFullYear()
    ? text
    : `${text}, ${day.getFullYear()}`;
}

/** A month and day written short, `Sep 20`. */
export function formatMonthDay(at: number): string {
  const day = new Date(at);
  return `${SHORT_MONTHS[day.getMonth()]} ${day.getDate()}`;
}

/** A month's name, with its year when it is not this one: `August`, `December 2025`. */
export function formatMonthName(at: number, now: number = Date.now()): string {
  const day = new Date(at);
  const name = LONG_MONTHS[day.getMonth()];
  return day.getFullYear() === new Date(now).getFullYear()
    ? name
    : `${name} ${day.getFullYear()}`;
}

/**
 * A whole week or month named in a search: `this-week`, `last-month`,
 * `next-week`, or `2026-08`. The end is the first moment after it.
 */
export function resolveDatePeriod(
  text: string,
  now: number,
  weekStart: Weekday = 0,
): { start: number; end: number } | undefined {
  const value = text.trim().toLowerCase();
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const index = Number(month[2]) - 1;
    if (index < 0 || index > 11) {
      return undefined;
    }
    const start = new Date(Number(month[1]), index, 1).getTime();
    return { start, end: new Date(Number(month[1]), index + 1, 1).getTime() };
  }
  const period = /^(this|last|next)-(week|month)$/.exec(value);
  if (!period) {
    return undefined;
  }
  const step = period[1] === 'this' ? 0 : period[1] === 'last' ? -1 : 1;
  if (period[2] === 'week') {
    const start = addDays(startOfWeek(now, weekStart), step * 7);
    return { start, end: addDays(start, 7) };
  }
  const today = new Date(startOfDay(now));
  return {
    start: new Date(today.getFullYear(), today.getMonth() + step, 1).getTime(),
    end: new Date(today.getFullYear(), today.getMonth() + step + 1, 1).getTime(),
  };
}
