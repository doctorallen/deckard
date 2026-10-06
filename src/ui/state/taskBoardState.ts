import {
  findTagSource,
  formatNamespaceValue,
  isNamespaceName,
  labelValue,
  listTaskNamespaces,
  NamespaceValue,
  noValueLabel,
  quoteTask,
  readNamespaceValues,
} from './tagGrouping';
import { findParentTag } from '../../domain/tasks/parentTag';
import { drawTaskStatus } from './drawnStatus';
import { describeStepParts, foldSteps } from '../../domain/markdown/taskSteps';
import { mentionsParked, withoutParked } from '../../domain/index/parked';
import { hasAvailableTerm, toggleAvailable } from '../../domain/query/queryEdit';
import { needsNewDate } from '../../domain/tasks/taskPolicy';
import {
  isCancelledTask,
  isOpenTask,
  nameTaskStatus,
  readStatusColumnKey,
  readStatusTag,
  statusColumnKey,
  statusForColumnKey,
  UNKNOWN_STATUS_NAME,
} from '../../domain/tasks/taskStatuses';
import type { StatusWriteMode } from '../../domain/tasks/statusWrites';
import { QueryContext } from '../../domain/query/queryContext';
import { extractTags } from '../../domain/markdown/parser';
import {
  formatStatusLabel,
  getDueBand,
  refuseMove,
  resolveTaskMove as resolveColumnMove,
  setTaskNamespaceTags,
  TaskMove,
} from '../../domain/tasks/boardMoves';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { parseQuery } from '../../domain/query/queryParser';
import { tokenizeInline } from '../../domain/markdown/inline';
import { getHeadingPath, stripTrailingTags } from '../../domain/ranking/entryLabels';
import { createDashboardTask, createTaskComparator, sortTasks, withDrawnStatus } from './entryCards';
import { createQueryViewState } from './querySuggestions';
import { compareTasksByColumn, createTaskCells, DEFAULT_TASK_COLUMNS, getTaskColumn, TableTask } from './resultTable';
import { buildSearchFacets } from '../../domain/search/facets';
import { TASK_COLUMNS } from '../../domain/tasks/taskColumns';
import {
  TaskBoardCard,
  TaskBoardColumn,
  TaskBoardLayout,
  TaskBoardSnapshot,
  TaskMenuState,
  TaskTable,
} from '../protocol/taskBoard';
import {
  PersistedPreferences,
  TagReference,
  TagTitleDisplayMode,
  Task,
  TaskBoardGroupBy,
  TaskPriority,
  WorkspaceIndex,
  Section,
  TaskColumnId,
} from '../../domain/model';
import { describeDueDate } from '../../domain/markdown/dueWording';
import { TASK_PRIORITY_RANKS, TaskMetadataFormat } from '../../domain/markdown/taskFields';
import { addDays, formatIsoDate, startOfDay } from '../../domain/markdown/calendar';

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

/** What the board is built with: its context, its status columns, and how much each column draws. */
export interface TaskBoardOptions {
  /**
   * The settings and moment the board is built in: its search is evaluated,
   * its due bands drawn, and its dates worded against them.
   */
  queryContext: QueryContext;
  /** Namespace that holds a task's status, `status` for `#status/doing`. */
  statusNamespace: string;
  /** Status columns in order. Other statuses found on tasks follow them. */
  statuses: readonly string[];
  /** Format for metadata written on a task that has none yet. */
  format: TaskMetadataFormat;
  /** Most completed tasks shown in Done. */
  doneLimit?: number;
  /** Most cards an open column draws before "Show N more"; 100 by default. */
  columnLimit?: number;
  /** Columns shown whole after "Show N more", Done included, by id. */
  shownColumns?: ReadonlySet<string>;
  /**
   * Work-in-progress limits, by status (`doing`) or by whole column id
   * (`priority:high`), from `deckard.board.limits`. A drop is never refused.
   */
  limits?: Readonly<Record<string, number>>;
  /** How a dropped status is written (`deckard.tasks.writeStatusAs`). */
  writeAs?: StatusWriteMode;
  /** `deckard.tasks.addCancelledDate`. */
  addCancelledDate?: boolean;
  /** Whether the board draws a Cancelled column after Done (`deckard.board.showCancelled`). */
  showCancelled?: boolean;
  /** Whether each card and row shows its task's nearest parent tag (`deckard.board.parentTag`). */
  parentTag?: boolean;
}

/** A column before it is cut to its limit and its tasks become cards. */
interface ColumnDraft {
  id: string;
  label: string;
  droppable: boolean;
  tasks: Task[];
  /** By task, the other columns a task is also in, which its card says. */
  alsoIn?: Map<string, string[]>;
}

