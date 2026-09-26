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
import { describeStepParts, foldSteps } from '../../core/markdown/taskSteps';
import { mentionsParked, withoutParked } from '../../core/workspace/parked';
import { hasAvailableTerm, toggleAvailable } from '../../core/query/queryEdit';
import { needsNewDate } from '../../core/taskPolicy';
import {
  addDays,
  appendToTaskText,
  formatIsoDate,
  parseTaskMetadata,
  setTaskAssignee,
  setTaskDate,
  setTaskLineCompletion,
  setTaskPriority,
  startOfDay,
  TASK_PRIORITY_RANKS,
  TaskMetadataFormat,
  describeDueDate,
} from '../../core/markdown/taskMetadata';
import { extractTags, readPerson } from '../../core/markdown/parser';
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
  /** By task, the other columns a task is also in, which its card says. */
  alsoIn?: Map<string, string[]>;
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
const DEFAULT_COLUMN_LIMIT = 100;

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
  const selected = selectTasks(index, search.query);
  // A plain step rides on its task's card, so five steps are not five cards.
  const tasks = foldSteps(selected.tasks);
  const { parkedLeftOut } = selected;
  const layout = preferences.taskBoardLayout;
  const groupBy = preferences.taskBoardGroup;

  const board: TaskBoardLayout =
    layout === 'board'
      ? layoutTaskBoard(index, tasks, groupBy, options, preferences.taskBoardGroupNamespace)
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
              { parkedLeftOut },
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
    table:
      layout === 'table'
        ? createTaskTable(tasks, preferences, options)
        : undefined,
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
      cells: createTaskCells(table, columns, options.now),
    })),
  };
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

/**
 * Lays out a chosen set of tasks, such as the Dashboard's filtered list. The
 * whole index is still read, so a card knows when an open task elsewhere
 * blocks it.
 */
export function layoutTaskBoard(
  index: WorkspaceIndex,
  tasks: readonly Task[],
  requestedGroupBy: TaskBoardGroupBy,
  options: TaskBoardOptions,
  namespace?: string,
): TaskBoardLayout {
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
    const card = createCard(task, groupBy, options.now, openDependencyIds, index.sections, options.statusNamespace);
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
            : createDueColumns(open, options.now);

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
 * A column per tag of a namespace, busiest first, then the tasks with none.
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
      .sort(
        (left, right) =>
          right[1].tasks.length - left[1].tasks.length || left[1].label.localeCompare(right[1].label),
      )
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
      // One date, as a day of the Tasks view's Upcoming names it.
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        if (!task.completed && task.dueAt !== undefined && formatIsoDate(task.dueAt) === value) {
          return { kind: 'unchanged' };
        }
        const [year, month, day] = value.split('-').map(Number);
        const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month - 1, day).getDay()];
        return {
          kind: 'edit',
          label: `Due ${weekday} ${value}`,
          edit: (line) => setTaskDate(reopen(line), column, 'due', value, options.format),
        };
      }
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
    case 'assignee': {
      const person = value ? readPerson(value) : undefined;
      if (value && !person) {
        return refuse(`Deckard cannot read "${value}" as a person.`);
      }
      if (!task.completed && (task.assignee ?? '') === (person ?? '')) {
        return { kind: 'unchanged' };
      }
      return {
        kind: 'edit',
        label: person ? `For ${person}` : 'For nobody',
        edit: (line) => setTaskAssignee(reopen(line), column, person, options.format),
      };
    }
    case 'tag':
      return resolveTagMove(task, value, context, reopen);
    default:
      return refuse('That column no longer exists on the board. Refresh the board and try again.');
  }
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
    return refuse(`Deckard cannot write "${tag}" as a tag.`);
  }
  if (target) {
    const parsed = extractTags(tag);
    if (parsed.length !== 1 || parsed[0].key.toLowerCase() !== tag.toLowerCase()) {
      return refuse(`Deckard cannot write "${tag}" as a tag.`);
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
    return refuse(
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
 * Takes tags out of a task line, by their written labels, and writes one:
 * in place of the first taken out, else at the end of the task's words,
 * ahead of a `^block-id`.
 */
export function setTaskNamespaceTags(
  line: string,
  checkboxColumn: number,
  change: { remove: readonly string[]; add?: string },
): string {
  const head = line.slice(0, checkboxColumn + 2);
  let text = line.slice(checkboxColumn + 2);
  let placed = change.add === undefined;
  change.remove.forEach((label) => {
    const pattern = new RegExp(`[ \\t]+${escapeRegExp(label)}(?![A-Za-z0-9_/-])`, 'gi');
    text = text.replace(pattern, (match) => {
      if (!placed && change.add !== undefined) {
        placed = true;
        return match.replace(/\S+$/, change.add);
      }
      return '';
    });
  });
  if (!placed && change.add !== undefined) {
    text = appendToTaskText(text, change.add);
  }
  return head + text;
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

/**
 * The tasks the board's search finds, less the parked ones unless the search
 * asks about them, and how many open parked tasks that left out.
 */
function selectTasks(
  index: WorkspaceIndex,
  query: string,
): { tasks: Task[]; parkedLeftOut: number } {
  const parsed = query.trim() ? parseQuery(query) : undefined;
  const found = parsed?.node
    ? evaluateQuery(index, parsed.node).tasks
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
  ['overdue', 'Overdue', false],
  ['today', 'Today', true],
  ['tomorrow', 'Tomorrow', true],
  ['week', 'Within a week', false],
  ['later', 'Later', false],
  ['', 'No due date', true],
  // A band of its own, muted, for what a month has passed by: it is not a
  // red column of things to do today.
  ['needsdate', 'Needs a new date', false],
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
  if (needsNewDate(dueAt, now)) {
    return 'needsdate';
  }
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
  sections: ReadonlyMap<string, Section>,
  statusNamespace: string,
): TaskBoardCard {
  const section = task.sectionId ? sections.get(task.sectionId) : undefined;
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
    overdue: open && task.dueAt !== undefined && task.dueAt < today && !needsNewDate(task.dueAt, now),
    ...(open && needsNewDate(task.dueAt, now) ? { stale: true } : {}),
    details: [
      !open && task.doneAt !== undefined
        ? `done ${formatIsoDate(task.doneAt)}`
        : '',
      open && task.dueAt !== undefined
        ? describeDueDate(task.dueAt, today, task.dueText).label
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
