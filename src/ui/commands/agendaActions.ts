import * as vscode from 'vscode';

import {
  addDays,
  formatIsoDate,
  setTaskDate,
  startOfDay,
  TASK_PRIORITY_RANKS,
} from '../../core/markdown/taskMetadata';
import { Task } from '../../core/types';
import { applyBulkEdit, reportBulkEditResult } from './bulkEdit';
import { askForDate } from './datePrompt';
import {
  quoteTaskTitle,
  readTaskMetadataFormat,
  updateTaskLine,
} from './taskActions';

/**
 * Dating tasks from where they are listed.
 *
 * The Tasks view is the list read most often, and it could only complete a
 * task: moving one to tomorrow meant opening its note and finding its line.
 * Its items take the same dates the Task board's menu does, and more, and a
 * group takes one date for everything in it, which is how a morning's
 * overdue tasks are cleared without editing each.
 */

/** The dates offered by name, beside one typed in plain words. */
export type DueChoice = 'today' | 'tomorrow' | 'nextWeek';

/**
 * The date a named choice means, as `YYYY-MM-DD`. `nextWeek` is the next
 * Monday, and never today: on a Monday it is the Monday after.
 */
export function dueDateFor(choice: DueChoice, now: number = Date.now()): string {
  const today = startOfDay(now);
  if (choice === 'today') {
    return formatIsoDate(today);
  }
  if (choice === 'tomorrow') {
    return formatIsoDate(addDays(today, 1));
  }
  const weekday = new Date(today).getDay();
  return formatIsoDate(addDays(today, ((8 - weekday) % 7) || 7));
}

/**
 * Asks for a date in plain words: `friday`, `oct 3`, `in 3 days`.
 *
 * Returns the date, `undefined` for an empty answer, which clears the date,
 * or `null` when the box was closed.
 */
export async function askForDueDate(
  subject: string,
): Promise<string | undefined | null> {
  const read = await askForDate({ title: `Due date for ${subject}` });
  return read === undefined ? null : read.date;
}

/** How full a day is: the open tasks due on it and scheduled for it. */
export interface DayLoad {
  due: number;
  scheduled: number;
}

/**
 * What a reschedule reads beside the choices and after the write: how full
 * a day is, and how many tasks Today holds once the index has caught up.
 */
export interface RescheduleContext {
  load(date: string): DayLoad;
  /** Reads the index again after a write, so the load said is true. */
  refresh(): Promise<void>;
  /** The Tasks view's Today group, as the status bar counts it. */
  todayCount(): number;
}

