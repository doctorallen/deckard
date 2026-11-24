import { noteTitle } from '../../domain/index/backlinks';
import { addDays, formatIsoDate, startOfDay } from '../../domain/markdown/calendar';
import { describeDueDate } from '../../domain/markdown/dueWording';
import type { ParsedFile, Task, WorkspaceIndex } from '../../domain/model';
import type { QueryContext } from '../../domain/query/queryContext';
import { getHeadingPath } from '../../domain/ranking/entryLabels';
import { UPCOMING_DAYS } from '../../domain/tasks/agendaGroups';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import {
  type DayTop,
  findDayNotePath,
  findEarlierTop,
  readTodayTop,
  readTopOf,
  topCountWord,
  topOfferLabel,
  topTasksName,
  topTasksOf,
  usesTopTasks,
} from '../../domain/tasks/topTasks';
import { createAgenda, selectAgendaTasks } from './agendaState';
import { createTaskComparator } from './entryCards';

/**
 * A day's top tasks (docs/implementation/50-top-three.md) as each surface
 * says them: the rows the picker lists, the status bar's words, and the
 * lenses above today's note. Pure; the picker, the status bar item, and
 * the lens provider draw what these return.
 */

/** Why a row is in the picker's list: the group it is listed under. */
export type TopRowGroup = 'chosen' | 'left' | 'overdue' | 'today' | 'urgent';

/** One task the picker lists. */
export interface TopRow {
  task: Task;
  group: TopRowGroup;
  /** Why it is listed and where it is written, `Overdue 1 day · Borealis › Vendor sync`. */
  detail: string;
  /**
   * Why a chosen task cannot be unchecked: it is done, and a day keeps what
   * it finished; or its line is written under the heading itself, where
   * unchecking it would delete the task.
   */
  stays?: 'done' | 'written';
}

/** The picker's list: its rows in order, and what the group of earlier picks is called. */
export interface TopRows {
  rows: TopRow[];
  /** `Left from yesterday's three`, or the day by its date when it is not yesterday. */
  leftLabel: string;
}

/** A word with its first letter capitalized. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Why a task is worth a look today: how its due date stands, that it is done, or the day it is scheduled. */
function describeWhy(task: Task, context: QueryContext): string {
  if (!isOpenTask(task)) {
    return task.completed ? 'Done' : capitalize(task.status.name);
  }
  if (task.dueAt !== undefined) {
    const { parts } = describeDueDate(task.dueAt, context.now, context.taskPolicy, { dueText: task.dueText, formats: context.dateFormats });
    return capitalize(`${parts.state}${parts.distance}`);
  }
  return task.scheduledAt === undefined ? '' : `Scheduled ${formatIsoDate(task.scheduledAt)}`;
}

/** Where a task is written: its note, then the headings above it, the note's own title aside. */
function describeWhere(index: WorkspaceIndex, task: Task): string {
  const title = noteTitle(task.filePath);
  const section = task.sectionId ? index.sections.get(task.sectionId) : undefined;
  const path = (section ? getHeadingPath(section, index.sections) : []).filter(
    (heading, at) => heading.trim() !== '' && !(at === 0 && heading.trim().toLowerCase() === title.toLowerCase()),
  );
  return [title, ...path].join(' › ');
}

/** What the group of earlier picks is called, by the day they were picked for. */
function describeLeft(earlier: DayTop | undefined, now: number, count: number): string {
  const yesterday = formatIsoDate(addDays(startOfDay(now), -1));
  const picks = count === 1 ? 'top task' : topCountWord(count);
  return !earlier || earlier.date === yesterday ? `Left from yesterday's ${picks}` : `Left from ${earlier.date}`;
}

/**
 * The picker's rows, each task once, in the first group that holds it:
 * today's picks, done ones included; the unfinished picks of the latest
 * earlier daily note that has a section; what the Tasks view counts as
 * overdue, then as due today; and every other open task it lists, most
 * urgent first. `query` is `deckard.tasks.viewQuery`.
 */
export function buildTopRows(index: WorkspaceIndex, context: QueryContext, { query, count }: { query: string; count: number }): TopRows {
  const today = readTodayTop(index, context.now);
  const earlier = findEarlierTop(index, formatIsoDate(context.now));
  const groups = createAgenda(index, context, {
    tasks: selectAgendaTasks(index, query, context).tasks,
    upcomingDays: UPCOMING_DAYS,
  });
  const tasksOf = (id: string): Task[] => groups.find((group) => group.id === id)?.entries.map((entry) => entry.task) ?? [];
  const urgent = groups
    .filter((group) => group.id !== 'overdue' && group.id !== 'today')
    .flatMap((group) => group.entries.map((entry) => entry.task))
    .sort(createTaskComparator([], 'urgency', { now: context.now, index }));
  const ownLines = new Set((today?.picks ?? []).flatMap((pick) => (pick.ownLine && pick.task ? [pick.task.id] : [])));
  const seen = new Set<string>();
  const rows: TopRow[] = [];
  const add = (group: TopRowGroup, tasks: readonly Task[]): void => {
    for (const task of tasks) {
      if (seen.has(task.id)) {
        continue;
      }
      seen.add(task.id);
      const stays = group === 'chosen' ? readStays(task, ownLines) : undefined;
      rows.push({
        task,
        group,
        detail: [describeWhy(task, context), describeWhere(index, task)].filter(Boolean).join(' · '),
        ...(stays ? { stays } : {}),
      });
    }
  };
  add('chosen', topTasksOf(today));
  add('left', topTasksOf(earlier).filter(isOpenTask));
  add('overdue', tasksOf('overdue'));
  add('today', tasksOf('today'));
  add('urgent', urgent);
  return { rows, leftLabel: describeLeft(earlier, context.now, count) };
}

