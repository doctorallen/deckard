/**
 * Writing a task's status: the one edit every way of changing a status goes
 * through, from a checkbox to the board, the task editor, bulk edit, and an
 * assistant. A status is written as its character, with its closing date
 * for a done or cancelled one.
 */
import { TaskMetadataFormat } from '../markdown/taskFields';
import { setTaskLineMark } from '../markdown/taskLineEdits';
import type { TaskStatus, TaskStatusType } from '../model';
import { statusForSymbol, type TaskStatusDefinition } from './taskStatuses';

/** A status change, and the dates it adds. */
export interface StatusWrite {
  /** The status to write. */
  to: TaskStatusDefinition;
  /** The done date a change to a done status adds, when the line has none. */
  doneDate?: string;
  /** The cancelled date a change to a cancelled status adds, when the line has none. */
  cancelledDate?: string;
  /** The format of a new date on a line with no metadata yet. */
  preferredFormat?: TaskMetadataFormat;
}

/**
 * Writes a status on a task line, as its character. A done or cancelled
 * status adds its ✅ or ❌ date; an open one takes a closing date away, as
 * reopening a task always has.
 */
export function setTaskStatus(line: string, checkboxColumn: number, write: StatusWrite): string {
  const { to } = write;
  const closed = to.type === 'done' || to.type === 'cancelled' ? to.type : undefined;
  return setTaskLineMark(line, checkboxColumn, {
    symbol: to.symbol,
    closed,
    ...(closed === 'done' && write.doneDate ? { closedDate: write.doneDate } : {}),
    ...(closed === 'cancelled' && write.cancelledDate ? { closedDate: write.cancelledDate } : {}),
    ...(write.preferredFormat ? { preferredFormat: write.preferredFormat } : {}),
  });
}

/** The status a line says it has: its box's, read from the line as it is written. */
export function readLineStatus(
  line: string,
  checkboxColumn: number,
  statuses: readonly TaskStatusDefinition[],
): TaskStatus {
  return statusForSymbol(statuses, line[checkboxColumn] ?? ' ');
}

/**
 * The status a click in the workflow moves a task to: its status's `next`
 * character, when there is a status that has it; undefined when its status
 * names none, or one no status has.
 */
export function nextStatus(
  current: TaskStatus,
  statuses: readonly TaskStatusDefinition[],
): TaskStatusDefinition | undefined {
  const definition = statuses.find(
    (status) =>
      status.name === current.name &&
      status.type === current.type &&
      status.symbol === current.symbol,
  );
  const next = definition?.next;
  return next === undefined ? undefined : statuses.find((status) => status.symbol === next);
}

/** The first status of the list of a type, the status an open task is reopened as when it has to be one. */
export function firstStatusOf(statuses: readonly TaskStatusDefinition[], type: TaskStatusType): TaskStatusDefinition | undefined {
  return statuses.find((status) => status.type === type);
}
