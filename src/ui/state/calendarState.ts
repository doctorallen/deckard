import { isParkedTask } from '../../core/workspace/parked';
import { needsNewDateBefore } from '../../core/taskPolicy';
import { stripTags } from '../../core/markdown/parser';
import { Weekday } from '../../core/markdown/dates';
import { projectRepeats, TASK_PRIORITY_RANKS } from '../../core/markdown/taskMetadata';
import { DashboardTask, Task, WorkspaceIndex } from '../../core/types';
import { createDashboardTask } from './dashboardState';
import {
  findPeriodicNoteNames,
  formatLocalDate,
  getPeriodicNote,
  isPeriodicNoteName,
  listDailyNotes,
} from '../commands/dailyNote';

/** How many tasks and headings a day's tooltip names. */
const TOOLTIP_ITEMS = 5;

/** One day in the calendar. */
export interface CalendarDay {
  /** YYYY-MM-DD. */
  date: string;
  /** The day of the month. */
  day: number;
  /** Whether the day is in the month shown, rather than a neighbor's. */
  inMonth: boolean;
  isToday: boolean;
  /** The day's daily note, when it has one. */
  notePath?: string;
  /** Open tasks due that day. */
  dueCount: number;
  /** The first few of them by name, and the daily note's headings, for its tooltip. */
  dueTitles?: string[];
  headings?: string[];
  /**
   * Open tasks scheduled (⏳) that day. A task due and scheduled on the same
   * day is counted once, as due.
   */
  scheduledCount: number;
  scheduledTitles?: string[];
  /**
   * Repeating tasks whose rule lands on the day after their current date,
   * with `deckard.calendar.showRepeats`: projected, not due.
   */
  repeatCount?: number;
  repeatTitles?: string[];
  /** The calendar page's day: every task on it, by name, most important first. */
  entries?: CalendarEntry[];
}

/** One task on a day of the calendar page. */
export interface CalendarEntry {
  taskId: string;
  title: string;
  /** Due that day, scheduled that day, or a repeat's later date. */
  kind: 'due' | 'scheduled' | 'repeat';
  /** A due date past: overdue, or past `needsNewDateAfterDays`. */
  tone?: 'overdue' | 'stale';
}

/** One row of the calendar: seven days, from the week's first day. */
export interface CalendarWeek {
  /** The week's note name, such as week-2026-09-13-2026-09-19. */
  week: string;
  /** Its first day, as YYYY-MM-DD, which the week's note is found from. */
  date: string;
  /** The week's note, when it has one. */
  notePath?: string;
  days: CalendarDay[];
}

export interface CalendarSnapshot {
  /** The month shown, as YYYY-MM. */
  month: string;
  /** Such as "September 2026". */
  title: string;
  today: string;
  previousMonth: string;
  nextMonth: string;
  /** Today's month, which the Today button returns to. */
  currentMonth: string;
  /** The month's note, when it has one. */
  notePath?: string;
  /** The weekday names across the top, from the week's first day. */
  weekdays: string[];
  /**
   * Days before this one, YYYY-MM-DD, are past `needsNewDateAfterDays`: their
   * due counts are drawn muted and say the tasks need a new date. Absent
   * when the setting is 0.
   */
  needsNewDateBefore?: string;
  weeks: CalendarWeek[];
  /** Whether repeats are drawn, from `deckard.calendar.showRepeats`. */
  showRepeats?: boolean;
  /** Whether the chosen day is shown below the month, from `deckard.calendar.dayPanel`. */
  dayPanel?: boolean;
  /** The day chosen, YYYY-MM-DD: today until another is. */
  selectedDate?: string;
  /** The chosen day, when the panel is on. */
  selected?: CalendarDayDetail;
}

/** The chosen day, as the panel under the month shows it. */
export interface CalendarDayDetail {
  date: string;
  /** Such as "Friday, September 25", with the year when it is not this one. */
  title: string;
  /** Today, Yesterday, or Tomorrow, when the day is one of them. */
  relative?: string;
  /** The day's daily note, when it has one. */
  notePath?: string;
  /** Open tasks due that day, most important first. */
  due: DashboardTask[];
  /** Open tasks scheduled that day and not due on it. */
  scheduled: DashboardTask[];
  /** Tasks completed that day. */
  done: DashboardTask[];
  /** Repeating tasks whose rule lands on the day, projected: opened, never completed, from here. */
  repeats?: DashboardTask[];
  /**
   * Where the row's button moves a task: tomorrow, or the day after a later
   * day, never earlier.
   */
  move: { date: string; label: 'Tomorrow' | 'Next day' };
  /** Notes created that day, oldest first, daily, weekly, and monthly aside. */
  notes: { filePath: string; title: string; folder: string }[];
  /** How many there are, listed or not. */
  notesTotal: number;
}

