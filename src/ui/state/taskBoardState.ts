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
import { describeStepParts, foldSteps } from '../../domain/markdown/taskSteps';
import { mentionsParked, withoutParked } from '../../domain/index/parked';
import { hasAvailableTerm, toggleAvailable } from '../../domain/query/queryEdit';
import { needsNewDate } from '../../domain/tasks/taskPolicy';
import { QueryContext } from '../../domain/query/queryContext';
import {
  addDays,
  formatIsoDate,
  startOfDay,
  TASK_PRIORITY_RANKS,
  TaskMetadataFormat,
  describeDueDate,
} from '../../domain/markdown/taskMetadata';
import { extractTags } from '../../domain/markdown/parser';
import {
  formatStatusLabel,
  getDueBand,
  readTaskStatus,
  refuseMove,
  resolveTaskMove as resolveColumnMove,
  setTaskNamespaceTags,
  TaskMove,
} from '../../domain/tasks/boardMoves';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { parseQuery } from '../../domain/query/queryParser';
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
  TaskMenuState,
  TaskTable,
  Section,
} from '../../core/types';
import { renderMarkdownInline } from '../webview/rendering';
import {
  createDashboardTask,
  createQueryViewState,
  getHeadingPath,
  sortTasks,
} from './dashboardState';
import { stripTrailingTags } from './queryBlockState';
import {
  compareTasksByColumn,
  createTaskCells,
  DEFAULT_TASK_COLUMNS,
  getTaskColumn,
  TableTask,
  TASK_COLUMNS,
  TaskColumnId,
} from './resultTable';
import { buildSearchFacets } from './searchFacets';

// The board's task rules moved to domain/tasks; their old names stay here
// for the modules that import them from the board.
export {
  isValidStatusName,
  readTaskStatus,
  setTaskNamespaceTags,
  setTaskStatusTag,
} from '../../domain/tasks/boardMoves';
export type { TaskMove } from '../../domain/tasks/boardMoves';

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
}

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
      ? layoutTaskBoard({ index, tasks, requestedGroupBy: groupBy, options, namespace: preferences.taskBoardGroupNamespace })
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
            { parkedLeftOut, now: options.queryContext.now },
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
            .map((task) => createDashboardTask(task, index.sections, options.queryContext))
        : undefined,
    table:
      layout === 'table'
        ? createTaskTable(tasks, preferences, options)
        : undefined,
    taskMenus:
      layout === 'board' ? undefined : createTaskMenus(tasks, options),
    taskCounts: {
      all: tasks.length,
      active: tasks.filter((task) => !task.completed).length,
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
    table: toTableTask(task, options.statusNamespace),
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
        current: currentMoves(task, today, options.statusNamespace),
        ...(task.steps ? { steps: true } : {}),
      },
    ]),
  );
}

