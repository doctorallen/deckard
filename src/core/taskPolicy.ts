import { Task } from './types';

/**
 * How Deckard reads tasks, from settings, set once for the whole host.
 *
 * The agenda, the due wording, the query evaluator, the board, and the
 * calendar all need to know when an overdue task has waited long enough to
 * need a new date, and which status a task's line carries. Rather than pass
 * a setting through every pure function that builds a view, the extension
 * sets it here when it starts and when the setting changes, as it sets who
 * `is:mine` means. The defaults are the settings' defaults, so tests and a
 * fresh install read tasks the same way.
 */
export interface TaskPolicy {
  /** Days past its due date an open task stays Overdue. 0 keeps it there. */
  needsNewDateAfterDays: number;
  /** The namespace a task's status is written in: `status` for `#status/doing`. */
  statusNamespace: string;
  /** Statuses that put a task on hold, which `is:available` leaves out. */
  onHoldStatuses: readonly string[];
}

export const DEFAULT_TASK_POLICY: Readonly<TaskPolicy> = {
  needsNewDateAfterDays: 30,
  statusNamespace: 'status',
  onHoldStatuses: ['waiting', 'someday'],
};

let policy: TaskPolicy = { ...DEFAULT_TASK_POLICY };

/** Sets the policy; anything left out takes its default. */
export function setTaskPolicy(next: Partial<TaskPolicy> = {}): void {
  policy = { ...DEFAULT_TASK_POLICY, ...next };
}

export function getTaskPolicy(): Readonly<TaskPolicy> {
  return policy;
}

/**
 * True for a due date more than the policy's `needsNewDateAfterDays` behind
 * the day `now` falls on: a task exactly 30 days overdue is still Overdue,
 * and at 31 it needs a new date. Never true when the policy's days are 0.
 */
export function needsNewDate(
  dueAt: number | undefined,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'> = policy,
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
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'> = policy,
): number | undefined {
  const days = taskPolicy.needsNewDateAfterDays;
  return days > 0 ? daysBefore(now, days) : undefined;
}

/**
 * The status written on a task's own line, in `namespace` (the policy's
 * `statusNamespace`, as the caller passes it), or ''.
 */
export function readLineStatus(
  task: Pick<Task, 'associationTagGroups'>,
  namespace: string = policy.statusNamespace,
): string {
  const prefix = `#${namespace.toLowerCase()}/`;
  return (
    (task.associationTagGroups?.[0] ?? [])
      .map((tag) => tag.key.toLowerCase())
      .find((key) => key.startsWith(prefix))
      ?.slice(prefix.length) ?? ''
  );
}

/** Midnight a number of calendar days before the day `now` falls on. */
function daysBefore(now: number, days: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - days).getTime();
}
