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
 * A namespace as the board takes one, the one it is grouped by: letters
 * and digits of any script, the marks that accent them, `-` and `_`,
 * starting with a letter. These are the parser's characters for a part of
 * a tag's name (`TAG_WORD_CHARACTERS`), written out here because a page
 * imports this module and must not bundle the parser.
 */
const BOARD_NAMESPACE = /^\p{L}[\p{L}\p{N}\p{M}_-]*$/u;

/** Whether a value is a namespace the board can take its columns from. */
export function isBoardNamespace(value: unknown): value is string {
  return typeof value === 'string' && BOARD_NAMESPACE.test(value);
}
