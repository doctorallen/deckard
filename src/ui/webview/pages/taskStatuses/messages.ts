/**
 * Edit Task Statuses' narrowing table: a list of statuses to save, each as
 * the setting writes one; what a click on a box does; and the import.
 */
import { isTaskStatusType, TASK_STATUS_ICONS } from '../../../../domain/tasks/taskStatuses';
import type { EditedStatus, SaveTaskStatusesMessage, SetCheckboxClickMessage, TaskStatusesPageToHost } from '../../../protocol/taskStatuses';
import { NarrowingTable, Narrower, narrowWith, onlyType } from '../../host/narrowing';

/** The most statuses a list may hold, far more than any vault writes. */
const MAX_STATUSES = 100;
/** The longest a name or a tag may be. */
const MAX_TEXT = 80;

/** A short string, or undefined for anything else. */
function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= MAX_TEXT ? value : undefined;
}

/** One status as the page sends it, or undefined when any of its fields is not one the setting takes. */
function readStatus(value: unknown): EditedStatus | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  const name = readText(entry.name);
  if (name === undefined || !isTaskStatusType(entry.type)) {
    return undefined;
  }
  const symbol = readText(entry.symbol);
  const tag = readText(entry.tag);
  const next = readText(entry.next);
  const icon = TASK_STATUS_ICONS.find((known) => known === entry.icon);
  return {
    name,
    type: entry.type,
    ...(symbol ? { symbol } : {}),
    ...(tag ? { tag } : {}),
    ...(next ? { next } : {}),
    ...(icon ? { icon } : {}),
  };
}

/** A list to save: each status as the setting takes one, and no more of them than a list holds. */
const narrowSaveTaskStatuses: Narrower<SaveTaskStatusesMessage> = (value) => {
  if (!Array.isArray(value.statuses) || value.statuses.length > MAX_STATUSES) {
    return undefined;
  }
  const statuses = value.statuses.map(readStatus);
  return statuses.every((status): status is EditedStatus => status !== undefined)
    ? { type: 'saveTaskStatuses', statuses }
    : undefined;
};

/** What a click on a box does: one of the setting's two values. */
const narrowSetCheckboxClick: Narrower<SetCheckboxClickMessage> = (value) =>
  value.value === 'done' || value.value === 'workflow' ? { type: 'setCheckboxClick', value: value.value } : undefined;

/** Each message Edit Task Statuses may send, and what it must hold. */
export const TASK_STATUSES_MESSAGES: NarrowingTable<TaskStatusesPageToHost> = {
  saveTaskStatuses: narrowSaveTaskStatuses,
  setCheckboxClick: narrowSetCheckboxClick,
  importTaskStatuses: onlyType('importTaskStatuses'),
};

/** A message from the page, narrowed by its table, or undefined. */
export const narrowTaskStatusesMessage = narrowWith(TASK_STATUSES_MESSAGES);
