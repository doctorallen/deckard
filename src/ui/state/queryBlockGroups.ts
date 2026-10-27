import { getFileName } from '../../shared/paths';
import { QueryContext } from '../../domain/query/queryContext';
import { readTaskTagKeys } from '../../domain/query/queryEvaluator';
import { getDueBand } from '../../domain/tasks/boardMoves';
import { findClosedStatus, listUnknownColumns, orderOpenStatuses, readTaskColumnKey } from '../../domain/tasks/statusColumns';
import { isBoardNamespace } from '../../domain/tasks/taskColumns';
import { isCancelledTask, isOpenTask, UNKNOWN_STATUS_NAME } from '../../domain/tasks/taskStatuses';
import { Task, TaskBoardGroupBy, TaskPriority, WorkspaceIndex } from '../../domain/model';
import { formatNamespaceValue, labelValue, noValueLabel, readNamespaceValues } from './tagGrouping';

/**
 * A query block's tasks under headings, as `group=` asks: by when they are
 * due, scheduled, or start, by priority, status, note, tag, a namespace's
 * tags, or who they are for. The groups are the Task board's columns and
 * the Tasks view's labels, in their order, so a block grouped by due date
 * reads as the board grouped by due date does.
 */

/** What a block groups its tasks by: a field, or a namespace such as `#context`. */
export type QueryBlockGroupBy =
  | 'due'
  | 'scheduled'
  | 'start'
  | 'priority'
  | 'status'
  | 'note'
  | 'tag'
  | 'assignee'
  | `#${string}`;

/** The names `group=` takes, lowercased, and the grouping each one is. */
const GROUP_NAMES: ReadonlyMap<string, QueryBlockGroupBy> = new Map<string, QueryBlockGroupBy>([
  ['due', 'due'],
  ['scheduled', 'scheduled'],
  ['start', 'start'],
  ['priority', 'priority'],
  ['status', 'status'],
  ['note', 'note'],
  ['file', 'note'],
  ['tag', 'tag'],
  ['tags', 'tag'],
  ['for', 'assignee'],
  ['assignee', 'assignee'],
  ['owner', 'assignee'],
]);

/** A `group=` value as a grouping, or undefined for one it is not. */
export function readQueryBlockGroup(value: string): QueryBlockGroupBy | undefined {
  const name = value.trim().toLowerCase();
  if (name.startsWith('#')) {
    const namespace = name.slice(1);
    return isBoardNamespace(namespace) ? `#${namespace}` : undefined;
  }
  return GROUP_NAMES.get(name);
}

/** A grouping as `group=` writes it: `for` for who a task is for. */
export function writeQueryBlockGroup(group: QueryBlockGroupBy): string {
  return group === 'assignee' ? 'for' : group;
}

/**
 * The Task board's grouping as `group=` writes it, so a board copied as a
 * live query block lists under the columns it showed: a tag grouping is
 * its namespace, and one without a namespace the board can group by lays
 * out by status, as the board does.
 */
export function queryBlockGroupOfBoard(groupBy: TaskBoardGroupBy, namespace: string | undefined): QueryBlockGroupBy {
  if (groupBy === 'tag') {
    return namespace && isBoardNamespace(namespace) ? `#${namespace.toLowerCase()}` : 'status';
  }
  return groupBy;
}

/** One group of a block's tasks: its key, its heading, and its tasks in the block's order. */
export interface QueryBlockGroup<T> {
  id: string;
  label: string;
  items: T[];
}

/** A group being filled: its heading, and where it sorts among the others. */
interface Bucket<T> {
  label: string;
  order: number | string;
  items: T[];
}

/** What a task is grouped by besides itself: the index it is in and the moment it is read at. */
export interface GroupReading {
  index: WorkspaceIndex;
  context: Pick<QueryContext, 'now' | 'taskPolicy'>;
}

/**
 * The tasks under their groups, each group in the order the tasks came,
 * the groups in the grouping's order, empty ones left out. `taskOf` reads
 * the task an item stands for. A task with two tags, grouped by tag, is in
 * both groups.
 */
