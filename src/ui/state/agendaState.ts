import { formatNamespaceValue, labelValue, noValueLabel, readNamespaceValues } from './tagGrouping';
import { mentionsParked, withoutParked } from '../../domain/index/parked';
import { describeSteps, isPlainStep } from '../../domain/markdown/taskSteps';
import { addDays, formatIsoDate, startOfDay } from '../../domain/markdown/calendar';
import { formatDisplayDate } from '../../domain/markdown/dateFormat';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { parseQuery } from '../../domain/query/queryParser';
import { QueryContext } from '../../domain/query/queryContext';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { listUnknownColumns, orderOpenStatuses, readTaskColumnKey } from '../../domain/tasks/statusColumns';
import type { TaskPolicy } from '../../domain/tasks/taskPolicy';
import { Placement, placeTask } from '../../domain/tasks/agendaPlacement';
import { AgendaGroupBy } from '../../domain/tasks/agendaGroups';
import { getHeadingPath, stripTrailingTags } from '../../domain/ranking/entryLabels';
import { Task, TaskPriority, TaskSortMode, WorkspaceIndex } from '../../domain/model';
import { createTaskComparator } from './entryCards';
import { formatTaskMetadata, TASK_PRIORITY_RANKS } from '../../domain/markdown/taskFields';

/**
 * The Agenda is a list of open tasks — the ones a query chose, or every one
 * — grouped by when they need attention, using the dates of the Obsidian
 * Tasks format and Deckard's own due dates:
 *
 * - **Overdue**: the due date has passed, the most recent slip first.
 * - **Today**: due today, or scheduled for today or earlier and already
 *   started.
 * - **Upcoming**: due, scheduled, or starting within the next few days.
 * - **Later**: dated, but past that horizon.
 * - **No date**: carrying no due, scheduled, or start date at all.
 * - **Done today**, when asked for: the tasks completed today.
 * - **Needs a new date**: due more than `needsNewDateAfterDays` ago. A task
 *   a month past its date is not going to be done that day; it waits here,
 *   folded, rather than piling up in Overdue.
 *
 * A task appears once, in the first group that applies. What is in the list
 * is the query's business; the groups only say when. So the same list is the
 * Tasks view, Home's agenda, and the count in the status bar.
 */

/**
 * A group's id: a placement such as `overdue`, `upcoming:2026-09-28` for a
 * day of Upcoming, `donetoday`, or the value a grouping keys on, such as
 * `priority:high` or `tag:context/phone`.
 */
export type AgendaGroupId = string;

/** The ways the Agenda can be grouped, in the order the picker offers them. */
export const AGENDA_GROUPINGS: readonly {
  id: AgendaGroupBy;
  label: string;
  detail: string;
}[] = [
  {
    id: 'due',
    label: 'Due status',
    detail: 'Overdue, Today, and Upcoming',
  },
  { id: 'priority', label: 'Priority', detail: 'Highest to lowest' },
  { id: 'status', label: 'Status', detail: "The status in each task's box, as [/] is In progress" },
  { id: 'assignee', label: 'Person', detail: 'Who each task is for' },
  {
    id: 'tag',
    label: 'Tag namespace…',
    detail: 'Your own tags, such as #project/… or #context/…, counting the ones a task inherits',
  },
];

/** One task as the Agenda lists it, with what placed it and what to say beside it. */
export interface AgendaEntry {
  task: Task;
  title: string;
  /** Headings above the task, outermost first. */
  context: string[];
  fileName: string;
  /** The date that placed the task in its group. */
  at: number;
  /** Short facts shown beside the title, such as "due Mon 2026-09-14". */
  details: string[];
  /** The task's own steps, done and open, in the order they are written. */
  steps?: Task[];
  /** `2 of 5 steps · next: Draft the email`, for a task with steps. */
  stepsLabel?: string;
}

/** One group of the Agenda, its entries in the order they are shown. */
export interface AgendaGroup {
  id: AgendaGroupId;
  label: string;
  entries: AgendaEntry[];
}

