import { Task } from '../model';
import { isOpenTask } from './taskStatuses';
import { addDays, formatIsoDate, startOfDay } from '../markdown/calendar';

/**
 * Rescheduling tasks from where they are listed: the dates a choice names,
 * and how full a day already is.
 */

/** The dates offered by name, beside one typed in plain words. */
export type DueChoice = 'today' | 'tomorrow' | 'nextWeek';

/**
 * The date a named choice means on the day of `now`, as `YYYY-MM-DD`.
 * `nextWeek` is the next Monday, and never today: on a Monday it is the
 * Monday after.
 */
export function dueDateFor(choice: DueChoice, now: number): string {
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

/** The open tasks due on, and scheduled for, a day. */
export function countLoad(tasks: Iterable<Task>, date: string): DayLoad {
  let due = 0;
  let scheduled = 0;
  for (const task of tasks) {
    if (!isOpenTask(task)) {
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
