import { addDays, DAY_MS, parseIsoDate, startOfDay } from '../markdown/calendar';
import { parseDatePhrase, resolveDatePeriod, Weekday } from '../markdown/dates';

/**
 * The date rules a query shares between parsing and evaluating: what a date
 * value such as `today`, `7d`, `2026-09-13`, `this-week`, or `friday` means,
 * as the span of time it names. The parser asks it whether a value is a date
 * at all, and the evaluator compares against the span, so the two cannot
 * disagree about what a date is and neither has to import the other.
 */

/**
 * Whether a relative window such as `7d` looks back from today, as `created`
 * and `updated` do, or ahead, as a due date does.
 */
export type DateDirection = 'past' | 'future';

/** The half-open interval of time a date value names. */
export interface DateRange {
  start: number;
  end: number;
  /** True for a relative window such as 7d, rather than one named day. */
  isWindow: boolean;
}

/**
 * Turns a date value into the half-open interval it names, read on the day
 * `now` falls on, with weeks starting on `weekStart`: a named day, a
 * relative window, a `YYYY-MM-DD` day, a whole week or month, or any other
 * day in plain words, tried in that order. Undefined when it is none.
 */
export function resolveDateRange(
  value: string,
  now: number,
  direction: DateDirection,
  weekStart: Weekday,
): DateRange | undefined {
  const normalized = value.trim().toLowerCase();
  const context: RangeContext = { now, direction, weekStart };
  for (const read of RANGE_READERS) {
    const reading = read(normalized, context);
    if (reading) {
      return reading.range;
    }
  }
  return undefined;
}

/** What a date value is read against. */
interface RangeContext {
  now: number;
  direction: DateDirection;
  weekStart: Weekday;
}

/**
 * What a reader made of a date value: undefined when the value is not its
 * shape, so the next reader tries; otherwise the range, which is undefined
 * when the value is its shape but names no time, and then no later reader
 * tries.
 */
type RangeReading = { range: DateRange | undefined } | undefined;

/** How far each named day is from today. */
const NAMED_DAY_OFFSETS: Readonly<Record<string, number>> = {
  yesterday: -1,
  today: 0,
  tomorrow: 1,
};

/** `yesterday`, `today`, or `tomorrow`, as that one day. */
function readNamedDay(normalized: string, { now }: RangeContext): RangeReading {
  if (!Object.hasOwn(NAMED_DAY_OFFSETS, normalized)) {
    return undefined;
  }
  const start = startOfDay(now) + NAMED_DAY_OFFSETS[normalized] * DAY_MS;
  return { range: { start, end: start + DAY_MS, isWindow: false } };
}

/** How many days each window unit counts: a month is 30 and a year 365. */
const DAYS_PER_UNIT: Readonly<Record<string, number>> = { d: 1, w: 7, m: 30, y: 365 };

/**
 * A relative window, `7d`, `2w`, `3m`, `1y`. A window counts today as its
 * first day: `updated = 7d` is the last seven days including today, and
 * `due = 7d` is today and the six after it.
 */
function readWindow(normalized: string, { now, direction }: RangeContext): RangeReading {
  const relative = /^(\d+)([dwmy])$/.exec(normalized);
  if (!relative) {
    return undefined;
  }
  const days = Number(relative[1]) * DAYS_PER_UNIT[relative[2]];
  return direction === 'past'
    ? {
        range: {
          start: startOfDay(now) - (days - 1) * DAY_MS,
          end: startOfDay(now) + DAY_MS,
          isWindow: true,
        },
      }
    : {
        range: {
          start: startOfDay(now),
          end: startOfDay(now) + days * DAY_MS,
          isWindow: true,
        },
      };
}

/**
 * A `YYYY-MM-DD` day, as that one day from its local midnight. A day the
 * calendar does not have, such as `2026-02-31`, names no time rather than
 * rolling over into March.
 */
function readIsoDay(normalized: string): RangeReading {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return undefined;
  }
  const start = parseIsoDate(normalized);
  if (start === undefined) {
    return { range: undefined };
  }
  return { range: { start, end: start + DAY_MS, isWindow: false } };
}

/** A whole week or month, as resolveDatePeriod reads it. */
function readPeriod(normalized: string, { now, weekStart }: RangeContext): RangeReading {
  const period = resolveDatePeriod(normalized, now, weekStart);
  return period ? { range: { ...period, isWindow: false } } : undefined;
}

/**
 * Any other day in plain words, with `-` for a space: `friday`,
 * `end-of-month`, `"oct 3"`. A bare weekday points back for the dates a
 * note or task already has, and ahead for the ones a task is due.
 */
function readPhraseDay(normalized: string, { now, direction, weekStart }: RangeContext): RangeReading {
  const phrase = parseDatePhrase(normalized.replace(/-/g, ' '), now, {
    direction,
    weekStart,
  });
  if (!phrase?.date) {
    return undefined;
  }
  const [year, month, day] = phrase.date.split('-').map(Number);
  const start = new Date(year, month - 1, day).getTime();
  return { range: { start, end: addDays(start, 1), isWindow: false } };
}

/** The shapes a date value can take, in the order they are tried. */
const RANGE_READERS: readonly ((normalized: string, context: RangeContext) => RangeReading)[] = [
  readNamedDay,
  readWindow,
  readIsoDay,
  readPeriod,
  readPhraseDay,
];
