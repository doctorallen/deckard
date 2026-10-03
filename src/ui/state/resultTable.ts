import type { InlineToken } from '../../domain/model/inline';
import { QueryContext } from '../../domain/query/queryContext';
import { TASK_COLUMNS, TaskColumn } from '../../domain/tasks/taskColumns';
import { TableSort, TaskColumnId, TaskPriority } from '../../domain/model';
import { TableCell } from '../protocol/taskBoard';
import { describeDueDate } from '../../domain/markdown/dueWording';
import { TASK_PRIORITY_RANKS } from '../../domain/markdown/taskFields';
import { formatIsoDate, startOfDay } from '../../domain/markdown/calendar';

/**
 * A query's results as rows, with the query's own fields as columns.
 *
 * One column model serves every surface that draws a table — a query block
 * in the Markdown preview, the Task Board's table layout — so a column means
 * the same thing, sorts the same way, and is named the same way wherever it
 * is shown. The surfaces differ only in how they draw a cell.
 */

/** The columns a table shows until asked for others. */
export const DEFAULT_TASK_COLUMNS: readonly TaskColumnId[] = [
  'title',
  'due',
  'priority',
  'assignee',
  'note',
];

/** Each column's id and aliases, lowercased, to the column they name. */
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

/** A column's label and alignment; an id no column has falls back to the title column. */
export function getTaskColumn(id: TaskColumnId): TaskColumn {
  return TASK_COLUMNS.find((column) => column.id === id) ?? TASK_COLUMNS[0];
}

/** What a table needs to know about a task, whichever shape it arrived in. */
export interface TableTask {
  title: string;
  /** `title` as inline Markdown tokens, for a table that draws its Markdown. */
  titleTokens?: InlineToken[];
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
 * The cells of one task, in the order of `columns`, its dates read against
 * the context's today and task policy.
 */
export function createTaskCells(
  task: TableTask,
  columns: readonly TaskColumnId[],
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
): TableCell[] {
  const today = startOfDay(context.now);
  const date = (at: number | undefined): TableCell =>
    at === undefined ? { text: '' } : { text: formatIsoDate(at) };
  return columns.map((column): TableCell => {
    switch (column) {
      case 'title':
        return {
          text: task.title,
          ...(task.titleTokens?.length ? { tokens: task.titleTokens } : {}),
        };
      case 'due':
        return dueCell(task, context, today);
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

/**
 * The due cell. An open task's due date reads beside today, muted once it
 * needs a new date and marked overdue once it has passed; a done one keeps
 * its date as written.
 */
function dueCell(
  task: TableTask,
  context: Pick<QueryContext, 'now' | 'taskPolicy'>,
  today: number,
): TableCell {
  if (task.dueAt === undefined) {
    return { text: task.dueText ?? '' };
  }
  if (task.completed) {
    return { text: task.dueText ?? formatIsoDate(task.dueAt) };
  }
  const due = describeDueDate(task.dueAt, context.now, context.taskPolicy, task.dueText);
  if (due.stale) {
    return { text: due.label, kind: 'muted' };
  }
  if (task.dueAt < today) {
    return { text: due.label, kind: 'overdue' };
  }
  return { text: due.label };
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
    return sign * compareKeys(a, b);
  };
}

/** -1, 0, or 1 as `a` sorts before, with, or after `b`. */
function compareKeys(a: number | string, b: number | string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
