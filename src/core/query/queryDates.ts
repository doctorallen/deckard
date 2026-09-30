import { addDays, DAY_MS, startOfDay } from '../markdown/calendar';
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
 * `now` falls on, with weeks starting on `weekStart`.
 */
export function resolveDateRange(
  value: string,
  now: number,
  direction: DateDirection,
  weekStart: Weekday,
): DateRange | undefined {
  const normalized = value.trim().toLowerCase();

  const namedDayOffsets: Record<string, number> = {
    yesterday: -1,
    today: 0,
    tomorrow: 1,
  };
  if (Object.hasOwn(namedDayOffsets, normalized)) {
    const start = startOfDay(now) + namedDayOffsets[normalized] * DAY_MS;
    return { start, end: start + DAY_MS, isWindow: false };
  }

  const relative = /^(\d+)([dwmy])$/.exec(normalized);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const days =
      unit === 'd'
        ? amount
        : unit === 'w'
          ? amount * 7
          : unit === 'm'
            ? amount * 30
            : amount * 365;
    // A window counts today as its first day: `updated = 7d` is the last seven
    // days including today, and `due = 7d` is today and the six after it.
    return direction === 'past'
      ? {
          start: startOfDay(now) - (days - 1) * DAY_MS,
          end: startOfDay(now) + DAY_MS,
          isWindow: true,
        }
      : {
          start: startOfDay(now),
          end: startOfDay(now) + days * DAY_MS,
          isWindow: true,
        };
  }

  const absolute = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (absolute) {
    const start = new Date(
      Number(absolute[1]),
      Number(absolute[2]) - 1,
      Number(absolute[3]),
    ).getTime();
    if (Number.isNaN(start)) {
      return undefined;
    }
    return { start, end: start + DAY_MS, isWindow: false };
  }

  // A whole week or month: `this-week`, `last-month`, `2026-08`.
  const period = resolveDatePeriod(normalized, now, weekStart);
  if (period) {
    return { ...period, isWindow: false };
  }

  // Any other day in plain words, with `-` for a space: `friday`,
  // `end-of-month`, `"oct 3"`. A bare weekday points back for the dates a
  // note or task already has, and ahead for the ones a task is due.
  const phrase = parseDatePhrase(normalized.replace(/-/g, ' '), now, {
    direction,
    weekStart,
  });
  if (phrase?.date) {
    const [year, month, day] = phrase.date.split('-').map(Number);
    const start = new Date(year, month - 1, day).getTime();
    return { start, end: addDays(start, 1), isWindow: false };
  }

  return undefined;
}
