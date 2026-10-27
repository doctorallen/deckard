import { addDays, startOfDay } from '../markdown/calendar';
import { Task } from '../model';
import { QueryContext } from '../query/queryContext';
import { QueryNode } from '../query/queryTypes';
import { isOpenTask } from './taskStatuses';

/**
 * Tasks not started yet: open, with a start date still to come. A snoozed
 * task is one, and `deckard.tasks.hideNotStarted` leaves them out of the
 * lists of what to do until the day they start.
 */

/** Whether a task is open and starts after the day `now` falls on. */
export function isNotStarted(task: Task, now: number): boolean {
  return isOpenTask(task) && task.startAt !== undefined && task.startAt >= addDays(startOfDay(now), 1);
}

/** The tasks less those not started yet on the day `now` falls on. */
export function withoutNotStarted(tasks: readonly Task[], now: number): Task[] {
  return tasks.filter((task) => !isNotStarted(task, now));
}

/**
 * Whether a search names start dates, as `start > today`, `has:start`, and
 * `no:start` do. A list that leaves tasks not started yet out keeps them
 * for a search that asks about them, as a search for `is:parked` keeps
 * parked tasks.
 */
export function mentionsStart(node: QueryNode | undefined): boolean {
  if (!node) {
    return false;
  }
  switch (node.type) {
    case 'condition':
      return node.field === 'start' || (node.field === 'has' && node.value === 'start');
    case 'field':
      return false;
    case 'not':
      return mentionsStart(node.child);
    case 'and':
    case 'or':
      return node.children.some(mentionsStart);
  }
}

/**
 * The tasks less those not started yet, when the context's task policy
 * says to leave them out and the search, `node`, does not name start dates.
 */
export function leaveOutNotStarted(
  tasks: Task[],
  node: QueryNode | undefined,
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
): Task[] {
  return context.taskPolicy.hideNotStarted === true && !mentionsStart(node) ? withoutNotStarted(tasks, context.now) : tasks;
}
