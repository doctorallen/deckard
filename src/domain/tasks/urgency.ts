import { addDays, DAY_MS, startOfDay } from '../markdown/calendar';
import { TASK_PRIORITY_RANKS } from '../markdown/taskFields';
import { TaskPriority } from '../model';

/**
 * How urgent an open task is, as one score, loosely after Taskwarrior's
 * urgency: what its due date, scheduled and start dates, priority, and
 * blocked state say, added up, so a list sorted Most urgent puts first
 * what most needs doing now.
 *
 * | What                                   | Points                                  |
 * | -------------------------------------- | --------------------------------------- |
 * | Due                                    | 12 × the due factor below               |
 * | Scheduled for today or earlier         | +5                                      |
 * | A start date still to come             | −3                                      |
 * | Priority                               | highest +6 … lowest −2, none 0          |
 * | Blocked                                | −5                                      |
 *
 * No priority sits between medium and low, as everywhere else Deckard
 * ranks priorities.
 */

/** The points each part of a task is worth. */
export const URGENCY_WEIGHTS = {
  due: 12,
  scheduled: 5,
  notStarted: -3,
  blocked: -5,
  priority: { highest: 6, high: 4, medium: 2, none: 0, low: -1, lowest: -2 },
} as const satisfies { priority: Record<TaskPriority | 'none', number> } & Record<string, unknown>;

/** What a task's urgency is read from. */
export interface UrgencyFacts {
  dueAt?: number;
  scheduledAt?: number;
  startAt?: number;
  priority?: TaskPriority;
  /** Waiting on an open task, or in the Blocked status. */
  blocked: boolean;
}

/**
 * How much a due date weighs on the day `now` falls on, from 0.2 to 1, as
 * Taskwarrior weighs one: 1 at a week or more overdue, falling evenly to
 * 0.2 two weeks ahead, and 0.2 for any date further off. A task with no
 * due date weighs 0.
 */
export function dueFactor(dueAt: number | undefined, now: number): number {
  if (dueAt === undefined) {
    return 0;
  }
  const overdue = Math.round((startOfDay(now) - startOfDay(dueAt)) / DAY_MS);
  if (overdue >= 7) {
    return 1;
  }
  if (overdue >= -14) {
    return ((overdue + 14) * 0.8) / 21 + 0.2;
  }
  return 0.2;
}

/** A task's urgency on the day `now` falls on, to two places. */
export function scoreUrgency(facts: UrgencyFacts, now: number): number {
  const tomorrow = addDays(startOfDay(now), 1);
  const score =
    URGENCY_WEIGHTS.due * dueFactor(facts.dueAt, now) +
    (facts.scheduledAt !== undefined && facts.scheduledAt < tomorrow ? URGENCY_WEIGHTS.scheduled : 0) +
    (facts.startAt !== undefined && facts.startAt >= tomorrow ? URGENCY_WEIGHTS.notStarted : 0) +
    URGENCY_WEIGHTS.priority[facts.priority ?? 'none'] +
    (facts.blocked ? URGENCY_WEIGHTS.blocked : 0);
  return Math.round(score * 100) / 100;
}

/** What urgency orders tasks by: the score, and the due date and priority a tie goes to. */
export interface UrgencyOrder {
  urgency: number;
  dueAt?: number;
  priority?: TaskPriority;
}

/**
 * Orders two tasks most urgent first; a tie goes to the sooner due date,
 * an undated task last, then the higher priority, and 0 when those are
 * the same too, for the caller's own order to decide.
 */
export function compareUrgency(left: UrgencyOrder, right: UrgencyOrder): number {
  return (
    right.urgency - left.urgency ||
    (left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.dueAt ?? Number.MAX_SAFE_INTEGER) ||
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] - TASK_PRIORITY_RANKS[left.priority ?? 'none']
  );
}
