import { TaskColumnId } from '../model';

/** A column a task table can show, with the names a query may call it by. */
export interface TaskColumn {
  id: TaskColumnId;
  label: string;
  /** Written after `columns=` and shown in a picker; the id when omitted. */
  aliases?: readonly string[];
}

/** Every column a task can have, in the order a picker offers them. */
export const TASK_COLUMNS: readonly TaskColumn[] = [
  { id: 'title', label: 'Task' },
  { id: 'due', label: 'Due' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'start', label: 'Start' },
  { id: 'done', label: 'Done' },
  { id: 'priority', label: 'Priority' },
  { id: 'assignee', label: 'For', aliases: ['for', 'owner'] },
  { id: 'status', label: 'Status' },
  { id: 'tags', label: 'Tags' },
  { id: 'note', label: 'Note', aliases: ['file', 'source'] },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Updated' },
  { id: 'blockedBy', label: 'Blocked by', aliases: ['blocked', 'dependson'] },
  { id: 'id', label: 'Id' },
];

/** Whether a value, read from storage or a message, names a task column. */
export function isTaskColumnId(value: unknown): value is TaskColumnId {
  return typeof value === 'string' && TASK_COLUMNS.some((column) => column.id === value);
}

/**
 * A status a board column stands for, as `deckard.board.statuses` allows
 * one: letters and digits of any script, the marks that accent them, `-`
 * and `_`, starting with a letter or digit, so it can be written as a tag.
 * These are the parser's characters for a part of a tag's name
 * (`TAG_WORD_CHARACTERS`), written out here because a page imports this
 * module and must not bundle the parser.
 */
const STATUS_COLUMN_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*$/u;

/**
 * A namespace as the board takes one, the one it is grouped by: the
 * characters of a status column, starting with a letter.
 */
const BOARD_NAMESPACE = /^\p{L}[\p{L}\p{N}\p{M}_-]*$/u;

/** The most status columns the board's gear may set. */
export const MAX_STATUS_COLUMNS = 50;

/** Whether a value is a status a board column can stand for. */
export function isStatusColumnName(value: unknown): value is string {
  return typeof value === 'string' && STATUS_COLUMN_NAME.test(value);
}

/** Whether a value is a namespace the board can take its columns from. */
export function isBoardNamespace(value: unknown): value is string {
  return typeof value === 'string' && BOARD_NAMESPACE.test(value);
}

/** Whether a value is a list of status columns the gear may set: no more than it keeps, each a status. */
export function isStatusColumnList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_STATUS_COLUMNS && value.every(isStatusColumnName);
}

/** What the gear makes of what was typed: the value to save, or why it cannot be saved. */
export type BoardSettingCheck = { readonly value: string; readonly error?: undefined } | { readonly value?: undefined; readonly error: string };

/**
 * A status typed into the gear to add as a column, read as the gear saves
 * it: trimmed and in lower case, or why it cannot be a column. An empty
 * field is nothing to add, and gives undefined.
 */
export function checkNewStatusColumn(typed: string, columns: readonly string[]): BoardSettingCheck | undefined {
  const name = typed.trim().toLowerCase();
  if (!name) {
    return undefined;
  }
  if (!isStatusColumnName(name)) {
    return { error: 'A status is letters, digits, - and _, starting with a letter or digit.' };
  }
  if (columns.includes(name)) {
    return { error: `${name} is already a column.` };
  }
  return { value: name };
}
