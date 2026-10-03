/**
 * How far along a tag's tasks are: how many are done, how many are overdue,
 * and which open one is due next. A project's page, its hub note, and Home's
 * Progress widget read it, so all three count a project alike.
 */
import { readTaskTagKeys } from '../query/queryEvaluator';
import { describeDueDate } from '../markdown/dueWording';
import { startOfDay } from '../markdown/calendar';
import type { Task, WorkspaceIndex } from '../model';
import type { TaskPolicy } from './taskPolicy';

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
  /** Open tasks whose due date has passed. */
  overdue: number;
  /** The open task due soonest, today or later. */
  nextDue?: TagProgressNextDue;
}

/**
 * Each tag's progress, by tag key, over the tasks a `tag:` search finds by
 * it: the task's own tags, its headings', and its note's front matter. A
 * step, a checkbox under another task, is part of its task rather than a
 * task of the project, so it is not counted. With `tagKeys`, only those
 * tags are counted; a tag with no task is left out.
 */
export function collectTagProgress(
  index: WorkspaceIndex,
  now: number,
  tagKeys?: ReadonlySet<string>,
): Map<string, TagProgress> {
  const today = startOfDay(now);
  const progress = new Map<string, TagProgress>();
  for (const task of index.tasks.values()) {
    if (task.parentTaskId) {
      continue;
    }
    for (const tagKey of readTaskTagKeys(index, task)) {
      if (tagKeys && !tagKeys.has(tagKey)) {
        continue;
      }
      let entry = progress.get(tagKey);
      if (!entry) {
        entry = { total: 0, done: 0, overdue: 0 };
        progress.set(tagKey, entry);
      }
      countTask(entry, task, today);
    }
  }
  return progress;
}

/** One tag's progress, or undefined when it finds no task. */
export function computeTagProgress(
  index: WorkspaceIndex,
  tagKey: string,
  now: number,
): TagProgress | undefined {
  return collectTagProgress(index, now, new Set([tagKey])).get(tagKey);
}

/** Adds one task to a tag's progress. */
function countTask(entry: TagProgress, task: Task, today: number): void {
  entry.total += 1;
  if (task.completed) {
    entry.done += 1;
    return;
  }
  if (task.dueAt === undefined) {
    return;
  }
  if (task.dueAt < today) {
    entry.overdue += 1;
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
 * say it: "3 of 8 done · 1 overdue · next due in 3 days". Each part after
 * the first is there only when it has something to say.
 */
export function describeTagProgress(
  progress: TagProgress,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'>,
): string {
  const parts = [`${progress.done} of ${progress.total} done`];
  if (progress.overdue > 0) {
    parts.push(`${progress.overdue} overdue`);
  }
  if (progress.nextDue) {
    const due = describeDueDate(progress.nextDue.dueAt, now, taskPolicy, progress.nextDue.dueText);
    parts.push(due.relative === 'due' ? `next ${due.label}` : `next ${due.relative}`);
  } else if (progress.done === progress.total) {
    parts.push('all done');
  }
  return parts.join(' · ');
}