/** The groups by due status, in the order they are shown. */
const GROUP_ORDER: readonly AgendaGroupId[] = [
  'overdue',
  'today',
  'upcoming',
  'later',
  'nodate',
  'needsdate',
];

/** What each due-status group is called. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  later: 'Later',
  nodate: 'No date',
  needsdate: 'Needs a new date',
};

/** What the Agenda is built from, beyond the index and the moment. */
export interface AgendaOptions {
  /**
   * The tasks the Agenda is of — what `selectAgendaTasks` found, or every
   * task in the index when omitted. Completed ones are skipped either way.
   */
  tasks?: Iterable<Task>;
  /** How many days ahead Upcoming reaches; a date past that is Later. */
  upcomingDays: number;
  groupBy?: AgendaGroupBy;
  /** The namespace whose tags are the groups when `groupBy` is `tag`. */
  groupNamespace?: string;
  /** The board's status columns' order, by status name, which By status follows. */
  statusOrder?: readonly string[];
  /**
   * The order a reader dragged their tasks into, from preferences. A task
   * they placed leads its group; the rest follow in the order the group
   * would have had anyway.
   */
  taskOrder?: readonly string[];
  /**
   * How each group orders its tasks before its own order decides:
   * `rank`, the default, is `taskOrder`; the others are the task sorts the
   * Task board's list offers.
   */
  taskSortMode?: TaskSortMode;
  /**
   * Adds a last group, Done today, of the tasks completed today, so the
   * list shows what was finished and not only what is left.
   */
  doneToday?: boolean;
  /**
   * Splits Upcoming into a group per day, Tomorrow, Mon Sep 28, and so on,
   * so a busy Thursday shows before Thursday comes.
   */
  upcomingByDay?: boolean;
}

/**
 * A search as `deckard.tasks.viewQuery` keeps it. The Agenda is of open tasks
 * whatever the query says, so the Task Board's `is:open` — the search it
 * opens on — is the empty query, and `is:open AND …` is the rest.
 */
export function normalizeAgendaQuery(query: string): string {
  return query
    .trim()
    .replace(/^is:open\s+AND\s+/i, '')
    .replace(/^is:open$/i, '')
    .trim();
}

/**
 * The tasks `deckard.tasks.viewQuery` chooses: every task for an empty query,
 * and every task, with the reason, for one that does not parse — a broken
 * setting should not empty the view. The query is evaluated in `context`.
 */
export function selectAgendaTasks(
  index: WorkspaceIndex,
  query: string,
  context: QueryContext,
): { tasks: Task[]; error?: string } {
  // A list of things to do leaves parked tasks out, unless its own search
  // asks about them.
  const text = query.trim();
  if (!text) {
    return { tasks: withoutParked([...index.tasks.values()], index) };
  }
  const parsed = parseQuery(text);
  if (!parsed.node) {
    return {
      tasks: withoutParked([...index.tasks.values()], index),
      error: parsed.diagnostics[0]?.message ?? 'This search does not parse.',
    };
  }
  const tasks = evaluateQuery(index, parsed.node, context).tasks;
  return { tasks: mentionsParked(parsed.node) ? tasks : withoutParked(tasks, index) };
}

/**
 * The open tasks the Tasks view lists as overdue on the context's today, as
 * `settings.query` selects them and with Upcoming reaching
 * `settings.upcomingDays`.
 */
export function selectOverdueTasks(
  index: WorkspaceIndex,
  context: QueryContext,
  settings: { query: string; upcomingDays: number },
): Task[] {
  const selected = selectAgendaTasks(index, settings.query, context);
  return (
    createAgenda(index, context, {
      tasks: selected.tasks,
      upcomingDays: settings.upcomingDays,
    })
      .find((group) => group.id === 'overdue')
      ?.entries.map((entry) => entry.task) ?? []
  );
}

/**
 * Priority groups, strongest first, with the tasks carrying none at the end.
 *
 * A query ranks no priority between medium and low, the way Tasks does, but
 * a reader looking down the Agenda wants what was marked before what was
 * not, so the unmarked group is last.
 */
