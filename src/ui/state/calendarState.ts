import { isParkedTask } from '../../domain/index/parked';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { needsNewDateBefore } from '../../domain/tasks/taskPolicy';
import { stripTags } from '../../domain/markdown/parser';
import { SHORT_WEEKDAY_NAMES } from '../../domain/markdown/calendar';
import { QueryContext } from '../../domain/query/queryContext';
import { createDashboardTask } from './entryCards';
import {
  findPeriodicNoteNames,
  formatLocalDate,
  getPeriodicNote,
  isPeriodicNoteName,
  listDailyNotes,
} from '../../domain/notes/periodicNotes';
import { ParsedFile, Task, WorkspaceIndex } from '../../domain/model';
import { DashboardTask } from '../protocol/shared';
import { CalendarDay, CalendarDayDetail, CalendarEntry, CalendarSnapshot, CalendarWeek } from '../protocol/calendar';
import { TASK_PRIORITY_RANKS } from '../../domain/markdown/taskFields';
import { projectRepeats } from '../../domain/markdown/recurrence';

/** How many tasks and headings a day's tooltip names. */
const TOOLTIP_ITEMS = 5;

/** How many of a day's tasks, and of its new notes, the panel lists at once. */
const PANEL_NOTES = 5;

/** Day titles for the panel in the current year, which need no year. */
const dayTitle = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' });
/** Day titles for the panel in any other year. */
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
 * daily note, read on the context's today and with its task policy.
 */