/** How many of a day's tasks, and of its new notes, the panel lists at once. */
const PANEL_NOTES = 5;

const dayTitle = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' });
const dayTitleWithYear = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

/** A day moved by some days, as YYYY-MM-DD. */
function addDaysTo(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return formatLocalDate(new Date(year, month - 1, day + days));
}

/**
 * One day as the panel under the calendar shows it: its title, and its
 * daily note.
 */
export function createCalendarDay(
  index: WorkspaceIndex,
  date: string,
  now: Date,
  options: Pick<CalendarOptions, 'showRepeats'> = {},
): CalendarDayDetail {
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(year, month - 1, day);
  const today = formatLocalDate(now);
  const relative =
    date === today
      ? 'Today'
      : date === addDaysTo(today, -1)
        ? 'Yesterday'
        : date === addDaysTo(today, 1)
          ? 'Tomorrow'
          : undefined;
  const notePath = listDailyNotes(index).find((note) => note.date === date)?.filePath;
  const on = (at: number | undefined): boolean => at !== undefined && formatLocalDate(new Date(at)) === date;
  const due: Task[] = [];
  const scheduled: Task[] = [];
  const done: Task[] = [];
  index.tasks.forEach((task) => {
    if (isParkedTask(index, task.id)) {
      return;
    }
    if (task.completed) {
      if (on(task.doneAt)) {
        done.push(task);
      }
      return;
    }
    if (on(task.dueAt)) {
      due.push(task);
    } else if (on(task.scheduledAt)) {
      scheduled.push(task);
    }
  });
  const repeats = options.showRepeats ? repeatsOn(index, at.getTime(), at.getTime(), now).get(date) ?? [] : [];
  const byImportance = (left: Task, right: Task): number =>
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] - TASK_PRIORITY_RANKS[left.priority ?? 'none'] ||
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber;
  const rows = (tasks: Task[]): DashboardTask[] =>
    tasks.sort(byImportance).map((task) => createDashboardTask(task, index.sections, now.getTime()));
  // Notes whose own created date is the day, the periodic notes aside: a
  // daily note is the day itself, not something written on it.
  const dailyPaths = new Set(listDailyNotes(index).map((note) => note.filePath));
  const created = [...index.files.values()]
    .filter((file) => {
      if (!on(file.createdAt) || dailyPaths.has(file.filePath)) {
        return false;
      }
      const name = (file.filePath.split('/').pop() ?? '').replace(/\.md$/i, '');
      return !isPeriodicNoteName(name);
    })
    .sort(
      (left, right) =>
        (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.filePath.localeCompare(right.filePath),
    );
  const notes = created.slice(0, PANEL_NOTES).map((file) => {
    const heading = file.sections.find((section) => section.headingLevel === 1 && !section.isInline);
    const name = (file.filePath.split('/').pop() ?? file.filePath).replace(/\.md$/i, '');
    const folder = file.filePath.includes('/') ? file.filePath.slice(0, file.filePath.lastIndexOf('/')) : '';
    return {
      filePath: file.filePath,
      title: (heading ? stripTags(heading.heading).trim() : '') || name,
      folder,
    };
  });
  const tomorrow = addDaysTo(today, 1);
  const next = addDaysTo(date, 1);
  const target = next > tomorrow ? next : tomorrow;
  return {
    date,
    title: (year === now.getFullYear() ? dayTitle : dayTitleWithYear).format(at),
    ...(relative ? { relative } : {}),
    ...(notePath ? { notePath } : {}),
    due: rows(due),
    scheduled: rows(scheduled),
    done: rows(done),
    ...(repeats.length ? { repeats: rows(repeats) } : {}),
    move: { date: target, label: target === tomorrow ? 'Tomorrow' : 'Next day' },
    notes,
    notesTotal: created.length,
  };
}

/**
 * The same day of the month in another month, or that month's last day:
 * January 31 in February is February 28.
 */
