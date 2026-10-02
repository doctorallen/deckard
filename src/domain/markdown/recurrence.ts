import { addDays, addMonths, daysInMonth, startOfDay, WEEKDAY_NAMES } from './calendar';

/**
 * Repeat rules: reading the ones Tasks writes, stepping a task to its next
 * date, drawing the dates it will fall on, and suggesting a rule Deckard can
 * read for one it cannot.
 */

/**
 * The date a repeat rule advances: the due date, or else the scheduled or
 * start date. Completing a task and drawing its later dates on the calendar
 * both start from it, so the two never disagree about what comes next.
 */
export function recurrenceReference(dates: {
  due?: number;
  scheduled?: number;
  start?: number;
}): number | undefined {
  return dates.due ?? dates.scheduled ?? dates.start;
}

/** How many dates a task's projection may draw, a daily task across a year. */
export const PROJECTED_REPEATS = 370;
/** How many steps it may take to reach them, an overdue daily task included. */
const PROJECTION_STEPS = 20000;

/**
 * The dates a repeating task falls on after its current one, from `from` to
 * `to`, as local midnights: where its rule will put it if it is kept on
 * schedule. Nothing is written; a projected date is not a task.
 *
 * Only dates after today are drawn. A weekly task left overdue since the
 * first of the month is drawn on its own date and again from today on, on
 * the rule's own sequence, since the weeks between did not happen. A `when
 * done` rule projects nothing: its next date depends on the day it is done,
 * and any date drawn would be a guess. Nor does a rule Deckard cannot read.
 */
export function projectRepeats(
  task: { recurrence?: string; dueAt?: number; scheduledAt?: number; startAt?: number },
  from: number,
  to: number,
  now: number,
): number[] {
  const rule = task.recurrence ? parseRecurrence(task.recurrence) : undefined;
  const reference = recurrenceReference({ due: task.dueAt, scheduled: task.scheduledAt, start: task.startAt });
  if (!rule || rule.whenDone || reference === undefined) {
    return [];
  }
  const today = startOfDay(now);
  const first = Math.max(startOfDay(from), today + 1);
  const dates: number[] = [];
  let at = startOfDay(reference);
  for (let step = 0; step < PROJECTION_STEPS && dates.length < PROJECTED_REPEATS; step += 1) {
    const next = rule.next(at);
    // A rule that does not move forward would never end.
    if (!(next > at) || next > to) {
      break;
    }
    at = next;
    if (at >= first) {
      dates.push(at);
    }
  }
  return dates;
}

/** A repeat rule Deckard can read. */
export interface RecurrenceRule {
  /** "when done" rules count from the day the task is completed. */
  whenDone: boolean;
  /** The first occurrence after `from`, a local midnight. */
  next(from: number): number;
}

/** The nth weekday of a month, as a rule names it. */
const ORDINALS: Readonly<Record<string, number | 'last'>> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  last: 'last',
};

/**
 * Reads the repeat rules Tasks writes, and a few more:
 *
 * - `every day`, `every 3 weeks`, `every month`, `every 2 years`
 * - `every other day`, `every other week`, and so on: the same as `every 2`
 * - `every weekday`, `every Monday`, `every week on Tuesday, Friday`
 * - `every 2 weeks on Monday, Thursday`, `every other Tuesday`
 * - `every month on the 15th`, `every month on the last`
 * - `every month on the second Tuesday`, `every month on the last Friday`
 * - `every quarter`, `every 2 quarters`, and `every weekend`, which are
 *   Deckard's own and not Obsidian Tasks'
 *
 * Any of them can end in `when done`. Anything else returns undefined rather
 * than a guess, so Deckard never writes a wrong next date.
 */
export function parseRecurrence(text: string): RecurrenceRule | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const whenDone = normalized.endsWith(' when done');
  const rule = (whenDone
    ? normalized.slice(0, -' when done'.length)
    : normalized
  ).replace(/^every other /, 'every 2 ');

  for (const read of RULE_READERS) {
    const reading = read(rule);
    if (reading) {
      return reading.next ? { whenDone, next: reading.next } : undefined;
    }
  }
  return undefined;
}