export function createCalendarDay(
  index: WorkspaceIndex,
  date: string,
  context: QueryContext,
  options: Pick<CalendarOptions, 'showRepeats'> = {},
): CalendarDayDetail {
  const now = new Date(context.now);
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(year, month - 1, day);
  const today = formatLocalDate(now);
  const relative = relativeDayName(date, today);
  const notePath = listDailyNotes(index).find((note) => note.date === date)?.filePath;
  const on = (at: number | undefined): boolean => at !== undefined && formatLocalDate(new Date(at)) === date;
  const { due, scheduled, done } = collectDayTasks(index, on);
  const repeats = options.showRepeats ? repeatsOn(index, at.getTime(), at.getTime(), now).get(date) ?? [] : [];
  const rows = (tasks: Task[]): DashboardTask[] =>
    tasks.sort(byImportanceThenSource).map((task) => createDashboardTask(task, index.sections, context));
  const created = listNotesCreatedOn(index, on);
  const notes = created.slice(0, PANEL_NOTES).map(toPanelNote);
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

/** Today, Yesterday, or Tomorrow for a day that is one of them; nothing for any other. */
function relativeDayName(date: string, today: string): string | undefined {
  if (date === today) {
    return 'Today';
  }
  if (date === addDaysTo(today, -1)) {
    return 'Yesterday';
  }
  if (date === addDaysTo(today, 1)) {
    return 'Tomorrow';
  }
  return undefined;
}

/**
 * A day's tasks, parked ones aside: the open ones due on it, the open ones
 * scheduled on it and not also due, and the ones done on it, in index order.
 */
function collectDayTasks(
  index: WorkspaceIndex,
  on: (at: number | undefined) => boolean,
): { due: Task[]; scheduled: Task[]; done: Task[] } {
  const due: Task[] = [];
  const scheduled: Task[] = [];
  const done: Task[] = [];
  index.tasks.forEach((task) => {
    if (isParkedTask(index, task.id)) {
      return;
    }
    if (!isOpenTask(task)) {
      if (task.completed && on(task.doneAt)) {
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
  return { due, scheduled, done };
}

/** The panel's order: highest priority first, then source order. */
function byImportanceThenSource(left: Task, right: Task): number {
  return (
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] - TASK_PRIORITY_RANKS[left.priority ?? 'none'] ||
    left.filePath.localeCompare(right.filePath) ||
    left.lineNumber - right.lineNumber
  );
}

/**
 * Notes whose own created date is the day, earliest first, the periodic
 * notes aside: a daily note is the day itself, not something written on it.
 */
function listNotesCreatedOn(
  index: WorkspaceIndex,
  on: (at: number | undefined) => boolean,
): ParsedFile[] {
  const dailyPaths = new Set(listDailyNotes(index).map((note) => note.filePath));
  return [...index.files.values()]
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
}

/** A note as the panel names it: its first top-level heading, else its file name, and its folder. */
function toPanelNote(file: ParsedFile): CalendarDayDetail['notes'][number] {
  const heading = file.sections.find((section) => section.headingLevel === 1 && !section.isInline);
  const name = (file.filePath.split('/').pop() ?? file.filePath).replace(/\.md$/i, '');
  const folder = file.filePath.includes('/') ? file.filePath.slice(0, file.filePath.lastIndexOf('/')) : '';
  return {
    filePath: file.filePath,
    title: (heading ? stripTags(heading.heading).trim() : '') || name,
    folder,
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
    if (!isOpenTask(task) || !task.recurrence || isParkedTask(index, task.id)) {
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
  /** Draw Saturday and Sunday; true unless turned off. */
  showWeekends?: boolean;
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

/** A month as the calendar titles it: `September 2026`. */
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
 * the row holds. Today, the week start, and when an overdue task needs a new
 * date are the context's.
 */
export function createCalendar(
  index: WorkspaceIndex,
  month: string,
  context: QueryContext,
  options: CalendarOptions = {},
): CalendarSnapshot {
  const now = new Date(context.now);
  const { weekStart } = context;
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const today = formatLocalDate(now);
  const dailyNotes = mapDailyNotes(index);
  const periodicNotes = mapPeriodicNotes(index);
  /** The note a period keeps, whichever of its names it goes by. */
  const periodicNote = (period: 'week' | 'month', day: Date): string | undefined =>
    findPeriodicNoteNames(period, day, weekStart)
      .map((name) => periodicNotes.get(name))
      .find(Boolean);
  const page = options.layout === 'page';
  const tasks = collectTasksByDate(index, page);
  const rowStarts = listRowStarts(year, monthNumber, weekStart);
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
  const staleBefore = needsNewDateBefore(context.now, context.taskPolicy);
  const staleDate = staleBefore === undefined ? undefined : formatLocalDate(new Date(staleBefore));
  const grid: MonthGrid = {
    index,
    monthNumber,
    today,
    dailyNotes,
    tasks,
    repeats,
    entriesOn: page ? createEntriesOn({ tasks, repeats, today, staleDate }) : undefined,
  };
  const weeks = rowStarts.map((rowStart): CalendarWeek => {
    // A row is a week from the week start, which is what its note is named
    // for and what its review covers.
    const week = getPeriodicNote('week', rowStart, weekStart).name;
    const days = Array.from({ length: 7 }, (_, offset) => createDayCell(grid, rowStart, offset));
    const notePath = periodicNote('week', rowStart);
    return {
      week,
      date: formatLocalDate(rowStart),
      ...(notePath ? { notePath } : {}),
      days,
    };
  });
  const notePath = periodicNote('month', first);
  return {
    month,
    title: monthTitle.format(first),
    today,
    previousMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    currentMonth: today.slice(0, 7),
    ...(notePath ? { notePath } : {}),
    ...(staleBefore === undefined
      ? {}
      : { needsNewDateBefore: formatLocalDate(new Date(staleBefore)) }),
    weekdays: Array.from({ length: 7 }, (_, offset) => SHORT_WEEKDAY_NAMES[(weekStart + offset) % 7]),
    weeks,
    ...(options.showRepeats ? { showRepeats: true } : {}),
    ...(options.showWeekends === false ? { hideWeekends: true } : {}),
    ...(options.dayPanel ? createDayPanel(index, context, options, today) : {}),
  };
}

/** The open tasks of each day, by YYYY-MM-DD, with what the sidebar's tooltips need of them. */
interface TasksByDate {
  /** The page's tasks by day, due and scheduled; empty for the sidebar. */
  dueTasks: Map<string, Task[]>;
  scheduledTasks: Map<string, Task[]>;
  dueCounts: Map<string, number>;
  /** Up to TOOLTIP_ITEMS titles a day, for its tooltip. */
  dueTitles: Map<string, string[]>;
  scheduledCounts: Map<string, number>;
  scheduledTitles: Map<string, string[]>;
}

/** What drawing one day of the month reads, gathered once for the month. */
interface MonthGrid {
  index: WorkspaceIndex;
  monthNumber: number;
  today: string;
  dailyNotes: ReadonlyMap<string, string>;
  tasks: TasksByDate;
  repeats: ReadonlyMap<string, Task[]>;
  /** A page day's entries; undefined for the sidebar, whose days list none. */
  entriesOn: ((date: string) => CalendarEntry[]) | undefined;
}

/** Each day's daily note, the first the index lists for a date. */
function mapDailyNotes(index: WorkspaceIndex): Map<string, string> {
  const dailyNotes = new Map<string, string>();
  for (const note of listDailyNotes(index)) {
    if (!dailyNotes.has(note.date)) {
      dailyNotes.set(note.date, note.filePath);
    }
  }
  return dailyNotes;
}

/** Weekly and monthly notes by name, under either naming; the first path in order wins a name. */
function mapPeriodicNotes(index: WorkspaceIndex): Map<string, string> {
  const periodicNotes = new Map<string, string>();
  for (const filePath of [...index.files.keys()].sort()) {
    const name = (filePath.split('/').pop() ?? '').replace(/\.md$/i, '');
    if (isPeriodicNoteName(name) && !periodicNotes.has(name)) {
      periodicNotes.set(name, filePath);
    }
  }
  return periodicNotes;
}

/**
 * The open, unparked tasks by the day they are due, and by the day they are
 * scheduled when that is not also their due day. The sidebar keeps only
 * counts and a few titles for its tooltips; the page, which lists every
 * task, keeps the tasks too.
 */
function collectTasksByDate(index: WorkspaceIndex, page: boolean): TasksByDate {
  const tasks: TasksByDate = {
    dueTasks: new Map(),
    scheduledTasks: new Map(),
    dueCounts: new Map(),
    dueTitles: new Map(),
    scheduledCounts: new Map(),
    scheduledTitles: new Map(),
  };
  for (const task of index.tasks.values()) {
    if (!isOpenTask(task) || task.dueAt === undefined || isParkedTask(index, task.id)) {
      continue;
    }
    const date = formatLocalDate(new Date(task.dueAt));
    countTask({ page, byDate: tasks.dueTasks, counts: tasks.dueCounts, titles: tasks.dueTitles }, date, task);
  }
  for (const task of index.tasks.values()) {
    if (!isOpenTask(task) || task.scheduledAt === undefined || isParkedTask(index, task.id)) {
      continue;
    }
    const date = formatLocalDate(new Date(task.scheduledAt));
    if (task.dueAt !== undefined && formatLocalDate(new Date(task.dueAt)) === date) {
      continue;
    }
    countTask(
      { page, byDate: tasks.scheduledTasks, counts: tasks.scheduledCounts, titles: tasks.scheduledTitles },
      date,
      task,
    );
  }
  return tasks;
}

/** Counts a task on its day, keeps its title while the day has room, and keeps the task for the page. */
function countTask(
  into: {
    page: boolean;
    byDate: Map<string, Task[]>;
    counts: Map<string, number>;
    titles: Map<string, string[]>;
  },
  date: string,
  task: Task,
): void {
  if (into.page) {
    into.byDate.set(date, [...(into.byDate.get(date) ?? []), task]);
  }
  into.counts.set(date, (into.counts.get(date) ?? 0) + 1);
  const titles = into.titles.get(date) ?? [];
  if (titles.length >= TOOLTIP_ITEMS) {
    return;
  }
  titles.push(task.title.trim());
  into.titles.set(date, titles);
}

/** The first day of each row: whole weeks from the week start, until the month's last day is drawn. */
function listRowStarts(year: number, monthNumber: number, weekStart: number): Date[] {
  const first = new Date(year, monthNumber - 1, 1);
  const last = new Date(year, monthNumber, 0);
  const rowStarts: Date[] = [];
  for (
    let rowStart = new Date(year, monthNumber - 1, 1 - ((first.getDay() - weekStart + 7) % 7));
    rowStart <= last;
    rowStart = new Date(rowStart.getFullYear(), rowStart.getMonth(), rowStart.getDate() + 7)
  ) {
    rowStarts.push(rowStart);
  }
  return rowStarts;
}

/**
 * A page day's tasks: due, then scheduled, then repeats, each most important
 * first and then by title. A past due date is overdue, or stale once it is
 * before the day a task needs a new date.
 */
function createEntriesOn({ tasks, repeats, today, staleDate }: {
  tasks: TasksByDate;
  repeats: ReadonlyMap<string, Task[]>;
  today: string;
  staleDate: string | undefined;
}): (date: string) => CalendarEntry[] {
  return (date) => {
    const entry = (kind: CalendarEntry['kind']) => (task: Task): CalendarEntry => ({
      taskId: task.id,
      title: stripTags(task.title).trim() || task.title.trim(),
      kind,
      ...(kind === 'due' && date < today
        ? { tone: staleDate !== undefined && date < staleDate ? 'stale' as const : 'overdue' as const }
        : {}),
    });
    return [
      ...[...(tasks.dueTasks.get(date) ?? [])].sort(byImportanceThenTitle).map(entry('due')),
      ...[...(tasks.scheduledTasks.get(date) ?? [])].sort(byImportanceThenTitle).map(entry('scheduled')),
      ...[...(repeats.get(date) ?? [])].sort(byImportanceThenTitle).map(entry('repeat')),
    ];
  };
}

/** The page's order within a day: highest priority first, then title. */
function byImportanceThenTitle(left: Task, right: Task): number {
  return (
    TASK_PRIORITY_RANKS[right.priority ?? 'none'] - TASK_PRIORITY_RANKS[left.priority ?? 'none'] ||
    left.title.localeCompare(right.title)
  );
}

/** One day of a row, `offset` days after the row's first: its note, its counts, and the page's entries. */
function createDayCell(grid: MonthGrid, rowStart: Date, offset: number): CalendarDay {
  const day = new Date(
    rowStart.getFullYear(),
    rowStart.getMonth(),
    rowStart.getDate() + offset,
  );
  const date = formatLocalDate(day);
  const notePath = grid.dailyNotes.get(date);
  const { dueCounts, dueTitles, scheduledCounts, scheduledTitles } = grid.tasks;
  const repeats = grid.repeats.get(date);
  return {
    date,
    day: day.getDate(),
    inMonth: day.getMonth() === grid.monthNumber - 1,
    isToday: date === grid.today,
    ...(notePath ? { notePath, headings: headingsOf(grid.index, notePath) } : {}),
    dueCount: dueCounts.get(date) ?? 0,
    ...(dueTitles.has(date) ? { dueTitles: dueTitles.get(date) } : {}),
    scheduledCount: scheduledCounts.get(date) ?? 0,
    ...(scheduledTitles.has(date) ? { scheduledTitles: scheduledTitles.get(date) } : {}),
    ...(repeats
      ? {
          repeatCount: repeats.length,
          repeatTitles: repeats.slice(0, TOOLTIP_ITEMS).map((task) => task.title.trim()),
        }
      : {}),
    ...(grid.entriesOn ? { entries: grid.entriesOn(date) } : {}),
  };
}

/** A daily note's own headings, below its title, for a day's tooltip. */
function headingsOf(index: WorkspaceIndex, filePath: string): string[] {
  return (index.files.get(filePath)?.sections ?? [])
    .filter((section) => !section.isInline && section.headingLevel > 1)
    .map((section) => stripTags(section.heading).trim())
    .filter(Boolean)
    .slice(0, TOOLTIP_ITEMS);
}

/** The chosen day under the month, today when none was chosen. */
function createDayPanel(
  index: WorkspaceIndex,
  context: QueryContext,
  options: CalendarOptions,
  today: string,
): Pick<CalendarSnapshot, 'dayPanel' | 'selectedDate' | 'selected'> {
  const selectedDate = options.selectedDate ?? today;
  return {
    dayPanel: true,
    selectedDate,
    selected: createCalendarDay(index, selectedDate, context, options),
  };
}

/** The month some number of months before or after one, as YYYY-MM. */
export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return formatLocalDate(new Date(year, monthNumber - 1 + by, 1)).slice(0, 7);
}