export function clampToMonth(date: string, month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, '0')}`;
}

/**
 * The repeating tasks projected onto each day from `from` to `to`, by
 * YYYY-MM-DD: open, not parked, and on their rule's later dates only.
 */
function repeatsOn(index: WorkspaceIndex, from: number, to: number, now: Date): Map<string, Task[]> {
  const byDate = new Map<string, Task[]>();
  index.tasks.forEach((task) => {
    if (task.completed || !task.recurrence || isParkedTask(index, task.id)) {
      return;
    }
    projectRepeats(task, from, to, now.getTime()).forEach((at) => {
      const date = formatLocalDate(new Date(at));
      byDate.set(date, [...(byDate.get(date) ?? []), task]);
    });
  });
  return byDate;
}

/** What the calendar draws besides the month. */
export interface CalendarOptions {
  /** Draw a repeating task on its rule's later dates, not only its next. */
  showRepeats?: boolean;
  /**
   * The sidebar's days carry counts and a few names for their tooltips; the
   * page's list every task by name.
   */
  layout?: 'sidebar' | 'page';
  /** Show the chosen day below the month. */
  dayPanel?: boolean;
  /** The day chosen; today when none was. */
  selectedDate?: string;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const monthTitle = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
});

/**
 * One month as the calendar shows it: whole weeks from the week start,
 * with each day's daily note and the open tasks due that day, and the notes
 * kept for each week and for the month.
 *
 * A row is a week in its own right: the note it opens is named for the days
 * the row holds.
 */
export function createCalendar(
  index: WorkspaceIndex,
  month: string,
  now: Date,
  weekStart: Weekday = 0,
  options: CalendarOptions = {},
): CalendarSnapshot {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const last = new Date(year, monthNumber, 0);
  const today = formatLocalDate(now);

  const dailyNotes = new Map<string, string>();
  for (const note of listDailyNotes(index)) {
    if (!dailyNotes.has(note.date)) {
      dailyNotes.set(note.date, note.filePath);
    }
  }
  // Weekly and monthly notes by name, under either naming.
  const periodicNotes = new Map<string, string>();
  for (const filePath of [...index.files.keys()].sort()) {
    const name = (filePath.split('/').pop() ?? '').replace(/\.md$/i, '');
    if (isPeriodicNoteName(name) && !periodicNotes.has(name)) {
      periodicNotes.set(name, filePath);
    }
  }
  /** The note a period keeps, whichever of its names it goes by. */
  const periodicNote = (period: 'week' | 'month', day: Date): string | undefined =>
    findPeriodicNoteNames(period, day, weekStart)
      .map((name) => periodicNotes.get(name))
      .find(Boolean);
  const page = options.layout === 'page';
  /** The page's tasks by day, due and scheduled; repeats are added from their own map. */
  const dueTasks = new Map<string, Task[]>();
  const scheduledTasks = new Map<string, Task[]>();
  const add = (byDate: Map<string, Task[]>, date: string, task: Task): void => {
    if (page) {
      byDate.set(date, [...(byDate.get(date) ?? []), task]);
    }
  };
  const dueCounts = new Map<string, number>();
  const dueTitles = new Map<string, string[]>();
  for (const task of index.tasks.values()) {
    if (!task.completed && task.dueAt !== undefined && !isParkedTask(index, task.id)) {
      const date = formatLocalDate(new Date(task.dueAt));
      add(dueTasks, date, task);
      dueCounts.set(date, (dueCounts.get(date) ?? 0) + 1);
      const titles = dueTitles.get(date) ?? [];
      if (titles.length < TOOLTIP_ITEMS) {
        titles.push(task.title.trim());
        dueTitles.set(date, titles);
      }
    }
  }
  const scheduledCounts = new Map<string, number>();
  const scheduledTitles = new Map<string, string[]>();
  for (const task of index.tasks.values()) {
    if (task.completed || task.scheduledAt === undefined || isParkedTask(index, task.id)) {
      continue;
    }
    const date = formatLocalDate(new Date(task.scheduledAt));
    if (task.dueAt !== undefined && formatLocalDate(new Date(task.dueAt)) === date) {
      continue;
    }
    add(scheduledTasks, date, task);
    scheduledCounts.set(date, (scheduledCounts.get(date) ?? 0) + 1);
    const titles = scheduledTitles.get(date) ?? [];
    if (titles.length < TOOLTIP_ITEMS) {
      titles.push(task.title.trim());
      scheduledTitles.set(date, titles);
    }
  }
  /** A daily note's own headings, below its title, for a day's tooltip. */
  const headingsOf = (filePath: string): string[] =>
    (index.files.get(filePath)?.sections ?? [])
      .filter((section) => !section.isInline && section.headingLevel > 1)
      .map((section) => stripTags(section.heading).trim())
      .filter(Boolean)
      .slice(0, TOOLTIP_ITEMS);

  const rowStarts: Date[] = [];
  for (
    let rowStart = new Date(year, monthNumber - 1, 1 - ((first.getDay() - weekStart + 7) % 7));
    rowStart <= last;
    rowStart = new Date(rowStart.getFullYear(), rowStart.getMonth(), rowStart.getDate() + 7)
  ) {
    rowStarts.push(rowStart);
  }
  // Every day drawn, a neighbor month's included, so a repeat is where the
  // grid says it is in both months.
  const lastRow = rowStarts[rowStarts.length - 1];
  const repeats = options.showRepeats
    ? repeatsOn(
        index,
        rowStarts[0].getTime(),
        new Date(lastRow.getFullYear(), lastRow.getMonth(), lastRow.getDate() + 6).getTime(),
        now,
      )
    : new Map<string, Task[]>();

  const staleBefore = needsNewDateBefore(now.getTime());
  const staleDate = staleBefore !== undefined ? formatLocalDate(new Date(staleBefore)) : undefined;
  const byImportance = (left: Task, right: Task): number =>
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] - TASK_PRIORITY_RANKS[left.priority ?? 'none'] ||
    left.title.localeCompare(right.title);
  /** A page day's tasks: due, then scheduled, then repeats, each most important first. */
  const entriesOn = (date: string): CalendarEntry[] => {
    const entry = (kind: CalendarEntry['kind']) => (task: Task): CalendarEntry => ({
      taskId: task.id,
      title: stripTags(task.title).trim() || task.title.trim(),
      kind,
      ...(kind === 'due' && date < today
        ? { tone: staleDate !== undefined && date < staleDate ? 'stale' as const : 'overdue' as const }
        : {}),
    });
    return [
      ...[...(dueTasks.get(date) ?? [])].sort(byImportance).map(entry('due')),
      ...[...(scheduledTasks.get(date) ?? [])].sort(byImportance).map(entry('scheduled')),
      ...[...(repeats.get(date) ?? [])].sort(byImportance).map(entry('repeat')),
    ];
  };

  const weeks: CalendarWeek[] = [];
  for (const rowStart of rowStarts) {
    // A row is a week from the week start, which is what its note is named
    // for and what its review covers.
    const week = getPeriodicNote('week', rowStart, weekStart).name;
    const days = Array.from({ length: 7 }, (_, offset): CalendarDay => {
      const day = new Date(
        rowStart.getFullYear(),
        rowStart.getMonth(),
        rowStart.getDate() + offset,
      );
      const date = formatLocalDate(day);
      const notePath = dailyNotes.get(date);
      return {
        date,
        day: day.getDate(),
        inMonth: day.getMonth() === monthNumber - 1,
        isToday: date === today,
        ...(notePath ? { notePath, headings: headingsOf(notePath) } : {}),
        dueCount: dueCounts.get(date) ?? 0,
        ...(dueTitles.has(date) ? { dueTitles: dueTitles.get(date) } : {}),
        scheduledCount: scheduledCounts.get(date) ?? 0,
        ...(scheduledTitles.has(date) ? { scheduledTitles: scheduledTitles.get(date) } : {}),
        ...(repeats.has(date)
          ? {
              repeatCount: repeats.get(date)!.length,
              repeatTitles: repeats.get(date)!.slice(0, TOOLTIP_ITEMS).map((task) => task.title.trim()),
            }
          : {}),
        ...(page ? { entries: entriesOn(date) } : {}),
      };
    });
    const notePath = periodicNote('week', rowStart);
    weeks.push({
      week,
      date: formatLocalDate(rowStart),
      ...(notePath ? { notePath } : {}),
      days,
    });
  }

  const notePath = periodicNote('month', first);
  return {
    month,
    title: monthTitle.format(first),
    today,
    previousMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    currentMonth: today.slice(0, 7),
    ...(notePath ? { notePath } : {}),
    ...(needsNewDateBefore(now.getTime()) !== undefined
      ? { needsNewDateBefore: formatLocalDate(new Date(needsNewDateBefore(now.getTime())!)) }
      : {}),
    weekdays: Array.from({ length: 7 }, (_, offset) => WEEKDAY_SHORT[(weekStart + offset) % 7]),
    weeks,
    ...(options.showRepeats ? { showRepeats: true } : {}),
    ...(options.dayPanel
      ? (() => {
          const selectedDate = options.selectedDate ?? today;
          return {
            dayPanel: true,
            selectedDate,
            selected: createCalendarDay(index, selectedDate, now, options),
          };
        })()
      : {}),
  };
}

/** The month some number of months before or after one, as YYYY-MM. */
export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return formatLocalDate(new Date(year, monthNumber - 1 + by, 1)).slice(0, 7);
}