export function groupBlockTasks<T>(
  items: readonly T[],
  taskOf: (item: T) => Task | undefined,
  group: QueryBlockGroupBy,
  reading: GroupReading,
): QueryBlockGroup<T>[] {
  const keysOf = groupKeyReader(group, reading, items.flatMap((item) => taskOf(item) ?? []));
  const buckets = new Map<string, Bucket<T>>();
  items.forEach((item) => {
    const task = taskOf(item);
    if (!task) {
      return;
    }
    keysOf(task).forEach(({ id, label, order }) => {
      const bucket = buckets.get(id) ?? { label, order, items: [] };
      bucket.items.push(item);
      buckets.set(id, bucket);
    });
  });
  return [...buckets.entries()]
    .sort(([, left], [, right]) => compareOrder(left.order, right.order))
    .map(([id, bucket]) => ({ id, label: bucket.label, items: bucket.items }));
}

/** Numbers first, in their order, then words alphabetically; a group that sorts last says so with Infinity. */
function compareOrder(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'number') {
    return left === Number.POSITIVE_INFINITY ? 1 : -1;
  }
  if (typeof right === 'number') {
    return right === Number.POSITIVE_INFINITY ? -1 : 1;
  }
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

/** The groups one task is in, each with its key, heading, and place. */
type GroupKey = { id: string; label: string; order: number | string };

/** Reads which groups a task is in, for one grouping. */
function groupKeyReader(group: QueryBlockGroupBy, reading: GroupReading, tasks: readonly Task[]): (task: Task) => GroupKey[] {
  switch (group) {
    case 'due':
    case 'scheduled':
    case 'start':
      return (task) => [dateKey(task, group, reading)];
    case 'priority':
      return (task) => [priorityKey(task)];
    case 'status':
      return statusKeyReader(reading, tasks);
    case 'note':
      return (task) => [{ id: `note:${task.filePath}`, label: getFileName(task.filePath).replace(/\.md$/i, ''), order: task.filePath }];
    case 'tag':
      return (task) => tagKeys(task, reading.index);
    case 'assignee':
      return (task) => [assigneeKey(task, reading.index)];
    default:
      return (task) => namespaceKeys(task, group.slice(1), reading.index);
  }
}

/** The day bands of the board's Due date grouping, in its order, and each date's heading for them. */
const DATE_BANDS: ReadonlyArray<{ band: string; due: string; scheduled: string; start: string }> = [
  { band: 'needsdate', due: 'Needs a new date', scheduled: 'Earlier', start: 'Started' },
  { band: 'overdue', due: 'Overdue', scheduled: 'Earlier', start: 'Started' },
  { band: 'today', due: 'Today', scheduled: 'Today', start: 'Today' },
  { band: 'tomorrow', due: 'Tomorrow', scheduled: 'Tomorrow', start: 'Tomorrow' },
  { band: 'week', due: 'Within a week', scheduled: 'Within a week', start: 'Within a week' },
  { band: 'later', due: 'Later', scheduled: 'Later', start: 'Later' },
  { band: '', due: 'No due date', scheduled: 'No scheduled date', start: 'No start date' },
];

/**
 * The day band a task's date puts it in, as the board's due columns band a
 * due date; a scheduled or start date never needs a new date, so its past
 * days are one band. A closed task is under Done or Cancelled, last, since
 * its date no longer says when it is wanted.
 */
function dateKey(task: Task, field: 'due' | 'scheduled' | 'start', { context }: GroupReading): GroupKey {
  if (!isOpenTask(task)) {
    const cancelled = isCancelledTask(task);
    return cancelled
      ? { id: 'cancelled', label: findClosedStatus(context.taskPolicy.statuses, 'cancelled')?.name ?? 'Cancelled', order: DATE_BANDS.length + 1 }
      : { id: 'done', label: 'Done', order: DATE_BANDS.length };
  }
  const at = { due: task.dueAt, scheduled: task.scheduledAt, start: task.startAt }[field];
  const policy = field === 'due' ? context.taskPolicy : { ...context.taskPolicy, needsNewDateAfterDays: 0 };
  const band = getDueBand(at, { now: context.now, taskPolicy: policy });
  const order = DATE_BANDS.findIndex((entry) => entry.band === band);
  const label = DATE_BANDS[order][field];
  return { id: `${field}:${band}`, label, order };
}

