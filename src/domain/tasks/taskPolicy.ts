import { DEFAULT_TASK_STATUSES, type TaskStatusDefinition } from './taskStatuses';

/**
 * How Deckard reads tasks, from settings.
 *
 * The agenda, the due wording, the query evaluator, the board, and the
 * calendar all need to know when an overdue task has waited long enough to
 * need a new date, and what each checkbox character means. The UI reads the
 * policy from settings where its work begins and passes it down, inside a
 * QueryContext or on its own, so nothing here holds a value between calls.
 */
export interface TaskPolicy {
  /** Days past its due date an open task stays Overdue. 0 keeps it there. */
  needsNewDateAfterDays: number;
  /** What each checkbox character means (`deckard.tasks.statuses`). */
  statuses: readonly TaskStatusDefinition[];
}

/**
 * The settings' defaults, so a fresh install and a test that states nothing
 * read tasks the same way.
 */
export const DEFAULT_TASK_POLICY: Readonly<TaskPolicy> = {
  needsNewDateAfterDays: 30,
  statuses: DEFAULT_TASK_STATUSES,
};

/**
 * True for a due date more than the policy's `needsNewDateAfterDays` behind
 * the day `now` falls on: a task exactly 30 days overdue is still Overdue,
 * and at 31 it needs a new date. Never true when the policy's days are 0.
 */
export function needsNewDate(
  dueAt: number | undefined,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
): boolean {
  const days = taskPolicy.needsNewDateAfterDays;
  return (
    dueAt !== undefined &&
    days > 0 &&
    dueAt < daysBefore(now, days)
  );
}

/**
 * The first day that is not yet past the policy's line, counted back from
 * the day `now` falls on, as a timestamp, or undefined when the line is off.
 */
export function needsNewDateBefore(
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
): number | undefined {
  const days = taskPolicy.needsNewDateAfterDays;
  return days > 0 ? daysBefore(now, days) : undefined;
}

/** Midnight a number of calendar days before the day `now` falls on. */
function daysBefore(now: number, days: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days).getTime();
}
