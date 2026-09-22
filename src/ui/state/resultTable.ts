import {
  formatIsoDate,
  startOfDay,
  TASK_PRIORITY_RANKS,
} from '../../core/markdown/taskMetadata';
import { TaskPriority } from '../../core/types';

/**
 * A query's results as rows, with the query's own fields as columns.
 *
 * One column model serves every surface that draws a table — a query block
 * in the Markdown preview, the Task Board's table layout — so a column means
 * the same thing, sorts the same way, and is named the same way wherever it
 * is shown. The surfaces differ only in how they draw a cell.
 */

export type TaskColumnId =
  | 'title'
  | 'due'
  | 'scheduled'
  | 'start'
  | 'done'
  | 'priority'
  | 'assignee'
  | 'status'
  | 'tags'
  | 'note'
  | 'created'
  | 'updated'
  | 'blockedBy'
  | 'id';

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

/** The columns a table shows until asked for others. */
export const DEFAULT_TASK_COLUMNS: readonly TaskColumnId[] = [
  'title',
  'due',
  'priority',
  'assignee',
  'note',
];

const COLUMN_BY_NAME = new Map<string, TaskColumnId>(
  TASK_COLUMNS.flatMap((column) =>
    [column.id, ...(column.aliases ?? [])].map(
      (name): [string, TaskColumnId] => [name.toLowerCase(), column.id],
    ),
  ),
);

/**
 * Reads a `columns=` value: names separated by commas, in the order given.
 * The title is always first, whether or not it was named, since a row
 * without one is not a row. Names that are not columns are returned so the
 * caller can say so without dropping the rest.
 */
export function parseTaskColumns(text: string): {
  columns: TaskColumnId[];
  unknown: string[];
} {
  const columns: TaskColumnId[] = ['title'];
  const unknown: string[] = [];
  for (const name of text.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean)) {
    const column = COLUMN_BY_NAME.get(name.toLowerCase());
    if (!column) {
      unknown.push(name);
    } else if (!columns.includes(column)) {
      columns.push(column);
    }
  }
  return { columns, unknown };
}

export function isTaskColumnId(value: unknown): value is TaskColumnId {
  return typeof value === 'string' && TASK_COLUMNS.some((column) => column.id === value);
}

export function getTaskColumn(id: TaskColumnId): TaskColumn {
  return TASK_COLUMNS.find((column) => column.id === id) ?? TASK_COLUMNS[0];
}

/** What a table needs to know about a task, whichever shape it arrived in. */
export interface TableTask {
  title: string;
  completed: boolean;
  dueAt?: number;
  dueText?: string;
  scheduledAt?: number;
  startAt?: number;
  doneAt?: number;
  priority?: TaskPriority;
  /** The person's tag as written, such as `@dana`. */
  assignee?: string;
  /** The `#status/…` name, without the namespace. */
  status?: string;
  /** Tag labels, as written. */
  tags?: readonly string[];
  fileName: string;
  /** One-based source line. */
  line: number;
  createdAt?: number;
  updatedAt?: number;
  dependsOn?: readonly string[];
  dependencyId?: string;
}

/**
 * One cell: its text, and what it is, so a surface can colour an overdue
 * date or strike a finished title without knowing which column it drew.
 */
export interface TableCell {
  text: string;
  kind?: 'overdue' | 'muted';
}

/** The cells of one task, in the order of `columns`. */
export function createTaskCells(
  task: TableTask,
  columns: readonly TaskColumnId[],
  now: number,
): TableCell[] {
  const today = startOfDay(now);
  const date = (at: number | undefined): TableCell =>
    at === undefined ? { text: '' } : { text: formatIsoDate(at) };
  return columns.map((column): TableCell => {
    switch (column) {
      case 'title':
        return { text: task.title };
      case 'due':
        return task.dueAt === undefined
          ? { text: task.dueText ?? '' }
          : {
              text: task.dueText ?? formatIsoDate(task.dueAt),
              ...(!task.completed && task.dueAt < today ? { kind: 'overdue' } : {}),
            };
      case 'scheduled':
        return date(task.scheduledAt);
      case 'start':
        return date(task.startAt);
      case 'done':
        return date(task.doneAt);
      case 'priority':
        return { text: task.priority ?? '' };
      case 'assignee':
        return { text: task.assignee ?? '' };
      case 'status':
        return { text: task.status ?? '' };
      case 'tags':
        return { text: (task.tags ?? []).join(' '), kind: 'muted' };
      case 'note':
        return { text: `${task.fileName}:${task.line}`, kind: 'muted' };
      case 'created':
        return { ...date(task.createdAt), kind: 'muted' };
      case 'updated':
        return { ...date(task.updatedAt), kind: 'muted' };
      case 'blockedBy':
        return { text: (task.dependsOn ?? []).join(', ') };
      case 'id':
        return { text: task.dependencyId ?? '', kind: 'muted' };
      default:
        return { text: '' };
    }
  });
}

export type TableSortDirection = 'asc' | 'desc';

export interface TableSort {
  column: TaskColumnId;
  direction: TableSortDirection;
}

/**
 * Orders tasks by one column. A task with nothing in the column sorts last
 * either way, since "no due date" is not earlier than every date. Ties keep
 * the order they came in, which is the surface's own — rank, or source.
 */
export function compareTasksByColumn(
  sort: TableSort,
): (left: TableTask, right: TableTask) => number {
  const sign = sort.direction === 'desc' ? -1 : 1;
  const key = (task: TableTask): number | string | undefined => {
    switch (sort.column) {
      case 'title':
        return task.title.toLocaleLowerCase();
      case 'due':
        return task.dueAt;
      case 'scheduled':
        return task.scheduledAt;
      case 'start':
        return task.startAt;
      case 'done':
        return task.doneAt;
      case 'priority':
        // Highest first when ascending, the way a reader reads a priority.
        return task.priority ? -TASK_PRIORITY_RANKS[task.priority] : undefined;
      case 'assignee':
        return task.assignee?.toLocaleLowerCase();
      case 'status':
        return task.status;
      case 'tags':
        return task.tags?.length ? task.tags.join(' ') : undefined;
      case 'note':
        return `${task.fileName}:${String(task.line).padStart(6, '0')}`;
      case 'created':
        return task.createdAt;
      case 'updated':
        return task.updatedAt;
      case 'blockedBy':
        return task.dependsOn?.length ? task.dependsOn.join(', ') : undefined;
      case 'id':
        return task.dependencyId;
      default:
        return undefined;
    }
  };
  return (left, right) => {
    const a = key(left);
    const b = key(right);
    if (a === undefined || a === '') {
      return b === undefined || b === '' ? 0 : 1;
    }
    if (b === undefined || b === '') {
      return -1;
    }
    return sign * (a < b ? -1 : a > b ? 1 : 0);
  };
}
