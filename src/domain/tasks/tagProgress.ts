/**
 * How far along a tag's tasks are: how many are done, how many are overdue,
 * and which open one is due next. A project's page, its hub note, and Home's
 * Progress widget read it, so all three count a project alike.
 */
import { formatProgressCount } from './progressCount';
import { readTaskTagKeys } from '../query/queryEvaluator';
import { describeDueDate } from '../markdown/dueWording';
import { startOfDay } from '../markdown/calendar';
import type { Task, WorkspaceIndex } from '../model';
import { DEFAULT_TASK_POLICY, needsNewDate, type TaskPolicy } from './taskPolicy';

/** The open task a tag's progress says is due next. */
export interface TagProgressNextDue {
  taskId: string;
  title: string;
  dueAt: number;
  dueText?: string;
  filePath: string;
  lineNumber: number;
}

/** How far along one tag's tasks are. */
export interface TagProgress {
  /** Every task the tag finds, steps aside. */
  total: number;
  done: number;
  /**
   * Open tasks whose due date has passed, those that need a new date aside,
   * as Home's Overdue figure counts them.
   */
  overdue: number;
  /** Open tasks so far past their due date that they need a new one. */
  needsDate: number;
  /** The open task due soonest, today or later. */
  nextDue?: TagProgressNextDue;
}

/**
 * Each tag's progress, by tag key, over the tasks a `tag:` search finds by
 * it: the task's own tags, its headings', and its note's front matter. A
 * step, a checkbox under another task, is part of its task rather than a
 * task of the project, so it is not counted, nor is a parked task, which is
 * set aside. With `tagKeys`, only those tags are counted; a tag with no task
 * is left out.
 */
export function collectTagProgress(
  index: WorkspaceIndex,
  now: number,
  tagKeys?: ReadonlySet<string>,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'> = DEFAULT_TASK_POLICY,
): Map<string, TagProgress> {
  const today = startOfDay(now);
  const progress = new Map<string, TagProgress>();
  for (const task of index.tasks.values()) {
    if (task.parentTaskId || index.parked?.tasks.has(task.id)) {
      continue;
    }
    for (const tagKey of readTaskTagKeys(index, task)) {
      if (tagKeys && !tagKeys.has(tagKey)) {
        continue;
      }
      let entry = progress.get(tagKey);
      if (!entry) {
        entry = { total: 0, done: 0, overdue: 0, needsDate: 0 };
        progress.set(tagKey, entry);
      }
      countTask(entry, task, today, (dueAt) => needsNewDate(dueAt, now, taskPolicy));
    }
  }
  return progress;
}

/** One tag's progress, or undefined when it finds no task. */
export function computeTagProgress(
  index: WorkspaceIndex,
  tagKey: string,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'> = DEFAULT_TASK_POLICY,
): TagProgress | undefined {
  return collectTagProgress(index, now, new Set([tagKey]), taskPolicy).get(tagKey);
}

/**
 * How far along a list of tasks is, as a tag's progress counts its tasks,
 * steps aside: one note's own tasks, for its page. Undefined when there are
 * none to count.
 */
export function summarizeTasks(
  tasks: readonly Task[],
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'> = DEFAULT_TASK_POLICY,
): TagProgress | undefined {
  const today = startOfDay(now);
  const entry: TagProgress = { total: 0, done: 0, overdue: 0, needsDate: 0 };
  for (const task of tasks) {
    if (!task.parentTaskId) {
      countTask(entry, task, today, (dueAt) => needsNewDate(dueAt, now, taskPolicy));
    }
  }
  return entry.total ? entry : undefined;
}

/** Adds one task to a tag's progress. */
function countTask(entry: TagProgress, task: Task, today: number, stale: (dueAt: number) => boolean): void {
  entry.total += 1;
  if (task.completed) {
    entry.done += 1;
    return;
  }
  if (task.dueAt === undefined) {
    return;
  }
  if (task.dueAt < today) {
    if (stale(task.dueAt)) {
      entry.needsDate += 1;
    } else {
      entry.overdue += 1;
    }
    return;
  }
  if (!entry.nextDue || task.dueAt < entry.nextDue.dueAt) {
    entry.nextDue = {
      taskId: task.id,
      title: task.title,
      dueAt: task.dueAt,
      ...(task.dueText ? { dueText: task.dueText } : {}),
      filePath: task.filePath,
      lineNumber: task.lineNumber,
    };
  }
}

/** The share of a tag's tasks that are done, 0 to 1. */
export function progressRatio(progress: Pick<TagProgress, 'done' | 'total'>): number {
  return progress.total > 0 ? progress.done / progress.total : 0;
}

/**
 * A tag's progress in words, as a hub note's lens, a tag's page, and Home
 * say it: "3/8 done (38%) · 1 overdue · 1 needs a new date · next due in 3
 * days". Each part after the first is there only when it has something to
 * say.
 */
export function describeTagProgress(
  progress: TagProgress,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
): string {
  return describeTagProgressParts(progress, now, taskPolicy).map((part) => part.text).join(' · ');
}

/** What one part of a tag's progress words counts: which tasks a search for it would list. */
export type TagProgressPartKind = 'done' | 'overdue' | 'needsDate' | 'nextDue' | 'allDone';

/** One part of a tag's progress words, and what it counts. */
export interface TagProgressPart {
  kind: TagProgressPartKind;
  text: string;
}

/** A tag's progress words, part by part, in the order `describeTagProgress` joins them. */
export function describeTagProgressParts(
  progress: TagProgress,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
): TagProgressPart[] {
  const parts: TagProgressPart[] = [{ kind: 'done', text: formatProgressCount(progress.done, progress.total) }];
  if (progress.overdue > 0) {
    parts.push({ kind: 'overdue', text: `${progress.overdue} overdue` });
  }
  if (progress.needsDate > 0) {
    parts.push({ kind: 'needsDate', text: `${progress.needsDate} ${progress.needsDate === 1 ? 'needs' : 'need'} a new date` });
  }
  if (progress.nextDue) {
    const due = describeDueDate(progress.nextDue.dueAt, now, taskPolicy, progress.nextDue.dueText);
    parts.push({ kind: 'nextDue', text: due.relative === 'due' ? `next ${due.label}` : `next ${due.relative}` });
  } else if (progress.done === progress.total) {
    parts.push({ kind: 'allDone', text: 'all done' });
  }
  return parts;
}
