import { Task } from '../model';
import { isBoardNamespace } from './taskColumns';

/**
 * How Deckard reads tasks, from settings.
 *
 * The agenda, the due wording, the query evaluator, the board, and the
 * calendar all need to know when an overdue task has waited long enough to
 * need a new date, and which status a task's line carries. The UI reads the
 * policy from settings where its work begins and passes it down, inside a
 * QueryContext or on its own, so nothing here holds a value between calls.
 */
export interface TaskPolicy {
  /** Days past its due date an open task stays Overdue. 0 keeps it there. */
  needsNewDateAfterDays: number;
  /** The namespace a task's status is written in: `status` for `#status/doing`. */
  statusNamespace: string;
  /** Statuses that put a task on hold, which `is:available` leaves out. */
  onHoldStatuses: readonly string[];
}

/**
 * The settings' defaults, so a fresh install and a test that states nothing
 * read tasks the same way.
 */
export const DEFAULT_TASK_POLICY: Readonly<TaskPolicy> = {
  needsNewDateAfterDays: 30,
  statusNamespace: 'status',
  onHoldStatuses: ['waiting', 'someday'],
};

/**
 * The namespace a task's status is written in, from
 * `deckard.board.statusNamespace`. Every view reads it here, so a status is
 * read and written the same way from each: the Task Board used to lowercase
 * it and check it against the setting's pattern while the Tasks view, the
 * preview, Related Notes, and the task policy only trimmed it, so
 * `Status` was written `#status/doing` from the board and `#Status/doing`
 * from the Tasks view. Tags are matched by lowercased key everywhere, so it
 * is lowercased. A value that is not a string, or does not fit the
 * setting's pattern once trimmed, reads as `status`.
 */
export function readStatusNamespace(settings: { get<T>(key: string, defaultValue: T): T }): string {
  const value = settings.get<unknown>('board.statusNamespace', DEFAULT_TASK_POLICY.statusNamespace);
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return isBoardNamespace(trimmed) ? trimmed.toLowerCase() : DEFAULT_TASK_POLICY.statusNamespace;
}

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

/**
 * The status written on a task's own line, in `namespace` (the policy's
 * `statusNamespace`, as the caller passes it), or ''.
 */
export function readLineStatus(
  task: Pick<Task, 'associationTagGroups'>,
  namespace: string,
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
