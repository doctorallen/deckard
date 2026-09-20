import {
  addDays,
  appendToTaskText,
  formatIsoDate,
  parseTaskMetadata,
  setTaskDate,
  setTaskLineCompletion,
  setTaskPriority,
  startOfDay,
  TASK_PRIORITY_RANKS,
  TaskMetadataFormat,
} from '../../core/markdown/taskMetadata';
import { evaluateQuery } from '../../core/query/queryEvaluator';
import { parseQuery } from '../../core/query/queryParser';
import {
  PersistedPreferences,
  TagTitleDisplayMode,
  Task,
  TaskBoardCard,
  TaskBoardColumn,
  TaskBoardGroupBy,
  TaskBoardLayout,
  TaskBoardSnapshot,
  TaskPriority,
  WorkspaceIndex,
} from '../../core/types';
import { renderMarkdownInline } from '../webview/rendering';
import {
  createDashboardTask,
  createQueryViewState,
  matchesTaskFilter,
  sortTasks,
} from './dashboardState';
import { stripTrailingTags } from './queryBlockState';
import { buildSearchFacets } from './searchFacets';

/**
 * The task board lays tasks out as a Kanban board. Its columns come from what
 * a task already says about itself, so moving a card is an ordinary edit to
 * the task line:
 *
 * - **Status**: a tag in the status namespace written on the task line, such
 *   as `#status/doing`.
 * - **Priority**: the task's Obsidian Tasks priority.
 * - **Due date**: bands from Overdue to Later.
 *
 * Every grouping ends with Done, which holds completed tasks.
 */

export interface TaskBoardOptions {
  now: number;
  /** Namespace that holds a task's status, `status` for `#status/doing`. */
  statusNamespace: string;
  /** Status columns in order. Other statuses found on tasks follow them. */
  statuses: readonly string[];
  /** Format for metadata written on a task that has none yet. */
  format: TaskMetadataFormat;
  /** Most completed tasks shown in Done. */
  doneLimit?: number;
}

/** What dropping a task on a column means for its line. */
export type TaskMove =
  | { kind: 'unchanged' }
  | { kind: 'complete' }
  | { kind: 'edit'; edit: (line: string) => string; label: string }
  | { kind: 'refused'; reason: string };

interface ColumnDraft {
  id: string;
  label: string;
  droppable: boolean;
  tasks: Task[];
}