const PRIORITY_ORDER: readonly (TaskPriority | 'none')[] = [
  'highest',
  'high',
  'medium',
  'low',
  'lowest',
  'none',
];


/** An order of entries, as each group sorts its own. */
type EntryOrder = (left: AgendaEntry, right: AgendaEntry) => number;

/** The days the Agenda is placed against: today's midnight, tomorrow's, and Upcoming's end. */
interface AgendaWindow {
  today: number;
  tomorrow: number;
  horizon: number;
}

/**
 * How the due-status groups order their entries. Today and No date are to-do
 * lists, so importance leads; the other groups read as a timeline, by
 * compareByDate. Overdue runs newest slip first: what slipped yesterday can
 * still be saved, and a month-old task is not news.
 */
const ORDER_BY_GROUP = new Map<AgendaGroupId, EntryOrder>([
  ['today', compareByPriority],
  ['nodate', compareByPriority],
  ['overdue', compareByDateDescending],
]);

/** Regroups the Agenda's entries along another axis than due status. */
type Regrouper = (
  entries: readonly AgendaEntry[],
  index: WorkspaceIndex,
  options: AgendaOptions & { taskPolicy: Pick<TaskPolicy, 'statuses'> },
  order: EntryOrder,
) => AgendaGroup[];

/**
 * The groupings other than by due status. Any other value groups by person,
 * as the Agenda always has for a value it does not know.
 */
const REGROUPERS = new Map<AgendaGroupBy, Regrouper>([
  ['priority', (entries, _index, _options, order) => groupByPriority(entries, order)],
  ['status', (entries, _index, options, order) =>
    groupByStatus(entries, { statuses: options.taskPolicy.statuses, order: options.statusOrder }, order)],
  ['tag', (entries, index, options, order) =>
    groupByTag(entries, index, options.groupNamespace ?? 'project', order)],
]);

/**
 * Builds the Agenda for the context's `now`, with its task policy saying
 * when an overdue task needs a new date. Empty groups are left out.
 */
export function createAgenda(
  index: WorkspaceIndex,
  context: Pick<QueryContext, 'now' | 'taskPolicy'> & Partial<Pick<QueryContext, 'dateFormats'>>,
  options: AgendaOptions,
): AgendaGroup[] {
  const { tasks = index.tasks.values(), upcomingDays, groupBy = 'due', taskOrder = [], taskSortMode = 'rank' } = options;
  const listed = withoutPlainSteps([...tasks]);
  const byRank = sortFirst(taskOrder, taskSortMode);
  const today = startOfDay(context.now);
  const tomorrow = addDays(today, 1);
  const window: AgendaWindow = {
    today,
    tomorrow,
    horizon: addDays(today, Math.max(1, upcomingDays) + 1),
  };
  const openDependencyIds = collectOpenDependencyIds(index);
  const groups = placeOpenTasks(listed, index, context, { window, openDependencyIds });
  const byDue = GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABELS[id] ?? id,
    entries: (groups.get(id) ?? []).sort(byRank(ORDER_BY_GROUP.get(id) ?? compareByDate)),
  })).filter((group) => group.entries.length > 0);
  const done = options.doneToday
    ? createDoneToday(listed, index, { today, tomorrow, openDependencyIds })
    : [];
  if (groupBy === 'due') {
    return [
      ...(options.upcomingByDay
        ? byDue.flatMap((group) =>
            group.id === 'upcoming' ? splitByDay(group.entries, tomorrow, context) : [group],
          )
        : byDue),
      ...done,
    ];
  }
  // The Agenda holds the same tasks whichever way it is grouped. Only the
  // axis changes.
  const entries = byDue.flatMap((group) => group.entries);
  const order = byRank(compareByDate);
  const regroup = REGROUPERS.get(groupBy);
  return [
    ...(regroup ? regroup(entries, index, { ...options, taskPolicy: context.taskPolicy }, order) : groupByAssignee(entries, index, order)),
    ...done,
  ];
}

/**
 * Leaves out the plain steps of open tasks. A plain step rides on its open
 * task's row, so five steps are not five rows, nor five in the count; one
 * with a date, priority, person, or tag of its own is still listed on its own.
 */
