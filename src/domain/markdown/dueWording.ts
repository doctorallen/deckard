import { needsNewDate, TaskPolicy } from '../tasks/taskPolicy';
import { DAY_MS, formatIsoDate, startOfDay } from './calendar';

/** How a due date reads beside today, and whether it has passed. */
export interface DueDescription {
  /**
   * `overdue 15 days`, `due today`, `due tomorrow`, or `due in 3 days`;
   * `overdue` or `due` alone once the date is more than a month away.
   */
  relative: string;
  /** The relative phrase with the date beside it, as a row or card writes it. */
  label: string;
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
 * is stale: the wording depends on nothing else.
 */
export function describeDueDate(
  dueAt: number,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
  dueText?: string,
): DueDescription {
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS);
  const date = dueText ?? formatIsoDate(dueAt);
  if (days < 0 && needsNewDate(dueAt, now, taskPolicy)) {
    return { relative: 'was due', label: `was due ${date}`, overdue: false, stale: true, days };
  }
  const overdue = days < 0;
  const relative = relativeDueWording(days);
  const label = relative === 'due' ? `due ${date}` : `${relative} · ${date}`;
  return { relative, label, overdue, days };
}

/**
 * How far a due date is from today, in words: `due today`, `due tomorrow`,
 * `overdue 1 day`, `due in 3 days`, `overdue 15 days`, and beyond
 * RELATIVE_DUE_LIMIT_DAYS either way just `due` or `overdue`.
 */
function relativeDueWording(days: number): string {
  if (days === 0) {
    return 'due today';
  }
  if (days === 1) {
    return 'due tomorrow';
  }
  if (days === -1) {
    return 'overdue 1 day';
  }
  const overdue = days < 0;
  const distance = Math.abs(days);
  if (distance > RELATIVE_DUE_LIMIT_DAYS) {
    return overdue ? 'overdue' : 'due';
  }
  return overdue ? `overdue ${distance} days` : `due in ${days} days`;
}