/** How a rule finds the occurrence after a day. */
type NextOccurrence = (from: number) => number;

/**
 * What a reader made of a rule: undefined when the rule is not its shape,
 * so the next reader tries; otherwise its step, which is undefined when the
 * rule is its shape but cannot be kept, such as `every 0 days`, and then no
 * later reader tries.
 */
type RuleReading = { next: NextOccurrence | undefined } | undefined;

/** `every quarter`, `every 2 quarters`: three months a quarter. */
function readQuarters(rule: string): RuleReading {
  const quarters = /^every (?:(\d+) )?quarters?$/.exec(rule);
  if (!quarters) {
    return undefined;
  }
  const count = Number(quarters[1] ?? '1');
  return { next: count < 1 ? undefined : (from) => addMonths(from, 3 * count) };
}

/** `every weekend`: the next Saturday or Sunday. */
function readWeekend(rule: string): RuleReading {
  return rule === 'every weekend'
    ? { next: (from) => nextDayWhere(from, (weekday) => weekday === 0 || weekday === 6) }
    : undefined;
}

/** `every month on the second Tuesday`, `every 2 months on the last Friday`. */
function readNthWeekday(rule: string): RuleReading {
  const nthWeekday = new RegExp(
    `^every (?:(\\d+) )?months? on the (${Object.keys(ORDINALS).join('|')}) (${WEEKDAY_NAMES.join('|')})$`,
  ).exec(rule);
  if (!nthWeekday) {
    return undefined;
  }
  const count = Number(nthWeekday[1] ?? '1');
  const nth = ORDINALS[nthWeekday[2]];
  const weekday = WEEKDAY_NAMES.indexOf(nthWeekday[3]);
  return { next: count < 1 ? undefined : (from) => nextNthWeekday(from, count, weekday, nth) };
}

/**
 * Every N weeks on some days, `every 2 weeks on monday, thursday` or
 * `every 2 tuesday`: the days of this week still to come, then those of the
 * week N weeks on, with weeks starting on Monday as Tasks counts them. A
 * rule of this shape whose words are not weekdays, such as `every 2 weeks`,
 * is left to the readers after it.
 */
function readWeeksOnDays(rule: string): RuleReading {
  const everyWeeks = /^every (\d+) (?:weeks? on )?(.+)$/.exec(rule);
  if (!everyWeeks) {
    return undefined;
  }
  const count = Number(everyWeeks[1]);
  const days = readWeekdays(everyWeeks[2]);
  return days && count >= 1
    ? { next: (from) => nextWeekdayEveryNWeeks(from, days, count) }
    : undefined;
}

/** How each interval unit steps a day on by a count of it. */
const INTERVAL_STEPS: Readonly<Record<string, (from: number, count: number) => number>> = {
  day: (from, count) => addDays(from, count),
  week: (from, count) => addDays(from, 7 * count),
  month: (from, count) => addMonths(from, count),
  year: (from, count) => addMonths(from, 12 * count),
};

/** `every day`, `every 3 weeks`, `every month`, `every 2 years`. */
function readInterval(rule: string): RuleReading {
  const interval = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(rule);
  if (!interval) {
    return undefined;
  }
  const count = Number(interval[1] ?? '1');
  const step = INTERVAL_STEPS[interval[2]];
  return { next: count < 1 ? undefined : (from) => step(from, count) };
}

/** `every weekday`: the next Monday to Friday. */
function readWeekday(rule: string): RuleReading {
  return rule === 'every weekday'
    ? { next: (from) => nextDayWhere(from, (weekday) => weekday >= 1 && weekday <= 5) }
    : undefined;
}