/** A day's load in words: `3 due · 1 scheduled`, or `nothing due`. */
export function describeLoad(load: DayLoad): string {
  const parts = [
    load.due > 0 ? `${load.due} due` : '',
    load.scheduled > 0 ? `${load.scheduled} scheduled` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing due';
}

/** The open tasks due on, and scheduled for, a day. */
export function countLoad(tasks: Iterable<Task>, date: string): DayLoad {
  let due = 0;
  let scheduled = 0;
  for (const task of tasks) {
    if (task.completed) {
      continue;
    }
    if (task.dueAt !== undefined && formatIsoDate(task.dueAt) === date) {
      due += 1;
    }
    if (task.scheduledAt !== undefined && formatIsoDate(task.scheduledAt) === date) {
      scheduled += 1;
    }
  }
  return { due, scheduled };
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A date as the Tasks view writes it: `Fri 2026-09-25`. */
export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()]} ${date}`;
}

/** Oldest due first, then the more important, then where they are written. */
function compareForPlanning(left: Task, right: Task): number {
  return (
    (left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.dueAt ?? Number.MAX_SAFE_INTEGER) ||
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] - TASK_PRIORITY_RANKS[left.priority ?? 'none'] ||
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber
  );
}

/**
 * Spreads tasks over the next five weekdays, from today, or from Monday on a
 * weekend: oldest due first, in blocks, the earlier days taking any left
 * over, so 17 tasks are 4, 4, 3, 3, 3.
 */
export function planSpread(tasks: readonly Task[], now: number = Date.now()): Map<string, string> {
  const days: string[] = [];
  for (let at = startOfDay(now); days.length < 5; at = addDays(at, 1)) {
    const weekday = new Date(at).getDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(formatIsoDate(at));
    }
  }
  const ordered = [...tasks].sort(compareForPlanning);
  const base = Math.floor(ordered.length / days.length);
  const extra = ordered.length % days.length;
  const dates = new Map<string, string>();
  let next = 0;
  days.forEach((date, index) => {
    const take = base + (index < extra ? 1 : 0);
    ordered.slice(next, next + take).forEach((task) => dates.set(task.id, date));
    next += take;
  });
  return dates;
}

/**
 * Three for today, the rest next Monday: the three most important, oldest
 * due first among equals, stay today, and the others move to the next week.
 */
export function planThreeToday(tasks: readonly Task[], now: number = Date.now()): Map<string, string> {
  const ordered = [...tasks].sort(
    (left, right) =>
      TASK_PRIORITY_RANKS[right.priority ?? 'none'] - TASK_PRIORITY_RANKS[left.priority ?? 'none'] ||
      compareForPlanning(left, right),
  );
  const today = dueDateFor('today', now);
  const later = dueDateFor('nextWeek', now);
  return new Map(ordered.map((task, index) => [task.id, index < 3 ? today : later]));
}

/** What a reschedule chose: one date for all, or a date for each. */
export type RescheduleChoice =
  | { kind: 'one'; date: string | undefined }
  | { kind: 'each'; plan: 'spread' | 'threeToday'; dates: Map<string, string> };

/** The sentence a bulk move ends with: how full the day now is. */
export function describeLoadAfter(
  date: string | undefined,
  now: number,
  counts: { today: number; due: number },
): string {
  if (!date) {
    return '';
  }
  const tasks = (count: number): string => `${count} ${count === 1 ? 'task' : 'tasks'}`;
  return date === dueDateFor('today', now)
    ? `Today now has ${tasks(counts.today)}.`
    : `${formatDay(date)} now has ${tasks(counts.due)} due.`;
}

/**
 * Writes one due date on every task. One task is one line, offered back with
 * an Undo; several are one write, previewed as any multi-note write is and
 * taken back by Undo Last Change.
 */
export async function setTasksDue(
  tasks: readonly Task[],
  date: string | undefined,
  context?: RescheduleContext,
): Promise<void> {
  const open = tasks.filter((task) => !task.completed);
  if (open.length === 0) {
    return;
  }
  if (open.length === 1) {
    const [task] = open;
    await updateTaskLine(
      task,
      (line, { uri }) =>
        setTaskDate(
          line,
          task.checkboxColumn,
          'due',
          date,
          readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard', uri)),
        ),
      date
        ? `${quoteTaskTitle(task)} is due ${date}.`
        : `${quoteTaskTitle(task)} has no due date now.`,
    );
    return;
  }
  const edit = { kind: 'due' as const, date };
  const result = await applyBulkEdit(
    open.map((task) => ({ kind: 'task' as const, task })),
    edit,
  );
  if (!result) {
    return;
  }
  let message = '';
  if (context && result.changed > 0 && date) {
    // Read after the write, so the day's load is what it now is.
    await context.refresh();
    const now = Date.now();
    message += ` ${describeLoadAfter(date, now, {
      today: context.todayCount(),
      due: context.load(date).due,
    })}`;
  }
  reportBulkEditResult(edit, result, message);
}

/**
 * Writes a date for each task, as a spread or three-for-today chose them,
 * as one write, and says where they went and how full today now is.
 */
export async function setTasksDueEach(
  choice: Extract<RescheduleChoice, { kind: 'each' }>,
  tasks: readonly Task[],
  context?: RescheduleContext,
): Promise<void> {
  const open = tasks.filter((task) => !task.completed && choice.dates.has(task.id));
  if (open.length === 0) {
    return;
  }
  const edit = { kind: 'dueEach' as const, dates: choice.dates };
  const result = await applyBulkEdit(
    open.map((task) => ({ kind: 'task' as const, task })),
    edit,
  );
  if (!result) {
    return;
  }
  if (result.changed === 0) {
    reportBulkEditResult(edit, result);
    return;
  }
  if (context) {
    await context.refresh();
  }
  const notes = `${result.notes} ${result.notes === 1 ? 'note' : 'notes'}`;
  const dates = [...new Set(open.map((task) => choice.dates.get(task.id) as string))].sort();
  const now = Date.now();
  const today = dueDateFor('today', now);
  const todayTasks = open.filter((task) => choice.dates.get(task.id) === today).length;
  const lead =
    choice.plan === 'spread'
      ? `Spread ${open.length} tasks over ${formatDay(dates[0])} to ${formatDay(dates[dates.length - 1])}, in ${notes}.`
      : `Moved ${todayTasks} ${todayTasks === 1 ? 'task' : 'tasks'} to today and ${open.length - todayTasks} to ${formatDay(dates[dates.length - 1])}, in ${notes}.`;
  const left =
    result.skipped === 0
      ? ''
      : ` ${result.skipped} ${result.skipped === 1 ? 'was' : 'were'} left as they are, since they changed.`;
  const load = context ? ` ${describeLoadAfter(today, now, { today: context.todayCount(), due: 0 })}` : '';
  void vscode.window.showInformationMessage(`${lead}${left}${load}`);
}

/**
 * When a group of tasks is due, chosen from a short list: the days by name,
 * each saying how full it already is; for several tasks, spread over the
 * week or three for today; then a date in plain words, or no date at all.
 */
export async function pickReschedule(
  subject: string,
  tasks: readonly Task[] = [],
  load?: (date: string) => DayLoad,
): Promise<RescheduleChoice | null> {
  const now = Date.now();
  const open = tasks.filter((task) => !task.completed);
  const day = (label: string, date: string) => ({
    label,
    description: load ? `${formatDay(date)} · ${describeLoad(load(date))}` : formatDay(date),
    choice: { kind: 'one' as const, date },
  });
  type Item = vscode.QuickPickItem & { choice?: RescheduleChoice; ask?: boolean };
  const items: Item[] = [
    day('Today', dueDateFor('today', now)),
    day('Tomorrow', dueDateFor('tomorrow', now)),
    day('Next Monday', dueDateFor('nextWeek', now)),
  ];
  if (open.length >= 2) {
    const dates = planSpread(open, now);
    const days = [...new Set(dates.values())].sort();
    const perDay = days.map((date) => [...dates.values()].filter((each) => each === date).length);
    const most = Math.max(...perDay);
    const least = Math.min(...perDay);
    items.push({
      label: 'Spread over the next 5 days',
      description: `${formatDay(days[0])} to ${formatDay(days[days.length - 1])}, weekdays · ${least === most ? most : `${least}–${most}`} a day`,
      choice: { kind: 'each', plan: 'spread', dates },
    });
  }
  if (open.length >= 4) {
    const dates = planThreeToday(open, now);
    items.push({
      label: '3 for today, the rest next week',
      description: `3 on ${formatDay(dueDateFor('today', now))}, ${open.length - 3} on ${formatDay(dueDateFor('nextWeek', now))}`,
      choice: { kind: 'each', plan: 'threeToday', dates },
    });
  }
  items.push(
    { label: 'A date…', description: 'friday, oct 3, in 3 days, 2026-10-02', ask: true },
    { label: 'No due date', choice: { kind: 'one', date: undefined } },
  );
  const chosen = await vscode.window.showQuickPick(items, {
    title: `Reschedule ${subject}`,
    placeHolder: 'When they are due',
  });
  if (!chosen) {
    return null;
  }
  if (chosen.ask) {
    const date = await askForDueDate(subject);
    return date === null ? null : { kind: 'one', date };
  }
  return chosen.choice ?? null;
}

/** Reschedules tasks from the Tasks view or the palette, and says the load. */
export async function rescheduleTasks(
  subject: string,
  tasks: readonly Task[],
  context?: RescheduleContext,
): Promise<void> {
  const choice = await pickReschedule(subject, tasks, context?.load);
  if (!choice) {
    return;
  }
  if (choice.kind === 'one') {
    await setTasksDue(tasks, choice.date, context);
    return;
  }
  await setTasksDueEach(choice, tasks, context);
}
