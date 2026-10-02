/**
 * Calendar arithmetic on local days: the one copy of the day length, the
 * month and weekday tables, and the moves by days and months that task
 * metadata, date phrases, and the parser's prose dates all use.
 *
 * Every timestamp here is a local time, and a day is the local calendar day
 * it falls in, so a daylight-saving change never shifts a date. The
 * calendar pages' steps, at the end, work on `YYYY-MM-DD` dates instead.
 */

/**
 * A day in milliseconds, for turning a gap between two local midnights into
 * days. Round the quotient: across a daylight-saving change the gap is an
 * hour off.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Weekday names in `Date.getDay()` order, Sunday first. */
export const WEEKDAY_NAMES: readonly string[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Short weekday names in `Date.getDay()` order, Sunday first, as dates are
 * labeled in English wherever Deckard writes one, such as "Mon 2026-09-14".
 */
export const SHORT_WEEKDAY_NAMES: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Month names and their short forms, as the month number `Date` uses. */
export const MONTH_NUMBERS: Readonly<Record<string, number>> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/**
 * A real local day, as its midnight, or undefined for one such as February
 * 31st. `month` is 0-based, as `Date` counts it. A year below 100 is refused,
 * since `Date` would read it as 19xx.
 */
export function makeDay(year: number, month: number, day: number): number | undefined {
  const made = new Date(year, month, day);
  return made.getFullYear() === year && made.getMonth() === month && made.getDate() === day
    ? made.getTime()
    : undefined;
}

/** Reads a `YYYY-MM-DD` date as local midnight, rejecting impossible dates. */
export function parseIsoDate(value: string | undefined): number | undefined {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) {
    return undefined;
  }
  return makeDay(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Writes a timestamp as the local `YYYY-MM-DD` date Tasks uses. */
export function formatIsoDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local midnight that begins the day a timestamp falls in. */
export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Moves by calendar days, so a daylight-saving change never shifts the date. */
export function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
  ).getTime();
}

/** How many days the month a date falls in has. */
export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Moves by calendar months, keeping the day where the month allows it: a
 * month on from January 31st is the last day of February. The result is a
 * local midnight, whatever time `timestamp` held.
 */
export function addMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp);
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  target.setDate(Math.min(date.getDate(), daysInMonth(target)));
  return target.getTime();
}

/*
 * The calendar pages' own steps, on `YYYY-MM-DD` dates as the pages carry
 * them. A page reads its dates as UTC days, so no time zone or
 * daylight-saving change moves one; a page imports these to step and focus
 * without asking its host (D1 in docs/architecture/layers.md).
 */

/** A `YYYY-MM-DD` date as its parts, month 1-based. */
function readDateParts(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}

/** A `YYYY-MM-DD` date moved by some days, as `YYYY-MM-DD`. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = readDateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Whether a `YYYY-MM-DD` date is a Saturday or a Sunday. */
export function isWeekend(date: string): boolean {
  const [year, month, day] = readDateParts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * A date, or, with the weekends hidden, the first weekday from it going one
 * way: `direction` 1 is later, -1 earlier.
 */
export function skipWeekend(date: string, direction: number, hideWeekends: boolean): string {
  let at = date;
  while (hideWeekends && isWeekend(at)) {
    at = shiftDate(at, direction);
  }
  return at;
}

/**
 * A key's step from a day, as a date. `step` is how many cells the key
 * moves along the drawn grid: a row down is a week whichever number of days
 * the row draws (five with the weekends hidden, seven without), and a step
 * onto a hidden weekend goes on to the next weekday that way.
 */
export function stepDate(date: string, step: number, hideWeekends: boolean): string {
  const columns = hideWeekends ? 5 : 7;
  const days = Math.abs(step) === columns ? Math.sign(step) * 7 : step;
  return skipWeekend(shiftDate(date, days), Math.sign(step) || 1, hideWeekends);
}

/** The same day of the month in another month, `YYYY-MM`, or that month's last day. */
export function sameDayIn(date: string, month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, '0')}`;
}

/** What the focus-day choice reads of a drawn day. */
export interface FocusableDay {
  readonly date: string;
  readonly isToday: boolean;
  /** Whether the day is in the month shown, rather than a neighbor's. */
  readonly inMonth: boolean;
}

/**
 * The one day of a calendar's grid that takes Tab: the chosen day, when one
 * is chosen and the focused day is not drawn; else the focused day, when it
 * is drawn; else today, else the first day of the month. `days` are the
 * days the grid draws; `chosen` is the chosen day only where a calendar
 * chooses one (its day panel is on).
 */
export function chooseFocusDay(
  days: readonly FocusableDay[],
  focused: string | undefined,
  chosen: string | undefined,
): string | undefined {
  const has = (date: string | undefined): boolean => Boolean(date) && days.some((day) => day.date === date);
  if (has(chosen) && !has(focused)) {
    return chosen;
  }
  if (has(focused)) {
    return focused;
  }
  return days.find((day) => day.isToday)?.date ?? days.find((day) => day.inMonth)?.date;
}

/** Where a calendar steps from, and the months either side of the one it shows. */
export interface CalendarStepFrom {
  /** The chosen day, or today when none is chosen. */
  readonly date: string;
  /** The months before and after the one shown, `YYYY-MM`. */
  readonly previousMonth: string;
  readonly nextMonth: string;
  /** Whether the weekends are hidden, so a step lands on a weekday. */
  readonly hideWeekends: boolean;
}

/**
 * A step of the calendar page a month or a week back (`by` -1) or on (1),
 * keeping the chosen day's place. A week moves the day seven days, in the
 * month the day lands in. A month moves to the same day of the month before
 * or after, or its last day, then on to a weekday if the weekends are
 * hidden, and names that month.
 */
export function stepCalendar(
  layout: 'month' | 'week',
  by: number,
  from: CalendarStepFrom,
): { readonly month?: string; readonly date: string } {
  if (layout === 'week') {
    return { date: shiftDate(from.date, 7 * by) };
  }
  const month = by < 0 ? from.previousMonth : from.nextMonth;
  return { month, date: skipWeekend(sameDayIn(from.date, month), 1, from.hideWeekends) };
}
