import { SHORT_WEEKDAY_NAMES, formatIsoDate } from '../markdown/calendar';
import { Task } from '../model';
import { needsNewDate, TaskPolicy } from './taskPolicy';

/**
 * Where one open task sits on the agenda: the rule behind every task view.
 *
 * The Tasks view, Home's agenda, the status bar's count, and `is:today` all
 * place a task with this, so a task that is overdue in one is overdue in
 * every one.
 */

/**
 * The date an undated task sorts by. Nothing placed it, so it sorts after
 * everything a date placed, in whichever grouping mixes the two.
 */
export const NO_DATE = Number.MAX_SAFE_INTEGER;

/** The group one task was placed in, the date that put it there, and why. */
export interface Placement {
  /** `overdue`, `today`, `upcoming`, `later`, `nodate`, or `needsdate`. */
  group: string;
  at: number;
  /** The words that say why, such as `due Mon 2026-09-14`; empty for no date. */
  reason: string;
}

/** The days a task is placed against: today, tomorrow, and where Later begins. */
export interface AgendaDays {
  today: number;
  tomorrow: number;
  horizon: number;
}

/**
 * The group one open task belongs in on `days.today`, the date that put it
 * there, and the words that say why.
 */
export function placeTask(
  task: Task,
  days: AgendaDays,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
): Placement {
  const { dueAt, scheduledAt, startAt } = task;
  if (
    dueAt === undefined &&
    scheduledAt === undefined &&
    startAt === undefined
  ) {
    // No date to read, so no date to show: the entry carries its priority and
    // its note instead.
    return { group: 'nodate', at: NO_DATE, reason: '' };
  }
  return (
    placeByDue(dueAt, days, taskPolicy) ??
    placeBySchedule(task, days) ??
    placeAhead(task, days)
  );
}

/** A due date that has come: past the policy's patience, past, or today. */
function placeByDue(
  dueAt: number | undefined,
  { today, tomorrow }: AgendaDays,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
): Placement | undefined {
  if (dueAt === undefined) {
    return undefined;
  }
  if (needsNewDate(dueAt, today, taskPolicy)) {
    return { group: 'needsdate', at: dueAt, reason: `was due ${formatDay(dueAt)}` };
  }
  if (dueAt < today) {
    return { group: 'overdue', at: dueAt, reason: `due ${formatDay(dueAt)}` };
  }
  if (dueAt < tomorrow) {
    return { group: 'today', at: dueAt, reason: 'due today' };
  }
  return undefined;
}

/** A task scheduled for today or earlier, once it has started. */
function placeBySchedule(
  { scheduledAt, startAt }: Task,
  { today, tomorrow }: AgendaDays,
): Placement | undefined {
  // A future start date means the task is not actionable yet, however early
  // it was scheduled.
  const started = startAt === undefined || startAt < tomorrow;
  if (!(started && scheduledAt !== undefined && scheduledAt < tomorrow)) {
    return undefined;
  }
  return {
    group: 'today',
    at: scheduledAt,
    reason:
      scheduledAt < today
        ? `scheduled ${formatDay(scheduledAt)}`
        : 'scheduled today',
  };
}

/**
 * The first date still to come places the task: within the horizon it is
 * Upcoming, past it Later. A task nothing here placed — scheduled in the
 * past, say, but not started until after the horizon — is Later by the
 * date it waits for.
 */
function placeAhead(
  { dueAt, scheduledAt, startAt }: Task,
  { tomorrow, horizon }: AgendaDays,
): Placement {
  const ahead = [
    { at: dueAt, verb: 'due' },
    { at: scheduledAt, verb: 'scheduled' },
    { at: startAt, verb: 'starts' },
  ]
    .filter(
      (candidate): candidate is { at: number; verb: string } =>
        candidate.at !== undefined && candidate.at >= tomorrow,
    )
    .sort((left, right) => left.at - right.at);
  const soonest = ahead[0] ?? { at: startAt ?? NO_DATE, verb: 'starts' };
  return {
    group: soonest.at < horizon ? 'upcoming' : 'later',
    at: soonest.at,
    reason: `${soonest.verb} ${formatDay(soonest.at)}`,
  };
}

/** Writes a date as "Mon 2026-09-14", so a week reads at a glance. */
export function formatDay(at: number): string {
  return `${SHORT_WEEKDAY_NAMES[new Date(at).getDay()]} ${formatIsoDate(at)}`;
}