function withoutPlainSteps(all: readonly Task[]): Task[] {
  const openIds = new Set(all.filter(isOpenTask).map((task) => task.id));
  return all.filter(
    (task) => task.parentTaskId === undefined || !openIds.has(task.parentTaskId) || !isPlainStep(task),
  );
}

/**
 * Orders by the sort chosen, then by `fallback`, the group's own order. By
 * rank, the tasks a reader dragged into place come first, in the order they
 * left them; the rest follow in the group's order.
 */
function sortFirst(taskOrder: readonly string[], mode: TaskSortMode): (fallback: EntryOrder) => EntryOrder {
  const compare = createTaskComparator(taskOrder, mode);
  return (fallback) => (left, right) => compare(left.task, right.task) || fallback(left, right);
}

/** The 🆔 ids open tasks carry, so a ⛔ naming one is still blocked. */
function collectOpenDependencyIds(index: WorkspaceIndex): Set<string> {
  return new Set(
    [...index.tasks.values()]
      .filter((task) => isOpenTask(task) && task.dependencyId)
      .map((task) => task.dependencyId as string),
  );
}

/** Each open task as an entry in the due-status group placeTask puts it in, in listed order. */
function placeOpenTasks(
  listed: readonly Task[],
  index: WorkspaceIndex,
  context: Pick<QueryContext, 'taskPolicy'> & Partial<Pick<QueryContext, 'dateFormats'>>,
  { window, openDependencyIds }: { window: AgendaWindow; openDependencyIds: ReadonlySet<string> },
): Map<AgendaGroupId, AgendaEntry[]> {
  const groups = new Map<AgendaGroupId, AgendaEntry[]>(
    GROUP_ORDER.map((id) => [id, []]),
  );
  for (const task of listed) {
    if (!isOpenTask(task)) {
      continue;
    }
    const placement = placeTask(task, window, context.taskPolicy, context.dateFormats);
    if (placement) {
      groups
        .get(placement.group)
        ?.push(createEntry(task, index, placement, openDependencyIds));
    }
  }
  return groups;
}

/**
 * Upcoming, one group per day that has tasks, each keeping the group's own
 * order: `upcoming:2026-09-28`, labeled Tomorrow or by its day in the
 * reader's short format, `Mon, Sep 28`.
 */
function splitByDay(
  entries: readonly AgendaEntry[],
  tomorrow: number,
  { now, dateFormats }: Pick<QueryContext, 'now'> & Partial<Pick<QueryContext, 'dateFormats'>>,
): AgendaGroup[] {
  const days = new Map<string, AgendaEntry[]>();
  [...entries]
    .sort((left, right) => startOfDay(left.at) - startOfDay(right.at))
    .forEach((entry) => {
      const date = formatIsoDate(entry.at);
      days.set(date, [...(days.get(date) ?? []), entry]);
    });
  return [...days.entries()].map(([date, held]) => ({
    id: `upcoming:${date}`,
    label: startOfDay(held[0].at) === tomorrow ? 'Tomorrow' : formatDisplayDate(held[0].at, dateFormats, 'short', now),
    entries: entries.filter((entry) => held.includes(entry)),
  }));
}

/**
 * The tasks completed today, by their ✅ date, the latest line first. A task
 * completed with no date written, by hand or by another tool, cannot be
 * counted.
 */
function createDoneToday(
  tasks: readonly Task[],
  index: WorkspaceIndex,
  { today, tomorrow, openDependencyIds }: {
    today: number;
    tomorrow: number;
    openDependencyIds: ReadonlySet<string>;
  },
): AgendaGroup[] {
  const entries = tasks
    .filter(
      (task) =>
        task.completed &&
        task.doneAt !== undefined &&
        task.doneAt >= today &&
        task.doneAt < tomorrow,
    )
    .map((task) =>
      createEntry(task, index, { group: 'donetoday', at: task.doneAt as number, reason: 'done today' }, openDependencyIds),
    )
    .sort((left, right) => compareSource(right, left));
  return entries.length > 0
    ? [{ id: 'donetoday', label: 'Done today', entries }]
    : [];
}