/** `every month on the 15th`, `every 2 months on the last day`; a day past 31 is refused. */
function readMonthDay(rule: string): RuleReading {
  const monthDay =
    /^every (?:(\d+) )?months? on the (last|\d{1,2}(?:st|nd|rd|th)?)(?: day)?$/.exec(
      rule,
    );
  if (!monthDay) {
    return undefined;
  }
  const count = Number(monthDay[1] ?? '1');
  const day = monthDay[2] === 'last' ? 'last' : parseInt(monthDay[2], 10);
  if (count < 1 || (day !== 'last' && (day < 1 || day > 31))) {
    return { next: undefined };
  }
  return { next: (from) => nextMonthDay(from, count, day) };
}

/** `every monday`, `every week on tuesday, friday`: the next of those days. */
function readWeekdayRule(rule: string): RuleReading {
  const weekdays = readWeekdays(/^every (?:week on )?(.+)$/.exec(rule)?.[1]);
  return weekdays
    ? { next: (from) => nextDayWhere(from, (weekday) => weekdays.includes(weekday)) }
    : undefined;
}

/** The rule shapes in the order they are tried. */
const RULE_READERS: readonly ((rule: string) => RuleReading)[] = [
  readQuarters,
  readWeekend,
  readNthWeekday,
  readWeeksOnDays,
  readInterval,
  readWeekday,
  readMonthDay,
  readWeekdayRule,
];

/** Whole-word spellings of a rule, as other apps and people write them. */
const RULE_SYNONYMS: Readonly<Record<string, string>> = {
  daily: 'every day',
  weekly: 'every week',
  monthly: 'every month',
  yearly: 'every year',
  annually: 'every year',
  biweekly: 'every 2 weeks',
  fortnightly: 'every 2 weeks',
  'every fortnight': 'every 2 weeks',
  quarterly: 'every 3 months',
  weekdays: 'every weekday',
  weekends: 'every week on saturday, sunday',
};

/** The words a repeat rule is written in. */
const RULE_WORDS: readonly string[] = [
  'every', 'other', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'quarter', 'quarters', 'weekday', 'weekend', 'on', 'the', 'last',
  'first', 'second', 'third', 'fourth', 'fifth', '1st', '2nd', '3rd', '4th', '5th',
  'when', 'done', ...WEEKDAY_NAMES,
];

/** Edits between two short words, stopping once past `limit`. */
function wordDistance(left: string, right: string, limit: number): number {
  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1;
  }
  let previous = Array.from({ length: right.length + 1 }, (_, at) => at);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** A word outside the rule's vocabulary, as the nearest word inside it. */
function correctRuleWord(word: string): string[] {
  if (/^\d+(?:st|nd|rd|th)?$/.test(word) || RULE_WORDS.includes(word)) {
    return [word];
  }
  const limit = word.length <= 4 ? 1 : 2;
  const scored = RULE_WORDS.map((candidate) => ({ candidate, distance: wordDistance(word, candidate, limit) }))
    .filter((entry) => entry.distance <= limit)
    .sort((left, right) => left.distance - right.distance);
  const best = scored[0]?.distance;
  return scored.filter((entry) => entry.distance === best).map((entry) => entry.candidate);
}

/**
 * The rules Deckard can read that are nearest to one it cannot, best first
 * and at most three: a synonym such as `weekly`, the same rule with `every`
 * in front, or its misspelled words corrected. A `when done` is kept.
 */