const STATUS_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PRIORITIES: ReadonlySet<string> = new Set([
  'highest',
  'high',
  'medium',
  'low',
  'lowest',
]);
const PRIORITY_COLUMNS: ReadonlyArray<[TaskPriority | '', string]> = [
  ['highest', 'Highest'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['', 'No priority'],
  ['low', 'Low'],
  ['lowest', 'Lowest'],
];
const DEFAULT_DONE_LIMIT = 20;

/**
 * True for a status that can be written as the value of a tag.
 */
export function isValidStatusName(value: string): boolean {
  return STATUS_NAME.test(value);
}

/** The Task Board's search: the one applied, and one typed that could not be. */
export interface TaskBoardSearch {
  query: string;
  /** Shown in the box with its error; the board keeps the applied search. */
  invalidQuery?: string;
}

/**
 * Builds the Task Board page: the tasks its search finds, as columns or as a
 * list, with the same search box state every search page shows. Only tasks
 * are searched, so the box counts and refines tasks alone.
 */
export function createTaskBoard(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  search: TaskBoardSearch,
  options: TaskBoardOptions,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
): TaskBoardSnapshot {
  const tasks = selectTasks(index, search.query);
  const layout = preferences.taskBoardLayout;
  const groupBy = preferences.taskBoardGroup;

  const board: TaskBoardLayout =
    layout === 'board'
      ? layoutTaskBoard(index, tasks, groupBy, options)
      : { groupBy, columns: [], taskCount: tasks.length };
  return {
    ...board,
    query: createQueryViewState(
      index,
      parseQuery(search.query),
      { notes: 0, tasks: tasks.length },
      true,
      preferences.recentQueries ?? [],
      {
        pending: search.invalidQuery,
        facets: search.query.trim()
          ? buildSearchFacets(
              index,
              { sections: [], files: [], tasks },
              search.query,
            )
          : [],
      },
    ),
    layout,
    // Both layouts show what the search found. The board page used to keep
    // an All/Open/Done switch beside the search box, which only the list
    // obeyed; a search says the same thing, for both, in one place.
    tasks:
      layout === 'list'
        ? sortTasks(tasks, preferences.taskOrder, preferences.taskSortMode)
            .map((task) => createDashboardTask(task, index.sections))
        : undefined,
    taskCounts: {
      all: tasks.length,
      active: tasks.filter((task) => !task.completed).length,
      completed: tasks.filter((task) => task.completed).length,
    },
    taskSortMode: preferences.taskSortMode,
    tagTitleDisplayMode,
    settings: {
      statuses: [...options.statuses],
      statusNamespace: options.statusNamespace,
    },
  };
}

/**
 * Lays out a chosen set of tasks, such as the Dashboard's filtered list. The
 * whole index is still read, so a card knows when an open task elsewhere
 * blocks it.
 */
export function layoutTaskBoard(
  index: WorkspaceIndex,
  tasks: readonly Task[],
  groupBy: TaskBoardGroupBy,
  options: TaskBoardOptions,
): TaskBoardLayout {
  const open = tasks.filter((task) => !task.completed);
  const done = tasks.filter((task) => task.completed).sort(compareDone);
  const doneLimit = options.doneLimit ?? DEFAULT_DONE_LIMIT;
  const openDependencyIds = new Set(
    [...index.tasks.values()]
      .filter((task) => !task.completed && task.dependencyId)
      .map((task) => task.dependencyId as string),
  );
  const toCard = (task: Task): TaskBoardCard =>
    createCard(task, groupBy, options.now, openDependencyIds);

  const drafts =
    groupBy === 'status'
      ? createStatusColumns(open, options)
      : groupBy === 'priority'
        ? createPriorityColumns(open)
        : groupBy === 'assignee'
          ? createAssigneeColumns(open, index)
          : createDueColumns(open, options.now);

  const columns: TaskBoardColumn[] = [
    ...drafts.map((draft) => ({
      id: draft.id,
      label: draft.label,
      droppable: draft.droppable,
      cards: draft.tasks.sort(compareOpen).map(toCard),
      hiddenCount: 0,
    })),
    {
      id: 'done',
      label: 'Done',
      droppable: true,
      cards: done.slice(0, doneLimit).map(toCard),
      hiddenCount: Math.max(0, done.length - doneLimit),
    },
  ];

  return { groupBy, columns, taskCount: tasks.length };
}

/**
 * Decides what dropping `task` on the column `columnId` writes.
 *
 * A completed task moved out of Done is reopened by the same edit. A due date
 * written in the task's sentence rather than as metadata is left alone,
 * because there is no marker Deckard could safely remove.
 */
export function resolveTaskMove(
  task: Task,
  columnId: string,
  options: TaskBoardOptions,
): TaskMove {
  if (columnId === 'done') {
    return task.completed ? { kind: 'unchanged' } : { kind: 'complete' };
  }

  const separator = columnId.indexOf(':');
  const kind = separator < 0 ? columnId : columnId.slice(0, separator);
  const value = separator < 0 ? '' : columnId.slice(separator + 1);
  const column = task.checkboxColumn;
  const reopen = (line: string): string =>
    task.completed ? setTaskLineCompletion(line, column, false) : line;

  switch (kind) {
    case 'status': {
      if (value && !isValidStatusName(value)) {
        return refuse(`"${value}" cannot be written as a status tag.`);
      }
      if (
        !task.completed &&
        (readTaskStatus(task, options.statusNamespace) ?? '') === value
      ) {
        return { kind: 'unchanged' };
      }
      return {
        kind: 'edit',
        label: value ? formatStatusLabel(value) : 'No status',
        edit: (line) =>
          setTaskStatusTag(
            reopen(line),
            column,
            options.statusNamespace,
            value || undefined,
          ),
      };
    }
    case 'priority': {
      if (value && !PRIORITIES.has(value)) {
        return refuse(`"${value}" is not a priority.`);
      }
      if (!task.completed && (task.priority ?? '') === value) {
        return { kind: 'unchanged' };
      }
      return {
        kind: 'edit',
        label: value ? `${formatStatusLabel(value)} priority` : 'No priority',
        edit: (line) =>
          setTaskPriority(
            reopen(line),
            column,
            (value || undefined) as TaskPriority | undefined,
            options.format,
          ),
      };
    }
    case 'due': {
      if (!task.completed && getDueBand(task.dueAt, options.now) === value) {
        return { kind: 'unchanged' };
      }
      if (value === 'today' || value === 'tomorrow') {
        const date = formatIsoDate(
          addDays(startOfDay(options.now), value === 'today' ? 0 : 1),
        );
        return {
          kind: 'edit',
          label: value === 'today' ? 'Due today' : 'Due tomorrow',
          edit: (line) =>
            setTaskDate(reopen(line), column, 'due', date, options.format),
        };
      }
      if (value === '') {
        const written = parseTaskMetadata(task.sourceLineText.slice(column + 2))
          .metadata.due;
        if (task.dueAt !== undefined && !written) {
          return refuse(
            'This task’s due date is written in its sentence, so Deckard leaves it for you to edit.',
          );
        }
        return {
          kind: 'edit',
          label: 'No due date',
          edit: (line) => setTaskDate(reopen(line), column, 'due', undefined),
        };
      }
      return refuse(
        'Drop a task on Today, Tomorrow, or No due date to change its due date.',
      );
    }
    case 'assignee':
      return refuse(
        'Who a task is for is written in its sentence, so Deckard leaves it for you to change.',
      );
    default:
      return refuse('Deckard does not know that column.');
  }
}

/**
 * Sets or clears a task's status tag. An existing status tag is changed where
 * it is written, and any others are removed; a new one goes at the end.
 */
export function setTaskStatusTag(
  line: string,
  checkboxColumn: number,
  namespace: string,
  status: string | undefined,
): string {
  const head = line.slice(0, checkboxColumn + 2);
  const text = line.slice(checkboxColumn + 2);
  const tag = `#${namespace}/${status ?? ''}`;
  const pattern = new RegExp(
    `[ \\t]+#${escapeRegExp(namespace)}/[A-Za-z0-9][A-Za-z0-9_-]*(?![A-Za-z0-9_/-])`,
    'gi',
  );
  let written = false;
  const next = text.replace(pattern, (match) => {
    if (!status || written) {
      return '';
    }
    written = true;
    return match.replace(/#.*$/, tag);
  });
  return head + (status && !written ? appendToTaskText(next, tag) : next);
}

/**
 * Reads the status written on a task's own line. A status inherited from a
 * heading does not count, because moving the card could not change it.
 */
export function readTaskStatus(
  task: Task,
  namespace: string,
): string | undefined {
  const prefix = `#${namespace.toLowerCase()}/`;
  return (task.associationTagGroups?.[0] ?? [])
    .map((tag) => tag.key.toLowerCase())
    .find((key) => key.startsWith(prefix))
    ?.slice(prefix.length);
}

function selectTasks(index: WorkspaceIndex, query: string): Task[] {
  const parsed = query.trim() ? parseQuery(query) : undefined;
  return parsed?.node
    ? evaluateQuery(index, parsed.node).tasks
    : [...index.tasks.values()];
}

function createStatusColumns(
  open: Task[],
  options: TaskBoardOptions,
): ColumnDraft[] {
  const byStatus = new Map<string, Task[]>();
  const withoutStatus: Task[] = [];
  for (const task of open) {
    const status = readTaskStatus(task, options.statusNamespace);
    if (status === undefined) {
      withoutStatus.push(task);
      continue;
    }
    const column = byStatus.get(status) ?? [];
    column.push(task);
    byStatus.set(status, column);
  }

  const configured = [...new Set(options.statuses)];
  const found = [...byStatus.keys()]
    .filter((status) => !configured.includes(status))
    .sort();
  return [
    {
      id: 'status:',
      label: 'No status',
      droppable: true,
      tasks: withoutStatus,
    },
    ...[...configured, ...found].map((status) => ({
      id: `status:${status}`,
      label: formatStatusLabel(status),
      droppable: true,
      tasks: byStatus.get(status) ?? [],
    })),
  ];
}

function createPriorityColumns(open: Task[]): ColumnDraft[] {
  return PRIORITY_COLUMNS.map(([priority, label]) => ({
    id: `priority:${priority}`,
    label,
    droppable: true,
    tasks: open.filter((task) => (task.priority ?? '') === priority),
  }));
}

/**
 * One column per person a task names, busiest first, with the tasks nobody
 * was named on last.
 *
 * Dropping a card is not offered: naming someone changes what a sentence
 * says, which is the author's to write, not a drag's to guess.
 */
function createAssigneeColumns(
  open: Task[],
  index: WorkspaceIndex,
): ColumnDraft[] {
  const byPerson = new Map<string, Task[]>();
  const unassigned: Task[] = [];
  open.forEach((task) => {
    if (!task.assignee) {
      unassigned.push(task);
      return;
    }
    byPerson.set(task.assignee, [...(byPerson.get(task.assignee) ?? []), task]);
  });
  const label = (key: string): string => index.tags.get(key)?.label ?? key;
  return [
    ...[...byPerson.entries()]
      .sort(
        (left, right) =>
          right[1].length - left[1].length ||
          label(left[0]).localeCompare(label(right[0])),
      )
      .map(([key, tasks]) => ({
        id: `assignee:${key}`,
        label: label(key),
        droppable: false,
        tasks,
      })),
    {
      id: 'assignee:',
      label: 'Nobody named',
      droppable: false,
      tasks: unassigned,
    },
  ];
}

/**
 * Due-date bands. Only Today, Tomorrow, and No due date name a single edit, so
 * only they accept a dropped card.
 */
const DUE_BANDS: ReadonlyArray<[string, string, boolean]> = [
  ['overdue', 'Overdue', false],
  ['today', 'Today', true],
  ['tomorrow', 'Tomorrow', true],
  ['week', 'Within a week', false],
  ['later', 'Later', false],
  ['', 'No due date', true],
];

function createDueColumns(open: Task[], now: number): ColumnDraft[] {
  return DUE_BANDS.map(([band, label, droppable]) => ({
    id: `due:${band}`,
    label,
    droppable,
    tasks: open.filter((task) => getDueBand(task.dueAt, now) === band),
  }));
}

function getDueBand(dueAt: number | undefined, now: number): string {
  if (dueAt === undefined) {
    return '';
  }
  const today = startOfDay(now);
  if (dueAt < today) {
    return 'overdue';
  }
  if (dueAt < addDays(today, 1)) {
    return 'today';
  }
  if (dueAt < addDays(today, 2)) {
    return 'tomorrow';
  }
  return dueAt < addDays(today, 8) ? 'week' : 'later';
}

function createCard(
  task: Task,
  groupBy: TaskBoardGroupBy,
  now: number,
  openDependencyIds: ReadonlySet<string>,
): TaskBoardCard {
  const title = stripTrailingTags(task.title) || task.title;
  const today = startOfDay(now);
  const open = !task.completed;
  const blockers = (task.dependsOn ?? []).filter((id) =>
    openDependencyIds.has(id),
  );
  return {
    taskId: task.id,
    title,
    renderedTitle: renderMarkdownInline(title),
    titleTags: task.tags
      .map((key) => ({ key, label: task.tagLabels[key] ?? key }))
      .filter((tag) => title.includes(tag.label)),
    completed: task.completed,
    filePath: task.filePath,
    line: task.lineNumber,
    overdue: open && task.dueAt !== undefined && task.dueAt < today,
    details: [
      !open && task.doneAt !== undefined
        ? `done ${formatIsoDate(task.doneAt)}`
        : '',
      open && task.dueText ? `due ${task.dueText}` : '',
      open && task.scheduledAt !== undefined
        ? `scheduled ${formatIsoDate(task.scheduledAt)}`
        : '',
      open && task.startAt !== undefined && task.startAt > today
        ? `starts ${formatIsoDate(task.startAt)}`
        : '',
      groupBy !== 'priority' && task.priority
        ? `${task.priority} priority`
        : '',
      task.recurrence ? `repeats ${task.recurrence}` : '',
      open && blockers.length > 0 ? `blocked by ${blockers.join(', ')}` : '',
      task.filePath.split('/').pop() ?? task.filePath,
    ].filter(Boolean),
  };
}

/** Soonest due first, then highest priority, then source order. */
function compareOpen(left: Task, right: Task): number {
  return (
    compareOptional(left.dueAt, right.dueAt, 1) ||
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] -
      TASK_PRIORITY_RANKS[left.priority ?? 'none'] ||
    compareSource(left, right)
  );
}

/** Most recently completed first. */
function compareDone(left: Task, right: Task): number {
  return (
    compareOptional(left.doneAt, right.doneAt, -1) ||
    compareOptional(left.updatedAt, right.updatedAt, -1) ||
    compareSource(left, right)
  );
}

/** Orders by `direction`, with a missing value always last. */
function compareOptional(
  left: number | undefined,
  right: number | undefined,
  direction: 1 | -1,
): number {
  if (left === undefined || right === undefined) {
    return (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0);
  }
  return (left - right) * direction;
}

function compareSource(left: Task, right: Task): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber
  );
}

function formatStatusLabel(status: string): string {
  const words = status.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function refuse(reason: string): TaskMove {
  return { kind: 'refused', reason };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
