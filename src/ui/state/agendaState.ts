import {
  addDays,
  formatIsoDate,
  formatTaskMetadata,
  startOfDay,
  TASK_PRIORITY_RANKS,
} from '../../core/markdown/taskMetadata';
import { Task, TaskPriority, WorkspaceIndex } from '../../core/types';
import { getHeadingPath } from './dashboardState';
import { stripTrailingTags } from './queryBlockState';

/**
 * The Agenda groups open tasks by when they need attention, using the dates
 * of the Obsidian Tasks format and Deckard's own due dates:
 *
 * - **Overdue**: the due date has passed.
 * - **Today**: due today, or scheduled for today or earlier and already
 *   started.
 * - **Upcoming**: due, scheduled, or starting within the next few days.
 * - **No date**: open, but carrying no due, scheduled, or start date at all.
 *   The Agenda is a list of what is wanted, and a task nobody dated is still
 *   wanted; it waits at the end rather than going unseen. Callers ask for it,
 *   because the Agenda also feeds counts that mean "due".
 *
 * A task appears once, in the first group that applies.
 */

export type AgendaGroupId = string;

/** What the Agenda's groups are: when a task is wanted, or what it carries. */
export type AgendaGroupBy = 'due' | 'priority' | 'status' | 'assignee';

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
  { id: 'status', label: 'Status', detail: 'The #status/… tag on each task' },
  { id: 'assignee', label: 'Person', detail: 'Who each task is for' },
];

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
}

export interface AgendaGroup {
  id: AgendaGroupId;
  label: string;
  entries: AgendaEntry[];
}

const GROUP_ORDER: readonly AgendaGroupId[] = [
  'overdue',
  'today',
  'upcoming',
  'nodate',
];

const GROUP_LABELS: Readonly<Record<string, string>> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  nodate: 'No date',
};

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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The date an undated task sorts by. Nothing placed it, so it sorts after
 * everything a date placed, in whichever grouping mixes the two.
 */
const NO_DATE = Number.MAX_SAFE_INTEGER;

interface Placement {
  group: AgendaGroupId;
  at: number;
  reason: string;
}

/**
 * Builds the Agenda for `now`, looking `upcomingDays` ahead for Upcoming.
 * Empty groups are left out.
 */
export function createAgenda(
  index: WorkspaceIndex,
  now: number,
  upcomingDays: number,
  groupBy: AgendaGroupBy = 'due',
  statusNamespace = 'status',
  /**
   * The order a reader dragged their tasks into, from preferences. A task
   * they placed leads its group; the rest follow in the order the group
   * would have had anyway.
   */
  taskOrder: readonly string[] = [],
  /**
   * Whether open tasks carrying no date join the Agenda in a No date group.
   * Off by default, so the counts that mean "due" stay about dates.
   */
  includeUndated = false,
): AgendaGroup[] {
  const ranked = new Map(taskOrder.map((taskId, at) => [taskId, at]));
  const byRank =
    (fallback: (left: AgendaEntry, right: AgendaEntry) => number) =>
    (left: AgendaEntry, right: AgendaEntry): number => {
      const leftRank = ranked.get(left.task.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = ranked.get(right.task.id) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || fallback(left, right);
    };
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const horizon = addDays(today, Math.max(1, upcomingDays) + 1);
  const openDependencyIds = new Set(
    [...index.tasks.values()]
      .filter((task) => !task.completed && task.dependencyId)
      .map((task) => task.dependencyId as string),
  );

  const groups = new Map<AgendaGroupId, AgendaEntry[]>(
    GROUP_ORDER.map((id) => [id, []]),
  );
  for (const task of index.tasks.values()) {
    if (task.completed) {
      continue;
    }
    const placement = placeTask(task, today, tomorrow, horizon, includeUndated);
    if (placement) {
      groups
        .get(placement.group)
        ?.push(createEntry(task, index, placement, openDependencyIds));
    }
  }

  const byDue = GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABELS[id] ?? id,
    // Today and No date are to-do lists, so importance leads; the other
    // groups read as a timeline.
    entries: (groups.get(id) ?? []).sort(
      byRank(
        id === 'today' || id === 'nodate' ? compareByPriority : compareByDate,
      ),
    ),
  })).filter((group) => group.entries.length > 0);
  if (groupBy === 'due') {
    return byDue;
  }
  // The Agenda holds the same tasks whichever way it is grouped: the open
  // ones wanted within its horizon. Only the axis changes.
  const entries = byDue.flatMap((group) => group.entries);
  const order = byRank(compareByDate);
  return groupBy === 'priority'
    ? groupByPriority(entries, order)
    : groupBy === 'status'
      ? groupByStatus(entries, statusNamespace, order)
      : groupByAssignee(entries, index, order);
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