export function suggestRecurrence(text: string): string[] {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized || parseRecurrence(normalized)) {
    return [];
  }
  const whenDone = / when done$/.test(normalized);
  const body = whenDone ? normalized.slice(0, -' when done'.length) : normalized;
  const tail = whenDone ? ' when done' : '';
  const candidates: string[] = [];
  const synonym = RULE_SYNONYMS[body];
  if (synonym) {
    candidates.push(synonym);
  }
  const bodies = body.startsWith('every ') || body === 'every' ? [body] : [body, `every ${body}`];
  for (const candidate of bodies) {
    candidates.push(candidate);
    // Each misspelled word, as each of its nearest words.
    let spellings: string[][] = [[]];
    for (const word of candidate.split(/(,? )/)) {
      const options = /^,? $/.test(word) ? [word] : correctRuleWord(word);
      if (options.length === 0) {
        spellings = [];
        break;
      }
      spellings = spellings.flatMap((prefix) => options.map((option) => [...prefix, option])).slice(0, 12);
    }
    candidates.push(...spellings.map((words) => words.join('')));
  }
  const seen = new Set<string>();
  return candidates
    .map((candidate) => `${candidate}${tail}`)
    .filter((candidate) => {
      if (seen.has(candidate) || !parseRecurrence(candidate)) {
        return false;
      }
      seen.add(candidate);
      return true;
    })
    .slice(0, 3);
}

/** Weekday names as a rule lists them, `tuesday, friday`, as day numbers. */
function readWeekdays(list: string | undefined): number[] | undefined {
  const days = list?.split(/, and |, | and |,/).map((name) => WEEKDAY_NAMES.indexOf(name.trim()));
  return days && days.length > 0 && days.every((day) => day >= 0) ? days : undefined;
}

/** The Monday a day's week starts on, as Tasks counts weeks. */
function mondayOf(timestamp: number): number {
  const weekday = new Date(timestamp).getDay();
  return addDays(startOfDay(timestamp), -((weekday + 6) % 7));
}

/**
 * The next of some weekdays, every N weeks: a day later this week comes
 * first, and a day in a later week moves N - 1 more weeks on.
 */
function nextWeekdayEveryNWeeks(from: number, weekdays: readonly number[], weeks: number): number {
  const next = nextDayWhere(from, (weekday) => weekdays.includes(weekday));
  return weeks > 1 && mondayOf(next) !== mondayOf(from) ? addDays(next, 7 * (weeks - 1)) : next;
}

/** The nth weekday of a month, or its last; undefined when it has no fifth. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number | 'last',
): number | undefined {
  if (nth === 'last') {
    const last = new Date(year, month + 1, 0);
    return addDays(last.getTime(), -((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month, 1);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + 7 * (nth - 1);
  const date = new Date(year, month, day);
  return date.getMonth() === ((month % 12) + 12) % 12 ? date.getTime() : undefined;
}

/**
 * The first such weekday after `from`, in its month or every N months on. A
 * month without a fifth one is skipped, as Tasks skips it.
 */
function nextNthWeekday(from: number, months: number, weekday: number, nth: number | 'last'): number {
  const start = new Date(from);
  for (let step = 0; step < 120; step += 1) {
    const month = new Date(start.getFullYear(), start.getMonth() + step * months, 1);
    const candidate = nthWeekdayOfMonth(month.getFullYear(), month.getMonth(), weekday, nth);
    if (candidate !== undefined && candidate > from) {
      return candidate;
    }
  }
  return addMonths(from, months);
}

/** The first day after `from` whose weekday `matches`, looking a week ahead at most. */
function nextDayWhere(
  from: number,
  matches: (weekday: number) => boolean,
): number {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(from, offset);
    if (matches(new Date(candidate).getDay())) {
      return candidate;
    }
  }
  return addDays(from, 7);
}

/**
 * The given day of the month after `from`: this month's when it is still
 * to come, else the one `months` on. A day past a month's end is its last
 * day, so `every month on the 31st` falls on the 30th in a 30-day month.
 */
function nextMonthDay(
  from: number,
  months: number,
  day: number | 'last',
): number {
  const onDay = (year: number, month: number): number => {
    const last = daysInMonth(new Date(year, month, 1));
    return new Date(year, month, day === 'last' ? last : Math.min(day, last)).getTime();
  };
  const date = new Date(from);
  const sameMonth = onDay(date.getFullYear(), date.getMonth());
  return sameMonth > from
    ? sameMonth
    : onDay(date.getFullYear(), date.getMonth() + months);
}