/** Every priority that any entry carries, strongest first. */
function groupByPriority(
  entries: readonly AgendaEntry[],
  order: (left: AgendaEntry, right: AgendaEntry) => number,
): AgendaGroup[] {
  return PRIORITY_ORDER.flatMap((priority) => {
    const held = entries.filter(
      (entry) => (entry.task.priority ?? 'none') === priority,
    );
    return held.length === 0
      ? []
      : [
          {
            id: `priority:${priority}`,
            // The marker the task itself carries, so the group reads the way
            // the line does.
            label:
              priority === 'none'
                ? 'No priority'
                : `${formatTaskMetadata('priority', priority, 'emoji')} ${capitalize(priority)}`,
            entries: [...held].sort(order),
          },
        ];
  });
}

/**
 * Each task's status, its checkbox's, in the board's column order, hidden
 * statuses too, since this is a list and not a board, then a group per
 * character no status names, `Unknown [?]`. A group goes by the key the
 * board's column for it has, so a drop on a group writes what a drop on
 * that column does.
 */
function groupByStatus(
  entries: readonly AgendaEntry[],
  reading: { statuses: TaskPolicy['statuses']; order?: readonly string[] },
  order: (left: AgendaEntry, right: AgendaEntry) => number,
): AgendaGroup[] {
  const held = new Map<string, AgendaEntry[]>();
  entries.forEach((entry) => {
    const key = readTaskColumnKey(entry.task, reading.statuses);
    held.set(key, [...(held.get(key) ?? []), entry]);
  });
  const columns = [
    ...orderOpenStatuses(reading.statuses, reading.order ? { order: reading.order } : {}),
    ...listUnknownColumns(entries.map((entry) => entry.task), reading.statuses).map((column) => ({ ...column, name: `${column.name} [${column.symbol}]` })),
  ];
  return columns.flatMap((column) => {
    const group = held.get(column.key);
    return group ? [{ id: column.key, label: column.name, entries: [...group].sort(order) }] : [];
  });
}

/**
 * The tags of one namespace, busiest first, with the tasks carrying none
 * last. A tag counts whether it is on the task's line, a heading above it, or
 * its note's front matter; a task with two is in both groups, and says
 * "also in" the other. Group ids are the board's columns: `tag:context/phone`,
 * and `tag:context/` for none.
 */
export function groupByTag(
  entries: readonly AgendaEntry[],
  index: WorkspaceIndex,
  namespace: string,
  order: (left: AgendaEntry, right: AgendaEntry) => number,
): AgendaGroup[] {
  const name = namespace.toLowerCase();
  const held = new Map<string, { label: string; entries: AgendaEntry[] }>();
  const none: AgendaEntry[] = [];
  entries.forEach((entry) => {
    const values = readNamespaceValues(index, entry.task, name);
    if (values.length === 0) {
      none.push(entry);
      return;
    }
    const labels = values.map((value) =>
      formatNamespaceValue(labelValue(index.tags.get(value.key)?.label ?? value.label)),
    );
    values.forEach((value, at) => {
      const others = labels.filter((_, other) => other !== at);
      const group = held.get(value.value) ?? { label: labels[at], entries: [] };
      group.entries.push(
        others.length > 0
          ? { ...entry, details: [...entry.details, `also in ${others.join(', ')}`] }
          : entry,
      );
      held.set(value.value, group);
    });
  });
  const groups = [...held.entries()]
    .sort(
      (left, right) =>
        right[1].entries.length - left[1].entries.length ||
        left[1].label.localeCompare(right[1].label),
    )
    .map(([value, group]) => ({
      id: `tag:${name}/${value}`,
      label: group.label,
      entries: [...group.entries].sort(order),
    }));
  return none.length > 0
    ? [...groups, { id: `tag:${name}/`, label: noValueLabel(name), entries: [...none].sort(order) }]
    : groups;
}