/** Why a chosen task stays chosen, when it does. */
function readStays(task: Task, ownLines: ReadonlySet<string>): TopRow['stays'] {
  if (task.completed) {
    return 'done';
  }
  return ownLines.has(task.id) ? 'written' : undefined;
}

/** What the status bar item says of today's top tasks, and what selecting it does. */
export interface TopStatus {
  /** `offer` while there are none to show, `next` with one still to do, `done` once none is. */
  kind: 'offer' | 'next' | 'done';
  /** The item's words, without its icon: `1/3 · Draft the cutover runbook`. */
  text: string;
  /** Today's picks, in order, which the hover lists. */
  tasks: Task[];
  /** The first pick not done, whose line selecting the item opens. */
  next?: Task;
}

/** The most of a task's title the status bar holds. */
const STATUS_TITLE_LENGTH = 40;

/**
 * The status bar's words for today's top tasks: how many are done and the
 * first that is not, `1/3 · Draft the cutover runbook`; `3/3 done` once
 * none is left; the offer to pick while today has none, shown only where
 * the practice is in use. Undefined when there is nothing to show, and
 * always while `count` is 0.
 */
export function describeTopStatus(index: WorkspaceIndex, now: number, count: number): TopStatus | undefined {
  if (count <= 0) {
    return undefined;
  }
  const tasks = topTasksOf(readTodayTop(index, now));
  if (tasks.length === 0) {
    return usesTopTasks(index, now) ? { kind: 'offer', text: topOfferLabel(count), tasks } : undefined;
  }
  const progress = `${tasks.filter((task) => task.completed).length}/${tasks.length}`;
  const next = tasks.find(isOpenTask);
  if (!next) {
    return { kind: 'done', text: `${progress} done`, tasks };
  }
  const title = next.title.length > STATUS_TITLE_LENGTH ? `${next.title.slice(0, STATUS_TITLE_LENGTH - 1)}…` : next.title;
  return { kind: 'next', text: `${progress} · ${title}`, tasks, next };
}

/** One lens above today's note: the zero-based line it sits on, and its words. */
export interface TopLens {
  line: number;
  title: string;
  tooltip: string;
}

/** What the lenses read: the note as the editor holds it, the moment, and the setting. */
export interface TopLensRequest {
  index: WorkspaceIndex;
  /** The note, parsed from the editor, so its section follows unsaved edits. */
  file: ParsedFile;
  now: number;
  /** `deckard.tasks.topCount`. */
  count: number;
}

/**
 * The lens today's note carries: above its section's heading, how far
 * along the picks are and the way to change them, `Top three · 1 of 3 done
 * · Change…`; with no picks, above the note's first heading, the offer to
 * pick, with how many of the day before's are left, shown only where the
 * practice is in use. None on any other note, nor while `count` is 0.
 */
export function describeTopLenses({ index, file, now, count }: TopLensRequest): TopLens[] {
  const date = formatIsoDate(now);
  if (count <= 0 || findDayNotePath(index, date) !== file.filePath) {
    return [];
  }
  const top = readTopOf(index, file, date);
  const tasks = topTasksOf(top);
  if (top && tasks.length > 0) {
    const done = tasks.filter((task) => task.completed).length;
    return [{
      line: top.headingLine,
      title: `${topTasksName(count)} · ${done} of ${tasks.length} done · Change…`,
      tooltip: "Change today's top tasks",
    }];
  }
  if (!usesTopTasks(index, now) && !top) {
    return [];
  }
  const earlier = findEarlierTop(index, date);
  const left = topTasksOf(earlier).filter(isOpenTask).length;
  const from = earlier?.date === formatIsoDate(addDays(startOfDay(now), -1)) ? 'yesterday' : earlier?.date;
  const firstHeading = file.sections.filter((section) => !section.isInline).sort((a, b) => a.startLine - b.startLine)[0];
  return [{
    line: Math.max(0, (firstHeading?.startLine ?? 1) - 1),
    title: `${topOfferLabel(count)}…${left > 0 ? ` · ${left} left from ${from}` : ''}`,
    tooltip: "Choose the tasks to do first today; they are written in this note",
  }];
}