/** The status written on each task's own line, busiest status first. */
function groupByStatus(
  entries: readonly AgendaEntry[],
  namespace: string,
  order: (left: AgendaEntry, right: AgendaEntry) => number,
): AgendaGroup[] {
  const prefix = `#${namespace.toLowerCase()}/`;
  const statusOf = (entry: AgendaEntry): string =>
    (entry.task.associationTagGroups?.[0] ?? [])
      .map((tag) => tag.key.toLowerCase())
      .find((key) => key.startsWith(prefix))
      ?.slice(prefix.length) ?? '';
  return collect(
    entries,
    statusOf,
    (status) => (status ? capitalize(status.replace(/[-_]+/g, ' ')) : 'No status'),
    order,
  );
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function placeTask(
  task: Task,
  today: number,
  tomorrow: number,
  horizon: number,
  includeUndated: boolean,
): Placement | undefined {
  const { dueAt, scheduledAt, startAt } = task;
  if (
    dueAt === undefined &&
    scheduledAt === undefined &&
    startAt === undefined
  ) {
    // No date to read, so no date to show: the entry carries its priority and
    // its note instead.
    return includeUndated
      ? { group: 'nodate', at: NO_DATE, reason: '' }
      : undefined;
  }
  if (dueAt !== undefined && dueAt < today) {
    return { group: 'overdue', at: dueAt, reason: `due ${formatDay(dueAt)}` };
  }
  if (dueAt !== undefined && dueAt < tomorrow) {
    return { group: 'today', at: dueAt, reason: 'due today' };
  }

  // A future start date means the task is not actionable yet, however early
  // it was scheduled.
  const started = startAt === undefined || startAt < tomorrow;
  if (started && scheduledAt !== undefined && scheduledAt < tomorrow) {
    return {
      group: 'today',
      at: scheduledAt,
      reason:
        scheduledAt < today
          ? `scheduled ${formatDay(scheduledAt)}`
          : 'scheduled today',
    };
  }

  const soonest = [
    { at: dueAt, verb: 'due' },
    { at: scheduledAt, verb: 'scheduled' },
    { at: startAt, verb: 'starts' },
  ]
    .filter(
      (candidate): candidate is { at: number; verb: string } =>
        candidate.at !== undefined &&
        candidate.at >= tomorrow &&
        candidate.at < horizon,
    )
    .sort((left, right) => left.at - right.at)[0];
  return soonest
    ? {
        group: 'upcoming',
        at: soonest.at,
        reason: `${soonest.verb} ${formatDay(soonest.at)}`,
      }
    : undefined;
}

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
      fileName,
    ].filter(Boolean),
  };
}

function compareByDate(left: AgendaEntry, right: AgendaEntry): number {
  return (
    left.at - right.at ||
    comparePriority(left, right) ||
    compareSource(left, right)
  );
}

function compareByPriority(left: AgendaEntry, right: AgendaEntry): number {
  return (
    comparePriority(left, right) ||
    left.at - right.at ||
    compareSource(left, right)
  );
}

function comparePriority(left: AgendaEntry, right: AgendaEntry): number {
  return (
    TASK_PRIORITY_RANKS[right.task.priority ?? 'none'] -
    TASK_PRIORITY_RANKS[left.task.priority ?? 'none']
  );
}

function compareSource(left: AgendaEntry, right: AgendaEntry): number {
  return (
    left.task.filePath.localeCompare(right.task.filePath) ||
    left.task.lineNumber - right.task.lineNumber
  );
}

/** Writes a date as "Mon 2026-09-14", so a week reads at a glance. */
function formatDay(at: number): string {
  return `${WEEKDAYS[new Date(at).getDay()]} ${formatIsoDate(at)}`;
}