/** Who each task is for, busiest first, with the unnamed ones last. */
function groupByAssignee(
  entries: readonly AgendaEntry[],
  index: WorkspaceIndex,
  order: (left: AgendaEntry, right: AgendaEntry) => number,
): AgendaGroup[] {
  return collect(
    entries,
    (entry) => entry.task.assignee ?? '',
    (key) => (key ? (index.tags.get(key)?.label ?? key) : 'Nobody named'),
    order,
  );
}

/**
 * Groups entries by a key, busiest group first, with the group of entries
 * that have no key of their own last however many it holds.
 */
function collect(
  entries: readonly AgendaEntry[],
  keyOf: (entry: AgendaEntry) => string,
  labelOf: (key: string) => string,
  order: (left: AgendaEntry, right: AgendaEntry) => number,
): AgendaGroup[] {
  const held = new Map<string, AgendaEntry[]>();
  entries.forEach((entry) => {
    const key = keyOf(entry);
    held.set(key, [...(held.get(key) ?? []), entry]);
  });
  return [...held.entries()]
    .sort(
      (left, right) =>
        Number(left[0] === '') - Number(right[0] === '') ||
        right[1].length - left[1].length ||
        labelOf(left[0]).localeCompare(labelOf(right[0])),
    )
    .map(([key, group]) => ({
      id: `${key || 'none'}`,
      label: labelOf(key),
      entries: [...group].sort(order),
    }));
}

/** A word with its first letter capitalized, as a group label begins. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A task as an entry: its title without trailing tags, the headings above
 * it, and the details beside it, which are why it was placed, its priority,
 * the open tasks it waits on, its steps, and its note.
 */
function createEntry(
  task: Task,
  index: WorkspaceIndex,
  placement: Placement,
  openDependencyIds: ReadonlySet<string>,
): AgendaEntry {
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
  const fileName = task.filePath.split('/').pop() ?? task.filePath;
  const blockers = (task.dependsOn ?? []).filter((id) =>
    openDependencyIds.has(id),
  );
  const stepsLabel = task.steps ? describeSteps(task.steps) : undefined;
  const steps = task.steps?.ids
    .map((id) => index.tasks.get(id))
    .filter((step): step is Task => step !== undefined);
  return {
    task,
    title: stripTrailingTags(task.title) || task.title,
    context: section ? getHeadingPath(section, index.sections) : [],
    fileName,
    at: placement.at,
    details: [
      placement.reason,
      task.priority ? `${task.priority} priority` : '',
      blockers.length > 0 ? `blocked by ${blockers.join(', ')}` : '',
      stepsLabel ?? '',
      fileName,
    ].filter(Boolean),
    ...(steps && steps.length > 0 ? { steps } : {}),
    ...(stepsLabel ? { stepsLabel } : {}),
  };
}

/** The timeline order: soonest date first, then higher priority, then source order. */
function compareByDate(left: AgendaEntry, right: AgendaEntry): number {
  return (
    left.at - right.at ||
    comparePriority(left, right) ||
    compareSource(left, right)
  );
}

/** Latest date first, then higher priority, then source order: Overdue's newest slip first. */
function compareByDateDescending(left: AgendaEntry, right: AgendaEntry): number {
  return (
    right.at - left.at ||
    comparePriority(left, right) ||
    compareSource(left, right)
  );
}

/** The to-do order: higher priority first, then soonest date, then source order. */
function compareByPriority(left: AgendaEntry, right: AgendaEntry): number {
  return (
    comparePriority(left, right) ||
    left.at - right.at ||
    compareSource(left, right)
  );
}

/** Higher priority first; no priority ranks between medium and low, as a query ranks it. */
function comparePriority(left: AgendaEntry, right: AgendaEntry): number {
  return (
    TASK_PRIORITY_RANKS[right.task.priority ?? 'none'] -
    TASK_PRIORITY_RANKS[left.task.priority ?? 'none']
  );
}

/** Source order: by file path, then line. */
function compareSource(left: AgendaEntry, right: AgendaEntry): number {
  return (
    left.task.filePath.localeCompare(right.task.filePath) ||
    left.task.lineNumber - right.task.lineNumber
  );
}