/** The priorities from highest to lowest, then none, as the Tasks view orders them. */
const PRIORITIES: ReadonlyArray<[TaskPriority | '', string]> = [
  ['highest', 'Highest'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
  ['lowest', 'Lowest'],
  ['', 'No priority'],
];

/** A task's priority group. */
function priorityKey(task: Task): GroupKey {
  const order = PRIORITIES.findIndex(([priority]) => priority === (task.priority ?? ''));
  return { id: `priority:${PRIORITIES[order][0] || 'none'}`, label: PRIORITIES[order][1], order };
}

/**
 * Status groups in the order `deckard.tasks.statuses` lists the open ones,
 * a group per character no status names after them, then Done and
 * Cancelled, as the board's status columns run.
 */
function statusKeyReader({ context }: GroupReading, tasks: readonly Task[]): (task: Task) => GroupKey[] {
  const statuses = context.taskPolicy.statuses;
  const open = tasks.filter(isOpenTask);
  const entries = [...orderOpenStatuses(statuses, { hidden: [] }), ...listUnknownColumns(open, statuses)];
  const places = new Map(entries.map((entry, at) => [entry.key, { at, name: entry.name, symbol: entry.symbol }]));
  return (task) => {
    if (task.completed) {
      return [{ id: 'status:done', label: findClosedStatus(statuses, 'done')?.name ?? 'Done', order: entries.length }];
    }
    if (isCancelledTask(task)) {
      return [{ id: 'status:cancelled', label: findClosedStatus(statuses, 'cancelled')?.name ?? 'Cancelled', order: entries.length + 1 }];
    }
    const key = readTaskColumnKey(task, statuses);
    const place = places.get(key);
    if (!place) {
      return [{ id: `status:${key}`, label: task.status.name, order: entries.length - 0.5 }];
    }
    // A character no status names says which, as its board column does.
    const label = place.name === UNKNOWN_STATUS_NAME ? `${place.name} [${place.symbol}]` : place.name;
    return [{ id: `status:${key}`, label, order: place.at }];
  };
}

/**
 * Each `#` tag a task is found by, its own and those it inherits, as a
 * `tag:` search finds it, by name; No tag, last, for a task with none. A
 * person is who a task is for, which `group=for` groups by.
 */
function tagKeys(task: Task, index: WorkspaceIndex): GroupKey[] {
  const keys = [...readTaskTagKeys(index, task)].filter((key) => key.startsWith('#'));
  if (keys.length === 0) {
    return [{ id: 'tag:', label: 'No tag', order: Number.POSITIVE_INFINITY }];
  }
  return keys.map((key) => {
    const label = task.tagLabels[key] ?? index.tags.get(key)?.label ?? key;
    return { id: `tag:${key}`, label, order: label };
  });
}

/**
 * Each tag of a namespace a task has, its name as the board's Tag… column
 * heads it, alphabetically; the namespace's No project, last, for a task
 * with none.
 */
function namespaceKeys(task: Task, namespace: string, index: WorkspaceIndex): GroupKey[] {
  const values = readNamespaceValues(index, task, namespace);
  if (values.length === 0) {
    return [{ id: `tag:${namespace}/`, label: noValueLabel(namespace), order: Number.POSITIVE_INFINITY }];
  }
  return values.map((value) => {
    const label = formatNamespaceValue(labelValue(index.tags.get(value.key)?.label ?? value.label));
    return { id: `tag:${value.key}`, label, order: label };
  });
}

/** Who a task is for, by name, with Nobody named last. */
function assigneeKey(task: Task, index: WorkspaceIndex): GroupKey {
  if (!task.assignee) {
    return { id: 'assignee:', label: 'Nobody named', order: Number.POSITIVE_INFINITY };
  }
  const label = index.tags.get(task.assignee)?.label ?? task.assignee;
  return { id: `assignee:${task.assignee}`, label, order: label };
}
