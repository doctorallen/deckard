/**
 * Calendar arithmetic on local days: the one copy of the day length, the
 * month and weekday tables, and the moves by days and months that task
 * metadata, date phrases, and the parser's prose dates all use.
 *
 * Every timestamp here is a local time, and a day is the local calendar day
 * it falls in, so a daylight-saving change never shifts a date.
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
