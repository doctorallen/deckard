import {
  addDays,
  formatIsoDate,
  startOfDay,
  TASK_PRIORITY_RANKS,
} from '../../core/markdown/taskMetadata';
import { Task, WorkspaceIndex } from '../../core/types';
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
 *
 * A task appears once, in the first group that applies.
 */

export type AgendaGroupId = 'overdue' | 'today' | 'upcoming';

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

const GROUP_ORDER: readonly AgendaGroupId[] = ['overdue', 'today', 'upcoming'];

const GROUP_LABELS: Readonly<Record<AgendaGroupId, string>> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
): AgendaGroup[] {
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
    const placement = placeTask(task, today, tomorrow, horizon);
    if (placement) {
      groups
        .get(placement.group)
        ?.push(createEntry(task, index, placement, openDependencyIds));
    }
  }

  return GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABELS[id],
    // Today is a to-do list, so importance leads; the other groups read as a
    // timeline.
    entries: (groups.get(id) ?? []).sort(
      id === 'today' ? compareByPriority : compareByDate,
    ),
  })).filter((group) => group.entries.length > 0);
}

function placeTask(
  task: Task,
  today: number,
  tomorrow: number,
  horizon: number,
): Placement | undefined {
  const { dueAt, scheduledAt, startAt } = task;
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
