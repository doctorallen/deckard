import type { Task } from '../../domain/model';
import type { TaskPolicy } from '../../domain/tasks/taskPolicy';
import { readTaskStatus, UNKNOWN_STATUS_NAME } from '../../domain/tasks/taskStatuses';
import type { DrawnStatus } from '../protocol/shared';

/**
 * A task's status as a page draws its box: its checkbox's, or the one its
 * status tag stands for, as every view reads it. Undefined for a plain to
 * do and for a done task, whose boxes say all there is.
 */
export function drawTaskStatus(task: Pick<Task, 'status' | 'associationTagGroups' | 'completed'>, policy: Pick<TaskPolicy, 'statuses' | 'statusNamespace'>): DrawnStatus | undefined {
  const status = readTaskStatus(task, policy.statuses, policy.statusNamespace);
  if (task.completed || (status.type === 'todo' && status.name !== UNKNOWN_STATUS_NAME)) {
    return undefined;
  }
  const icon = policy.statuses.find((candidate) => candidate.name === status.name && candidate.type === status.type)?.icon;
  return {
    name: status.name,
    type: status.type,
    ...(icon ? { icon } : {}),
    ...(status.name === UNKNOWN_STATUS_NAME ? { unknown: status.symbol } : {}),
  };
}