const PRIORITY_COLUMNS: ReadonlyArray<[TaskPriority | '', string]> = [
  ['highest', 'Highest'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['', 'No priority'],
  ['low', 'Low'],
  ['lowest', 'Lowest'],
];
const DEFAULT_DONE_LIMIT = 20;
const DEFAULT_COLUMN_LIMIT = 100;

/** The Task Board's search: the one applied, and one typed that could not be. */
export interface TaskBoardSearch {
  query: string;
  /** Shown in the box with its error; the board keeps the applied search. */
  invalidQuery?: string;
}

/** What the Task Board page is built from. */
export interface TaskBoardRequest {
  index: WorkspaceIndex;
  preferences: PersistedPreferences;
  search: TaskBoardSearch;
  options: TaskBoardOptions;
  /** How a tag in a title is drawn; inline by default. */
  tagTitleDisplayMode?: TagTitleDisplayMode;
}

/**
 * Builds the Task Board page: the tasks its search finds, as columns or as a
 * list, with the same search box state every search page shows. Only tasks
 * are searched, so the box counts and refines tasks alone.
 */
export function createTaskBoard({
  index,
  preferences,
  search,
  options,
  tagTitleDisplayMode = 'inline',
}: TaskBoardRequest): TaskBoardSnapshot {
  const selected = selectTasks(index, search.query, options.queryContext);
  // A plain step rides on its task's card, so five steps are not five cards.
  const tasks = foldSteps(selected.tasks);
  const { parkedLeftOut } = selected;
  const layout = preferences.taskBoardLayout;
  const groupBy = preferences.taskBoardGroup;

  const board: TaskBoardLayout =
    layout === 'board'
      ? layoutTaskBoard({
          index,
          tasks,
          requestedGroupBy: groupBy,
          options,
          namespace: preferences.taskBoardGroupNamespace,
          sort: createTaskComparator(preferences.taskOrder, preferences.taskSortMode),
        })
      : { groupBy, columns: [], taskCount: tasks.length };
  return {
    ...board,
    query: createQueryViewState({
      index,
      parsed: parseQuery(search.query),
      matchCounts: { notes: 0, tasks: tasks.length },
      isAdvanced: true,
      recentQueries: preferences.recentQueries ?? [],
      pending: search.invalidQuery,
      facets: search.query.trim()
        ? buildSearchFacets(
            index,
            { sections: [], files: [], tasks },
            search.query,
            { parkedLeftOut, now: options.queryContext.now, taskPolicy: options.queryContext.taskPolicy },
          )
        : [],
      queryContext: options.queryContext,
    }),
    layout,
    // Both layouts show what the search found. The board page used to keep
    // an All/Open/Done switch beside the search box, which only the list
    // obeyed; a search says the same thing, for both, in one place.
    tasks:
      layout === 'list'
        ? sortTasks(tasks, preferences.taskOrder, preferences.taskSortMode)
            .map((task) => ({ ...createDashboardTask(task, index.sections, options.queryContext), ...withParentTag(index, task, options, undefined) }))
        : undefined,
    table:
      layout === 'table'
        ? createTaskTable(tasks, preferences, options)
        : undefined,
    taskMenus:
      layout === 'board' ? undefined : createTaskMenus(tasks, options),
    taskCounts: {
      all: tasks.length,
      active: tasks.filter(isOpenTask).length,
      completed: tasks.filter((task) => task.completed).length,
    },
    taskSortMode: preferences.taskSortMode,
    tagTitleDisplayMode,
    availableOnly: hasAvailableTerm(search.query),
    availableToggleQuery: toggleAvailable(search.query),
    settings: {
      statuses: [...options.statuses],
      statusNamespace: options.statusNamespace,
      columns: listStatusColumns(index, options),
      showCancelled: options.showCancelled === true,
      parentTag: options.parentTag === true,
    },
  };
}

/**
 * The searched tasks as a table: the columns chosen, or the defaults, and the
 * rows in the sort chosen, or in the rank order the list has. The cells come
 * from the shared column model, so a query block's table and this one agree.
 */
export function createTaskTable(
  tasks: readonly Task[],
  preferences: PersistedPreferences,
  options: TaskBoardOptions,
): TaskTable {
  const columns = preferences.taskTableColumns ?? [...DEFAULT_TASK_COLUMNS];
  const sort = preferences.taskTableSort;
  const ranked = sortTasks([...tasks], preferences.taskOrder, 'rank');
  const asRows = ranked.map((task) => ({
    task,
    table: toTableTask(task, options.queryContext.taskPolicy.statuses, options.statusNamespace),
  }));
  const ordered = sort
    ? [...asRows].sort((left, right) =>
        compareTasksByColumn(sort)(left.table, right.table),
      )
    : asRows;
  const label = (id: TaskColumnId) => ({ id, label: getTaskColumn(id).label });
  return {
    columns: columns.map(label),
    available: TASK_COLUMNS.map((column) => label(column.id)),
    sort,
    rows: ordered.map(({ task, table }) => ({
      taskId: task.id,
      filePath: task.filePath,
      line: task.lineNumber,
      completed: task.completed,
      ...withDrawnStatus(drawTaskStatus(task, { statuses: options.queryContext.taskPolicy.statuses, statusNamespace: options.statusNamespace })),
      cells: createTaskCells(table, columns, options.queryContext),
    })),
  };
}

/** What each row's ⋯ menu checks: the same choices a board card's does. */
function createTaskMenus(
  tasks: readonly Task[],
  options: TaskBoardOptions,
): Record<string, TaskMenuState> {
  const today = startOfDay(options.queryContext.now);
  return Object.fromEntries(
    tasks.map((task) => [
      task.id,
      {
        current: currentMoves(task, today, { statuses: options.queryContext.taskPolicy.statuses, namespace: options.statusNamespace }),
        ...(task.steps ? { steps: true } : {}),
      },
    ]),
  );
}

/**
 * A task's nearest parent tag, as a field a card or a row carries, when the
 * board shows them and the task has one its card does not already say: not
 * a tag of the namespace the board is grouped by.
 */
function withParentTag(
  index: WorkspaceIndex,
  task: Task,
  options: Pick<TaskBoardOptions, 'parentTag' | 'statusNamespace'>,
  groupNamespace: string | undefined,
): { parentTag?: TagReference } {
  if (!options.parentTag) {
    return {};
  }
  const parentTag = findParentTag(index, task, { statusNamespace: options.statusNamespace, ...(groupNamespace ? { groupNamespace } : {}) });
  return parentTag ? { parentTag } : {};
}

/** A task as the column model reads it. */
function toTableTask(task: Task, statuses: QueryContext['taskPolicy']['statuses'], statusNamespace: string): TableTask {
  const title = stripTrailingTags(task.title) || task.title;
  return {
    title,
    // A task title is prose, and is written as Markdown everywhere else it is
    // shown. The table drew its source until now.
    titleTokens: tokenizeInline(title),
    completed: task.completed,
    dueAt: task.dueAt,
    dueText: task.dueText,
    scheduledAt: task.scheduledAt,
    startAt: task.startAt,
    doneAt: task.doneAt,
    priority: task.priority,
    assignee: task.assignee,
    status: nameTaskStatus(task, statuses, statusNamespace),
    tags: task.tags.map((key) => task.tagLabels[key] ?? key),
    fileName: task.filePath.split('/').pop() ?? task.filePath,
    line: task.lineNumber,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    dependsOn: task.dependsOn,
    dependencyId: task.dependencyId,
  };
}

/** A chosen set of tasks, and how the board lays them out. */
export interface TaskBoardLayoutRequest {
  index: WorkspaceIndex;
  tasks: readonly Task[];
  /** The grouping asked for; a tag grouping with no namespace lays out by status. */
  requestedGroupBy: TaskBoardGroupBy;
  options: TaskBoardOptions;
  /** The tag namespace a tag grouping groups by. */
  namespace?: string;
  /**
   * How an open column orders its cards before its own order, soonest due
   * then highest priority, decides: the reader's rank or another sort. Done
   * and Cancelled always list the most recently closed first.
   */
  sort?: (left: Task, right: Task) => number;
}

/**
 * Lays out a chosen set of tasks, such as the Dashboard's filtered list. The
 * whole index is still read, so a card knows when an open task elsewhere
 * blocks it.
 */
export function layoutTaskBoard({
  index,
  tasks,
  requestedGroupBy,
  options,
  namespace,
  sort,
}: TaskBoardLayoutRequest): TaskBoardLayout {
  // A tag grouping without a namespace to group by lays out as status.
  const groupBy: TaskBoardGroupBy =
    requestedGroupBy === 'tag' && !isNamespaceName(namespace) ? 'status' : requestedGroupBy;
  const open = tasks.filter(isOpenTask);
  const done = tasks.filter((task) => task.completed).sort(compareDone);
  const cancelled = tasks.filter(isCancelledTask).sort(compareDone);
  const shown = options.shownColumns;
  const doneLimit = shown?.has('done') ? Number.MAX_SAFE_INTEGER : options.doneLimit ?? DEFAULT_DONE_LIMIT;
  const columnLimit = options.columnLimit ?? DEFAULT_COLUMN_LIMIT;
  const openDependencyIds = new Set(
    [...index.tasks.values()]
      .filter((task) => isOpenTask(task) && task.dependencyId)
      .map((task) => task.dependencyId as string),
  );
  const toCard = (task: Task, draft?: ColumnDraft): TaskBoardCard => {
    const card = createCard(task, {
      groupBy,
      context: options.queryContext,
      openDependencyIds,
      sections: index.sections,
      statusNamespace: options.statusNamespace,
      column: draft?.label,
    });
    const others = draft?.alsoIn?.get(task.id);
    const parent = withParentTag(index, task, options, groupBy === 'tag' ? namespace : undefined);
    const withTags =
      groupBy === 'tag' && namespace
        ? { ...card, ...parent, current: [...card.current, ...tagMoves(index, task, namespace)] }
        : { ...card, ...parent };
    return others && others.length > 0
      ? { ...withTags, details: [...withTags.details, `also in ${others.join(', ')}`] }
      : withTags;
  };

  // A status named done is the board's own Done: an open task carrying it
  // sits at the head of that column rather than in a second column of the
  // same name.
  const isMarkedDone = (task: Task): boolean =>
    groupBy === 'status' &&
    readStatusTag(task, options.statusNamespace) === 'done';
  const markedDone = open.filter(isMarkedDone);
  const drafts = draftColumns({ groupBy, open, index, options, namespace, isMarkedDone });

  const columns: TaskBoardColumn[] = [
    ...drafts.map((draft) => {
      // A column of hundreds draws its first hundred, and the rest on
      // request: building thousands of cards made the whole board slow.
      const sorted = draft.tasks.sort((left, right) => sort?.(left, right) || compareOpen(left, right));
      const drawn = shown?.has(draft.id) ? sorted : sorted.slice(0, columnLimit);
      const cards = drawn.map((task) => toCard(task, draft));
      const limit = findLimit(draft.id, options.limits);
      return {
        id: draft.id,
        label: draft.label,
        droppable: draft.droppable,
        cards: draft.id === 'due:overdue' ? cards : toneOverdue(cards, drawn),
        hiddenCount: sorted.length - drawn.length,
        overdueCount:
          draft.id === 'due:overdue' ? 0 : cards.filter((card) => card.overdue).length,
        ...(limit === undefined ? {} : { limit }),
      };
    }),
    ...closedColumns({ done: [...markedDone.sort(compareOpen), ...done], marked: markedDone.length, cancelled: options.showCancelled ? cancelled : undefined }, doneLimit, toCard),
  ];

  return {
    groupBy,
    columns,
    taskCount: tasks.length,
    ...describeStatusCoverage(groupBy, columns, open.length),
    ...(groupBy === 'tag' && namespace ? { groupNamespace: namespace.toLowerCase() } : {}),
    tagNamespaces: listBoardNamespaces(index, options.statusNamespace),
  };
}

/**
 * The columns of closed tasks, last whatever the grouping: Done, its open
 * tasks marked done first, then the most recent done; and, when the gear
 * shows it, Cancelled, closed but not done.
 */
function closedColumns(
  tasks: { done: Task[]; marked: number; cancelled: Task[] | undefined },
  limit: number,
  toCard: (task: Task) => TaskBoardCard,
): TaskBoardColumn[] {
  const drawn = (list: Task[], kept: number): Pick<TaskBoardColumn, 'cards' | 'hiddenCount'> => ({
    cards: list.slice(0, kept).map((task) => toCard(task)),
    hiddenCount: Math.max(0, list.length - kept),
  });
  return [
    { id: 'done', label: 'Done', droppable: true, ...drawn(tasks.done, tasks.marked + limit) },
    ...(tasks.cancelled ? [{ id: 'cancelled', label: 'Cancelled', droppable: true, ...drawn(tasks.cancelled, limit) }] : []),
  ];
}

/**
 * The open tasks' columns for the grouping, before Done, with due bands for
 * the due grouping. A status named done is the board's own Done, so the
 * tasks carrying it are left out of the status columns.
 */
function draftColumns({ groupBy, open, index, options, namespace, isMarkedDone }: {
  groupBy: TaskBoardGroupBy;
  open: Task[];
  index: WorkspaceIndex;
  options: TaskBoardOptions;
  namespace: string | undefined;
  isMarkedDone: (task: Task) => boolean;
}): ColumnDraft[] {
  if (groupBy === 'status') {
    return createStatusColumns(open.filter((task) => !isMarkedDone(task)), options);
  }
  if (groupBy === 'priority') {
    return createPriorityColumns(open);
  }
  if (groupBy === 'assignee') {
    return createAssigneeColumns(open, index);
  }
  if (groupBy === 'tag' && namespace) {
    return createTagColumns(open, index, namespace);
  }
  return createDueColumns(open, options.queryContext);
}

/** The namespaces each index's Tag… menu offers, by status namespace, worked out once. */
const boardNamespaces = new WeakMap<WorkspaceIndex, Map<string, { name: string; openTasks: number }[]>>();

/** The namespaces the Tag… menu offers, worked out once per index. */
function listBoardNamespaces(
  index: WorkspaceIndex,
  statusNamespace: string,
): { name: string; openTasks: number }[] {
  const cached = boardNamespaces.get(index) ?? new Map<string, { name: string; openTasks: number }[]>();
  boardNamespaces.set(index, cached);
  let found = cached.get(statusNamespace);
  if (!found) {
    found = listTaskNamespaces(index, [statusNamespace]).map(({ name, openTasks }) => ({ name, openTasks }));
    cached.set(statusNamespace, found);
  }
  return found;
}

/** A task's tag columns in a namespace, for its card's menu to check. */
function tagMoves(index: WorkspaceIndex, task: Task, namespace: string): string[] {
  const values = readNamespaceValues(index, task, namespace);
  const name = namespace.toLowerCase();
  return values.length > 0 ? values.map((value) => `tag:${name}/${value.value}`) : [`tag:${name}/`];
}

/**
 * A column per tag of a namespace, alphabetically, then the tasks with none.
 * By name, not by count: a count reordered the columns under the reader
 * whenever a task moved.
 * A tag counts however the task has it; a task with two is in both columns.
 */
function createTagColumns(
  open: Task[],
  index: WorkspaceIndex,
  namespace: string,
): ColumnDraft[] {
  const name = namespace.toLowerCase();
  const columns = new Map<string, { label: string; tasks: Task[] }>();
  const none: Task[] = [];
  const alsoIn = new Map<string, Map<string, string[]>>();
  open.forEach((task) => {
    const values = readNamespaceValues(index, task, name);
    if (values.length === 0) {
      none.push(task);
      return;
    }
    const labels = values.map((value) =>
      formatNamespaceValue(labelValue(index.tags.get(value.key)?.label ?? value.label)),
    );
    values.forEach((value, at) => {
      const id = `tag:${name}/${value.value}`;
      const column = columns.get(id) ?? { label: labels[at], tasks: [] };
      column.tasks.push(task);
      columns.set(id, column);
      const others = labels.filter((_, other) => other !== at);
      if (others.length === 0) {
        return;
      }
      const byTask = alsoIn.get(id) ?? new Map<string, string[]>();
      byTask.set(task.id, others);
      alsoIn.set(id, byTask);
    });
  });
  return [
    ...[...columns.entries()]
      .sort((left, right) => left[1].label.localeCompare(right[1].label))
      .map(([id, column]) => ({
        id,
        label: column.label,
        droppable: true,
        tasks: column.tasks,
        ...(alsoIn.has(id) ? { alsoIn: alsoIn.get(id) } : {}),
      })),
    { id: `tag:${name}/`, label: noValueLabel(name), droppable: true, tasks: none },
  ];
}

/** A column's limit: by its whole id, or by the status it holds. */
function findLimit(
  columnId: string,
  limits: Readonly<Record<string, number>> | undefined,
): number | undefined {
  if (!limits) {
    return undefined;
  }
  const value = columnId.slice(columnId.indexOf(':') + 1);
  const limit =
    limits[columnId] ??
    (columnId.startsWith('status:') && value ? limits[value] ?? limits[value.toLowerCase()] : undefined);
  return typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 ? limit : undefined;
}

/**
 * Forty red "overdue" cards in one column say nothing any one of them does
 * not. When more than half a column's open cards are overdue, the worst
 * third, the longest overdue, keep the red; the rest say "overdue" in muted
 * text beside a red dot, so the state is still in words.
 */
function toneOverdue(cards: TaskBoardCard[], tasks: readonly Task[]): TaskBoardCard[] {
  const open = cards.filter((card) => !card.completed);
  const overdue = cards
    .map((card, order) => ({ card, order, dueAt: tasks[order]?.dueAt ?? 0 }))
    .filter((entry) => entry.card.overdue);
  if (overdue.length === 0) {
    return cards;
  }
  if (overdue.length * 2 <= open.length) {
    return cards.map((card) => (card.overdue ? { ...card, overdueTone: 'full' as const } : card));
  }
  const loud = new Set(
    [...overdue]
      .sort((left, right) => left.dueAt - right.dueAt || left.order - right.order)
      .slice(0, Math.ceil(overdue.length / 3))
      .map((entry) => entry.card.taskId),
  );
  return cards.map((card) =>
    card.overdue ? { ...card, overdueTone: loud.has(card.taskId) ? ('full' as const) : ('quiet' as const) } : card,
  );
}

/** Below this share of open tasks with a status, the board says so. */
const STATUS_COVERAGE_HINT_BELOW = 0.25;
/** A board this small is read at a glance, and needs no telling. */
const STATUS_COVERAGE_HINT_MINIMUM_TASKS = 4;

/**
 * A board grouped by status is a list drawn expensively when the tasks carry
 * no status: one tall "No status" column and four near-empty ones. That is
 * the first thing a new reader sees, since status is the default grouping and
 * a status is a tag most notes never write. When fewer than a quarter of the
 * open tasks have one, the layout says so, and the page offers the due-date
 * grouping, which works for any task.
 */
function describeStatusCoverage(
  groupBy: TaskBoardGroupBy,
  columns: readonly TaskBoardColumn[],
  open: number,
): Pick<TaskBoardLayout, 'statusHint'> {
  if (groupBy !== 'status' || open < STATUS_COVERAGE_HINT_MINIMUM_TASKS) {
    return {};
  }
  const withoutStatus =
    columns.find((column) => column.id === 'status:')?.cards.length ?? 0;
  const withStatus = open - withoutStatus;
  return withStatus / open < STATUS_COVERAGE_HINT_BELOW
    ? { statusHint: { withoutStatus, open } }
    : {};
}

/**
 * What a move reads besides the task: the index, which says which of the
 * task's tags it inherits, and the column the card was dragged from.
 */
export interface TaskMoveContext {
  index?: WorkspaceIndex;
  from?: string;
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
  context: TaskMoveContext = {},
): TaskMove {
  return resolveColumnMove(task, columnId, options, (value, reopen) =>
    resolveTagMove(task, value, context, reopen),
  );
}

/**
 * A move between the tags of one namespace. The column's tag is written on
 * the task's line, in place of the one the card came from when that one is
 * written there; a tag the task inherits from a heading or its note's front
 * matter cannot be taken away by a drag, and the move says where it comes
 * from instead.
 */
function resolveTagMove(
  task: Task,
  value: string,
  context: TaskMoveContext,
  reopen: (line: string) => string,
): TaskMove {
  const slash = value.indexOf('/');
  const namespace = slash < 0 ? value : value.slice(0, slash);
  const target = slash < 0 ? '' : value.slice(slash + 1).toLowerCase();
  const tag = `#${namespace}/${target}`;
  if (!isNamespaceName(namespace) || slash < 0 || (target && !readsAsOneTag(tag))) {
    return refuseMove(`Deckard cannot write "${tag}" as a tag.`);
  }
  const move: TagMove = {
    task,
    namespace,
    values: readNamespaceValues(context.index, task, namespace),
    index: context.index,
    reopen,
  };
  if (!target) {
    return clearNamespace(move);
  }
  const from = context.from?.startsWith(`tag:${namespace.toLowerCase()}/`)
    ? context.from.slice(`tag:${namespace}/`.length).toLowerCase()
    : undefined;
  return moveToTag(move, { target, tag, from });
}

/** A drop on a tag column, read: the task, its namespace and its values there, and how to reopen it. */
interface TagMove {
  task: Task;
  namespace: string;
  values: NamespaceValue[];
  index: WorkspaceIndex | undefined;
  reopen: (line: string) => string;
}

/** Whether a tag written as `tag` is read back as that one tag, so writing it is safe. */
function readsAsOneTag(tag: string): boolean {
  const parsed = extractTags(tag);
  return parsed.length === 1 && parsed[0].key.toLowerCase() === tag.toLowerCase();
}

/**
 * A drop on the namespace's no-value column: the tags of the namespace
 * written on the line come off. An inherited one cannot, so the move says
 * where it comes from instead; a task with none written is already there.
 */
function clearNamespace(move: TagMove): TaskMove {
  const { task, namespace, values, reopen } = move;
  const inherited = values.find((entry) => entry.inherited);
  if (inherited) {
    return refuseInherited(task, inherited, move.index);
  }
  const written = values.filter((entry) => entry.written);
  if (written.length === 0 && !task.completed) {
    return { kind: 'unchanged' };
  }
  return {
    kind: 'edit',
    label: noValueLabel(namespace),
    edit: (line) =>
      setTaskNamespaceTags(reopen(line), task.checkboxColumn, {
        remove: written.map((entry) => entry.label),
      }),
  };
}

/**
 * A drop on a value's column. Dragged from another value of the namespace,
 * the card's old tag is replaced, unless it is inherited; otherwise the
 * column's tag is added, and a task that has it is already there.
 */
function moveToTag(
  move: TagMove,
  { target, tag, from }: { target: string; tag: string; from: string | undefined },
): TaskMove {
  const { task, values, reopen } = move;
  const column = task.checkboxColumn;
  const has = values.some((entry) => entry.value === target);
  const source = from ? values.find((entry) => entry.value === from) : undefined;
  if (source && from !== target) {
    if (source.inherited) {
      return refuseInherited(task, source, move.index);
    }
    return {
      kind: 'edit',
      label: tag,
      edit: (line) =>
        setTaskNamespaceTags(reopen(line), column, {
          remove: [source.label],
          ...(has ? {} : { add: tag }),
        }),
    };
  }
  if (has && !task.completed) {
    return { kind: 'unchanged' };
  }
  return {
    kind: 'edit',
    label: tag,
    edit: (line) => {
      const opened = reopen(line);
      return has ? opened : setTaskNamespaceTags(opened, column, { remove: [], add: tag });
    },
  };
}

/**
 * Refuses to take a task out of a tag it inherits, saying whether its
 * heading or its note's front matter gives it the tag. Without an index to
 * look in, the front matter is named.
 */
function refuseInherited(
  task: Task,
  entry: NamespaceValue,
  index: WorkspaceIndex | undefined,
): TaskMove {
  const source = index
    ? findTagSource(index, task, entry.key)
    : { kind: 'frontmatter' as const };
  return refuseMove(
    source.kind === 'heading'
      ? `${quoteTask(task)} is in ${entry.label} because its heading "${source.heading}" is, so moving it cannot take it out. Change the heading instead.`
      : `${quoteTask(task)} is in ${entry.label} because its note's front matter is, so moving it cannot take it out. Change the front matter instead.`,
  );
}

/**
 * The tasks the board's search finds, less the parked ones unless the search
 * asks about them, and how many open parked tasks that left out.
 */
function selectTasks(
  index: WorkspaceIndex,
  query: string,
  context: QueryContext,
): { tasks: Task[]; parkedLeftOut: number } {
  const parsed = query.trim() ? parseQuery(query) : undefined;
  const found = parsed?.node
    ? evaluateQuery(index, parsed.node, context).tasks
    : [...index.tasks.values()];
  if (mentionsParked(parsed?.node) || !index.parked || index.parked.tasks.size === 0) {
    return { tasks: found, parkedLeftOut: 0 };
  }
  const tasks = withoutParked(found, index);
  const parkedLeftOut = found.filter(
    (task) => isOpenTask(task) && index.parked?.tasks.has(task.id),
  ).length;
  return { tasks, parkedLeftOut };
}

/**
 * The status columns in the order the board draws them, each with how many
 * open tasks in the workspace carry it: what the gear lists and orders.
 */
function listStatusColumns(
  index: WorkspaceIndex,
  options: TaskBoardOptions,
): { status: string; openTasks: number }[] {
  const statuses = options.queryContext.taskPolicy.statuses;
  const counts = new Map<string, number>();
  index.tasks.forEach((task) => {
    if (!isOpenTask(task)) {
      return;
    }
    const status = readStatusColumnKey(task, statuses, options.statusNamespace);
    if (status !== undefined && status !== 'done') {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
  });
  const configured = readConfiguredKeys(options);
  const found = [...counts.keys()].filter((status) => !configured.includes(status)).sort();
  return [...configured, ...found].map((status) => ({ status, openTasks: counts.get(status) ?? 0, label: labelStatusColumn(options, status) }));
}

/**
 * The board's status columns as `deckard.board.statuses` orders them, each
 * by its key: a value that names a status by its tag or its name is that
 * status's column, so `doing` and `in-progress` are both In progress; any
 * other value is a tag of its own. A status named done is the board's own
 * Done column, drawn last whatever the grouping.
 */
function readConfiguredKeys(options: TaskBoardOptions): string[] {
  const statuses = options.queryContext.taskPolicy.statuses;
  const keys = options.statuses.map((value) => {
    const status = statusForColumnKey(statuses, value);
    return status ? statusColumnKey(status) : value;
  });
  return [...new Set(keys)].filter((status) => status !== 'done');
}

/** A status column's heading: its status's name, or the tag written as words. */
function labelStatusColumn(options: TaskBoardOptions, key: string): string {
  return statusForColumnKey(options.queryContext.taskPolicy.statuses, key)?.name ?? formatStatusLabel(key);
}

/**
 * The open tasks by status: No status first, a plain `[ ]` with no status
 * tag and a character no status names; then the columns the settings
 * order; then any other status found on a task, in name order.
 */
function createStatusColumns(
  open: Task[],
  options: TaskBoardOptions,
): ColumnDraft[] {
  const statuses = options.queryContext.taskPolicy.statuses;
  const byStatus = new Map<string, Task[]>();
  const withoutStatus: Task[] = [];
  for (const task of open) {
    const status = readStatusColumnKey(task, statuses, options.statusNamespace);
    if (status === undefined) {
      withoutStatus.push(task);
      continue;
    }
    const column = byStatus.get(status) ?? [];
    column.push(task);
    byStatus.set(status, column);
  }
  const configured = readConfiguredKeys(options);
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
      label: labelStatusColumn(options, status),
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
 * One column per person a task names, by name, with the tasks nobody was
 * named on last.
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
      // By name, as a tag's columns are, so they hold still.
      .sort((left, right) => label(left[0]).localeCompare(label(right[0])))
      .map(([key, tasks]) => ({
        id: `assignee:${key}`,
        label: label(key),
        droppable: true,
        tasks,
      })),
    {
      id: 'assignee:',
      label: 'Nobody named',
      droppable: true,
      tasks: unassigned,
    },
  ];
}

/**
 * Due-date bands. Only Today, Tomorrow, and No due date name a single edit, so
 * only they accept a dropped card.
 */
const DUE_BANDS: ReadonlyArray<[string, string, boolean]> = [
  // First, and titled in red as Overdue is: the oldest slips are the ones
  // that most need a decision, and at the far end they went unseen.
  ['needsdate', 'Needs a new date', false],
  ['overdue', 'Overdue', false],
  ['today', 'Today', true],
  ['tomorrow', 'Tomorrow', true],
  ['week', 'Within a week', false],
  ['later', 'Later', false],
  ['', 'No due date', true],
];

function createDueColumns(open: Task[], context: QueryContext): ColumnDraft[] {
  return DUE_BANDS.map(([band, label, droppable]) => ({
    id: `due:${band}`,
    label,
    droppable,
    tasks: open.filter((task) => getDueBand(task.dueAt, context) === band),
  }));
}

function createCard(
  task: Task,
  { groupBy, context, openDependencyIds, sections, statusNamespace, column }: {
    groupBy: TaskBoardGroupBy;
    context: QueryContext;
    openDependencyIds: ReadonlySet<string>;
    sections: ReadonlyMap<string, Section>;
    statusNamespace: string;
    /** The heading of the column the card is in, when it is in one. */
    column?: string;
  },
): TaskBoardCard {
  const status = describeCardStatus(task, context.taskPolicy.statuses, statusNamespace, column);
  const section = task.sectionId ? sections.get(task.sectionId) : undefined;
  const title = stripTrailingTags(task.title) || task.title;
  const { now, taskPolicy } = context;
  const today = startOfDay(now);
  const open = !task.completed;
  const blockers = (task.dependsOn ?? []).filter((id) =>
    openDependencyIds.has(id),
  );
  return {
    taskId: task.id,
    title,
    titleTokens: tokenizeInline(title),
    titleTags: task.tags
      .map((key) => ({ key, label: task.tagLabels[key] ?? key }))
      .filter((tag) => title.includes(tag.label)),
    completed: task.completed,
    ...withDrawnStatus(drawTaskStatus(task, { statuses: context.taskPolicy.statuses, statusNamespace })),
    filePath: task.filePath,
    line: task.lineNumber,
    ...(task.createdAt === undefined ? {} : { createdAt: task.createdAt }),
    ...(task.updatedAt === undefined ? {} : { updatedAt: task.updatedAt }),
    overdue: open && task.dueAt !== undefined && task.dueAt < today && !needsNewDate(task.dueAt, now, taskPolicy),
    ...(open && needsNewDate(task.dueAt, now, taskPolicy) ? { stale: true } : {}),
    details: [...(status ? [status] : []), ...cardDetails(task, { groupBy, today, taskPolicy, blockers })],
    // Where the task is written folds under the card, as it does under a
    // row; it was the last detail on every card.
    headingPath: section ? getHeadingPath(section, sections) : [],
    current: currentMoves(task, today, { statuses: context.taskPolicy.statuses, namespace: statusNamespace }),
    ...(task.steps ? { steps: describeStepParts(task.steps) } : {}),
  };
}

/**
 * A card's status, when its column does not already say it: In progress
 * on a card in a priority column, or Unknown on a card in No status, with
 * the character it does not know. A plain to do, and a done task, say none.
 */
function describeCardStatus(
  task: Task,
  statuses: QueryContext['taskPolicy']['statuses'],
  namespace: string,
  column: string | undefined,
): string | undefined {
  if (task.completed) {
    return undefined;
  }
  const name = nameTaskStatus(task, statuses, namespace);
  if (!name || name === column) {
    return undefined;
  }
  return name === UNKNOWN_STATUS_NAME ? `${name} [${task.status.symbol}]` : name;
}

/**
 * What a card says under its title: when a done task was done, or an open
 * task's due, scheduled, and future start dates; its priority, unless the
 * columns already say it; how it repeats; and what open tasks block it.
 */
function cardDetails(
  task: Task,
  { groupBy, today, taskPolicy, blockers }: {
    groupBy: TaskBoardGroupBy;
    today: number;
    taskPolicy: QueryContext['taskPolicy'];
    blockers: readonly string[];
  },
): string[] {
  const open = !task.completed;
  return [
    !open && task.doneAt !== undefined
      ? `done ${formatIsoDate(task.doneAt)}`
      : '',
    open ? dueDetail(task, today, taskPolicy) : '',
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
  ].filter(Boolean);
}

/** An open task's due date in words beside today; its written words when they are not a date; else nothing. */
function dueDetail(task: Task, today: number, taskPolicy: QueryContext['taskPolicy']): string {
  if (task.dueAt !== undefined) {
    return describeDueDate(task.dueAt, today, taskPolicy, task.dueText).label;
  }
  return task.dueText ? `due ${task.dueText}` : '';
}

/** The move values a task already has, for its card's menu to check. */
function currentMoves(
  task: Task,
  today: number,
  reading: { statuses: QueryContext['taskPolicy']['statuses']; namespace: string },
): string[] {
  return [
    `status:${readStatusColumnKey(task, reading.statuses, reading.namespace) ?? ''}`,
    `priority:${task.priority ?? ''}`,
    ...dueMoves(task, today),
    ...(task.completed ? ['done'] : []),
    ...(isCancelledTask(task) ? ['cancelled'] : []),
  ];
}

/**
 * The due column a task is already in, of the ones the card's menu offers:
 * no date, today, or tomorrow. A due date written in words has none, since
 * no move can take it away.
 */
function dueMoves(task: Task, today: number): string[] {
  if (task.dueAt === undefined) {
    return task.dueText ? [] : ['due:'];
  }
  if (task.dueAt >= today && task.dueAt < addDays(today, 1)) {
    return ['due:today'];
  }
  if (task.dueAt >= addDays(today, 1) && task.dueAt < addDays(today, 2)) {
    return ['due:tomorrow'];
  }
  return [];
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

/** Source order: by file path, then line. */
function compareSource(left: Task, right: Task): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber
  );
}