/** A task as the column model reads it. */
function toTableTask(task: Task, statusNamespace: string): TableTask {
  const title = stripTrailingTags(task.title) || task.title;
  return {
    title,
    // A task title is prose, and is written as Markdown everywhere else it is
    // shown. The table drew its source until now.
    renderedTitle: renderMarkdownInline(title),
    completed: task.completed,
    dueAt: task.dueAt,
    dueText: task.dueText,
    scheduledAt: task.scheduledAt,
    startAt: task.startAt,
    doneAt: task.doneAt,
    priority: task.priority,
    assignee: task.assignee,
    status: readTaskStatus(task, statusNamespace),
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
}: TaskBoardLayoutRequest): TaskBoardLayout {
  // A tag grouping without a namespace to group by lays out as status.
  const groupBy: TaskBoardGroupBy =
    requestedGroupBy === 'tag' && !isNamespaceName(namespace) ? 'status' : requestedGroupBy;
  const open = tasks.filter((task) => !task.completed);
  const done = tasks.filter((task) => task.completed).sort(compareDone);
  const shown = options.shownColumns;
  const doneLimit = shown?.has('done') ? Number.MAX_SAFE_INTEGER : options.doneLimit ?? DEFAULT_DONE_LIMIT;
  const columnLimit = options.columnLimit ?? DEFAULT_COLUMN_LIMIT;
  const openDependencyIds = new Set(
    [...index.tasks.values()]
      .filter((task) => !task.completed && task.dependencyId)
      .map((task) => task.dependencyId as string),
  );
  const toCard = (task: Task, draft?: ColumnDraft): TaskBoardCard => {
    const card = createCard(task, groupBy, options.queryContext, openDependencyIds, index.sections, options.statusNamespace);
    const others = draft?.alsoIn?.get(task.id);
    const withTags =
      groupBy === 'tag' && namespace
        ? { ...card, current: [...card.current, ...tagMoves(index, task, namespace)] }
        : card;
    return others && others.length > 0
      ? { ...withTags, details: [...withTags.details, `also in ${others.join(', ')}`] }
      : withTags;
  };

  // A status named done is the board's own Done: an open task carrying it
  // sits at the head of that column rather than in a second column of the
  // same name.
  const isMarkedDone = (task: Task): boolean =>
    groupBy === 'status' &&
    readTaskStatus(task, options.statusNamespace) === 'done';
  const markedDone = open.filter(isMarkedDone);
  const drafts =
    groupBy === 'status'
      ? createStatusColumns(open.filter((task) => !isMarkedDone(task)), options)
      : groupBy === 'priority'
        ? createPriorityColumns(open)
        : groupBy === 'assignee'
          ? createAssigneeColumns(open, index)
          : groupBy === 'tag' && namespace
            ? createTagColumns(open, index, namespace)
            : createDueColumns(open, options.queryContext);

  const columns: TaskBoardColumn[] = [
    ...drafts.map((draft) => {
      // A column of hundreds draws its first hundred, and the rest on
      // request: building thousands of cards made the whole board slow.
      const sorted = draft.tasks.sort(compareOpen);
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
        ...(limit !== undefined ? { limit } : {}),
      };
    }),
    {
      id: 'done',
      label: 'Done',
      droppable: true,
      cards: [...markedDone.sort(compareOpen), ...done.slice(0, doneLimit)].map((task) => toCard(task)),
      hiddenCount: Math.max(0, done.length - doneLimit),
    },
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
      if (others.length > 0) {
        const byTask = alsoIn.get(id) ?? new Map<string, string[]>();
        byTask.set(task.id, others);
        alsoIn.set(id, byTask);
      }
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
 * Decides what dropping `task` on the column `columnId` writes.
 *
 * A completed task moved out of Done is reopened by the same edit. A due date
 * written in the task's sentence rather than as metadata is left alone,
 * because there is no marker Deckard could safely remove.
 */
/**
 * What a move reads besides the task: the index, which says which of the
 * task's tags it inherits, and the column the card was dragged from.
 */
export interface TaskMoveContext {
  index?: WorkspaceIndex;
  from?: string;
}

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
  if (!isNamespaceName(namespace) || slash < 0) {
    return refuseMove(`Deckard cannot write "${tag}" as a tag.`);
  }
  if (target) {
    const parsed = extractTags(tag);
    if (parsed.length !== 1 || parsed[0].key.toLowerCase() !== tag.toLowerCase()) {
      return refuseMove(`Deckard cannot write "${tag}" as a tag.`);
    }
  }
  const values = readNamespaceValues(context.index, task, namespace);
  const from = context.from?.startsWith(`tag:${namespace.toLowerCase()}/`)
    ? context.from.slice(`tag:${namespace}/`.length).toLowerCase()
    : undefined;
  const inheritedRefusal = (entry: NamespaceValue): TaskMove => {
    const source = context.index
      ? findTagSource(context.index, task, entry.key)
      : { kind: 'frontmatter' as const };
    return refuseMove(
      source.kind === 'heading'
        ? `${quoteTask(task)} is in ${entry.label} because its heading "${source.heading}" is, so moving it cannot take it out. Change the heading instead.`
        : `${quoteTask(task)} is in ${entry.label} because its note's front matter is, so moving it cannot take it out. Change the front matter instead.`,
    );
  };
  const column = task.checkboxColumn;

  if (!target) {
    const inherited = values.find((entry) => entry.inherited);
    if (inherited) {
      return inheritedRefusal(inherited);
    }
    const written = values.filter((entry) => entry.written);
    if (written.length === 0 && !task.completed) {
      return { kind: 'unchanged' };
    }
    return {
      kind: 'edit',
      label: noValueLabel(namespace),
      edit: (line) =>
        setTaskNamespaceTags(reopen(line), column, {
          remove: written.map((entry) => entry.label),
        }),
    };
  }

  const has = values.some((entry) => entry.value === target);
  const source = from ? values.find((entry) => entry.value === from) : undefined;
  if (source && from !== target) {
    if (source.inherited) {
      return inheritedRefusal(source);
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
    (task) => !task.completed && index.parked?.tasks.has(task.id),
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
  const counts = new Map<string, number>();
  index.tasks.forEach((task) => {
    if (task.completed) {
      return;
    }
    const status = readTaskStatus(task, options.statusNamespace);
    if (status !== undefined && status !== 'done') {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
  });
  const configured = [...new Set(options.statuses)].filter((status) => status !== 'done');
  const found = [...counts.keys()].filter((status) => !configured.includes(status)).sort();
  return [...configured, ...found].map((status) => ({ status, openTasks: counts.get(status) ?? 0 }));
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

  // A configured status named done is the board's own Done column, which
  // is drawn last whatever the grouping; a column for it here was a second
  // empty Done beside that one.
  const configured = [...new Set(options.statuses)].filter(
    (status) => status !== 'done',
  );
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
  groupBy: TaskBoardGroupBy,
  context: QueryContext,
  openDependencyIds: ReadonlySet<string>,
  sections: ReadonlyMap<string, Section>,
  statusNamespace: string,
): TaskBoardCard {
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
    renderedTitle: renderMarkdownInline(title),
    titleTags: task.tags
      .map((key) => ({ key, label: task.tagLabels[key] ?? key }))
      .filter((tag) => title.includes(tag.label)),
    completed: task.completed,
    filePath: task.filePath,
    line: task.lineNumber,
    overdue: open && task.dueAt !== undefined && task.dueAt < today && !needsNewDate(task.dueAt, now, taskPolicy),
    ...(open && needsNewDate(task.dueAt, now, taskPolicy) ? { stale: true } : {}),
    details: [
      !open && task.doneAt !== undefined
        ? `done ${formatIsoDate(task.doneAt)}`
        : '',
      open && task.dueAt !== undefined
        ? describeDueDate(task.dueAt, today, taskPolicy, task.dueText).label
        : open && task.dueText
          ? `due ${task.dueText}`
          : '',
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
    ].filter(Boolean),
    // Where the task is written folds under the card, as it does under a
    // row; it was the last detail on every card.
    headingPath: section ? getHeadingPath(section, sections) : [],
    current: currentMoves(task, today, statusNamespace),
    ...(task.steps ? { steps: describeStepParts(task.steps) } : {}),
  };
}

/** The move values a task already has, for its card's menu to check. */
function currentMoves(task: Task, today: number, statusNamespace: string): string[] {
  const due =
    task.dueAt === undefined
      ? task.dueText
        ? []
        : ['due:']
      : task.dueAt >= today && task.dueAt < addDays(today, 1)
        ? ['due:today']
        : task.dueAt >= addDays(today, 1) && task.dueAt < addDays(today, 2)
          ? ['due:tomorrow']
          : [];
  return [
    `status:${readTaskStatus(task, statusNamespace) ?? ''}`,
    `priority:${task.priority ?? ''}`,
    ...due,
    ...(task.completed ? ['done'] : []),
  ];
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
