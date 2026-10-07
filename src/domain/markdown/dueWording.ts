import type { DueParts } from '../model/tasks';
import { needsNewDate, TaskPolicy } from '../tasks/taskPolicy';
import { DAY_MS, formatIsoDate, startOfDay } from './calendar';
import { type DateFormats, formatDisplayDate, isDefaultDateFormats } from './dateFormat';

/** How a due date reads beside today, and whether it has passed. */
export interface DueDescription {
  /**
   * `overdue 15 days`, `due today`, `due tomorrow`, or `due in 3 days`;
   * `overdue` or `due` alone once the date is more than a month away.
   */
  relative: string;
  /** The relative phrase with the date beside it, as a row or card writes it, and a message says it. */
  label: string;
  /** The date as the label writes it. */
  date: string;
  /** The label in the parts a page draws it in. */
  parts: DueParts;
  overdue: boolean;
  /**
   * Set once the date is more than `needsNewDateAfterDays` behind today: the
   * label says `was due 2026-07-01`, drawn muted rather than red, and
   * `overdue` is false, since it is no longer today's emergency.
   */
  stale?: boolean;
  /** Days from today to the due date; negative once it has passed. */
  days: number;
}

/** Beyond this many days either way, the distance is left to the date. */
const RELATIVE_DUE_LIMIT_DAYS = 30;

/**
 * Words a due date the way a reader decides on it: how far from today it is,
 * then the date itself for anyone who cites or compares dates. The word
 * "overdue" is in the text, so the state never rests on color alone.
 *
 * Today is the day `now` falls on, and `taskPolicy` says when an overdue date
 * is stale; the date is written as formatDueDate writes it, from the task's
 * `dueText` and the reader's `formats`.
 */
export function describeDueDate(
  dueAt: number,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
  { dueText, formats }: { readonly dueText?: string; readonly formats?: DateFormats } = {},
): DueDescription {
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS);
  const date = formatDueDate(dueAt, dueText, formats);
  if (days < 0 && needsNewDate(dueAt, now, taskPolicy)) {
    const label = `was due ${date}`;
    return { relative: 'was due', label, date, parts: { state: label, distance: '', date: '' }, overdue: false, stale: true, days };
  }
  const overdue = days < 0;
  const { state, distance } = relativeDueWording(days);
  const relative = `${state}${distance}`;
  if (relative === 'due') {
    const label = `due ${date}`;
    return { relative, label, date, parts: { state: label, distance: '', date: '' }, overdue, days };
  }
  return { relative, label: `${relative} · ${date}`, date, parts: { state, distance, date }, overdue, days };
}

/**
 * A task's due date as a reader sees it: in the reader's format once they
 * have set one; else as the task wrote it, which may be words such as
 * `Sep 8`; else `YYYY-MM-DD`.
 */
export function formatDueDate(dueAt: number, dueText: string | undefined, formats: DateFormats | undefined): string {
  if (formats && !isDefaultDateFormats(formats)) {
    return formatDisplayDate(dueAt, formats);
  }
  return dueText ?? formatIsoDate(dueAt);
}

/**
 * How far a due date is from today, in words, as its state and distance:
 * `due today`, `due` ` tomorrow`, `overdue` ` 1 day`, `due` ` in 3 days`,
 * `overdue` ` 15 days`, and beyond RELATIVE_DUE_LIMIT_DAYS either way just
 * `due` or `overdue`.
 */
function relativeDueWording(days: number): Pick<DueParts, 'state' | 'distance'> {
  if (days === 0) {
    return { state: 'due today', distance: '' };
  }
  if (days === 1) {
    return { state: 'due', distance: ' tomorrow' };
  }
  if (days === -1) {
    return { state: 'overdue', distance: ' 1 day' };
  }
  const overdue = days < 0;
  const distance = Math.abs(days);
  if (distance > RELATIVE_DUE_LIMIT_DAYS) {
    return { state: overdue ? 'overdue' : 'due', distance: '' };
  }
  return overdue ? { state: 'overdue', distance: ` ${distance} days` } : { state: 'due', distance: ` in ${days} days` };
}
