import * as vscode from 'vscode';

import { AgendaGroupBy, readAgendaQuery, readUpcomingDays } from '../../domain/tasks/agendaGroups';
import { DayLoad, DueChoice, dueDateFor, RescheduleContext } from '../../domain/tasks/reschedule';
import { QueryContext } from '../../domain/query/queryContext';
import { pluralize } from '../../shared/text';
import { PreferenceServices } from '../../core/storage/preferences';
import type { IndexReader } from '../../core/workspace/indexReader';
import { AgendaService } from '../../services/agendaService';
import { AGENDA_GROUPINGS, AgendaGroup, selectOverdueTasks } from '../state/agendaState';
import { describeNamespaceValues, listTaskNamespaces } from '../state/tagGrouping';
import type { AgendaNode } from '../views/agendaTree';
import { applyBulkEdit, reportBulkEditResult } from './bulkEdit';
import { askForDate } from './datePrompt';
import { moveTasks } from './moveTo';
import { breakIntoStepsCommand } from './taskSteps';
import {
  openTask,
  quoteTaskTitle,
  readTaskMetadataFormat,
  TaskWrites,
  updateTaskLine,
} from './taskActions';
import { registerCommand } from './runCommand';
import { Task, WorkspaceIndex } from '../../domain/model';
import { TASK_PRIORITY_RANKS } from '../../domain/markdown/taskFields';
import { setTaskDate } from '../../domain/markdown/taskLineEdits';
import { addDays, formatIsoDate, startOfDay } from '../../domain/markdown/calendar';

/**
 * Dating tasks from where they are listed.
 *
 * The Tasks view is the list read most often, and it could only complete a
 * task: moving one to tomorrow meant opening its note and finding its line.
 * Its items take the same dates the Task board's menu does, and more, and a
 * group takes one date for everything in it, which is how a morning's
 * overdue tasks are cleared without editing each.
 */

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

/** A day's load in words: `3 due · 1 scheduled`, or `nothing due`. */
export function describeLoad(load: DayLoad): string {
  const parts = [
    load.due > 0 ? `${load.due} due` : '',
    load.scheduled > 0 ? `${load.scheduled} scheduled` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing due';
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
export function planSpread(tasks: readonly Task[], now: number): Map<string, string> {
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
export function planThreeToday(tasks: readonly Task[], now: number): Map<string, string> {
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
 * Sets one task's due or scheduled date, saying what it is now, with Undo
 * through the same checked edit as every other task change. Several tasks
 * go through `setTasksDue`, whose bulk edit writes due dates alone.
 */
export async function setTaskDateField(
  writes: TaskWrites,
  task: Task,
  field: 'due' | 'scheduled',
  date: string | undefined,
): Promise<boolean> {
  if (task.completed) {
    return false;
  }
  return updateTaskLine(
    writes,
    task,
    (line, { uri }) =>
      setTaskDate(line, task.checkboxColumn, {
        field,
        date,
        preferredFormat: readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard', uri)),
      }),
    describeDateChange(quoteTaskTitle(task), field, date),
  );
}

/** What a date change says: `"Call Ren" is due 2026-09-26.` */
export function describeDateChange(
  title: string,
  field: 'due' | 'scheduled',
  date: string | undefined,
): string {
  if (field === 'scheduled') {
    return date ? `${title} is scheduled ${date}.` : `${title} has no scheduled date now.`;
  }
  return date ? `${title} is due ${date}.` : `${title} has no due date now.`;
}

/**
 * Writes one due date on every task. One task is one line, offered back with
 * an Undo; several are one write, previewed as any multi-note write is and
 * taken back by Undo Last Change.
 */
export async function setTasksDue(
  writes: TaskWrites,
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
      writes,
      task,
      (line, { uri }) =>
        setTaskDate(line, task.checkboxColumn, {
          field: 'due',
          date,
          preferredFormat: readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard', uri)),
        }),
      describeDateChange(quoteTaskTitle(task), 'due', date),
    );
    return;
  }
  const edit = { kind: 'due' as const, date };
  const result = await applyBulkEdit(
    writes.history,
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
  writes: TaskWrites,
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
    writes.history,
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
  const notes = pluralize(result.notes, 'note');
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
  options: { title?: string } = {},
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
    title: options.title ?? `Reschedule ${subject}`,
    placeHolder: tasks.length === 1 ? 'When it is due' : 'When they are due',
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
  writes: TaskWrites,
  subject: string,
  tasks: readonly Task[],
  context?: RescheduleContext,
): Promise<void> {
  const choice = await pickReschedule(subject, tasks, context?.load);
  if (!choice) {
    return;
  }
  if (choice.kind === 'one') {
    await setTasksDue(writes, tasks, choice.date, context);
    return;
  }
  await setTasksDueEach(writes, choice, tasks, context);
}

/**
 * The open tasks the Tasks view lists as overdue on the context's today, as
 * `deckard.agenda.query` selects them. The status bar's hover lists these.
 */
export function listOverdueTasks(index: WorkspaceIndex, context: QueryContext): Task[] {
  const settings = vscode.workspace.getConfiguration('deckard');
  return selectOverdueTasks(index, context, {
    query: readAgendaQuery(settings),
    upcomingDays: readUpcomingDays(settings),
  });
}

/** What the Agenda lists, from `deckard.agenda.query`; empty is every open task. */
export function getAgendaQuery(): string {
  return readAgendaQuery(vscode.workspace.getConfiguration('deckard'));
}

/**
 * The Tasks view's context keys: whether its search narrows the list, which
 * offers the way back to every open task, and whether it has a search at
 * all. Each build of the view publishes them.
 */
export class AgendaContextKeys {
  /** Sets both keys, as the build that read them found them. */
  public publish(keys: { filtered: boolean; querySet: boolean }): void {
    void vscode.commands.executeCommand('setContext', 'deckard.agendaFiltered', keys.filtered);
    void vscode.commands.executeCommand('setContext', 'deckard.agendaQuerySet', keys.querySet);
  }
}

/**
 * Asks how to group the Agenda, and keeps the answer where the setting is,
 * so the panel and the settings say the same thing. Which settings that
 * writes is the agenda service's; this asks and returns the grouping now in
 * force, or undefined when nothing changed.
 */
export async function pickAgendaGrouping(
  agenda: AgendaService<AgendaGroup>,
  index?: WorkspaceIndex,
): Promise<AgendaGroupBy | undefined> {
  const { groupBy: current, groupNamespace: namespace } = agenda.readGrouping();
  const chosen = await vscode.window.showQuickPick(
    AGENDA_GROUPINGS.map((grouping) => ({
      label: grouping.label,
      description: describeCurrentGrouping(grouping.id, current, namespace),
      detail: grouping.detail,
      id: grouping.id,
    })),
    { title: 'Group tasks by', placeHolder: 'Choose what the groups are' },
  );
  if (!chosen) {
    return undefined;
  }
  let picked: string | undefined;
  if (chosen.id === 'tag') {
    picked = index ? await pickTagNamespace(agenda, index, current === 'tag' ? namespace : undefined) : undefined;
    if (!picked) {
      return undefined;
    }
  }
  const change = await agenda.setGrouping({ chosen: chosen.id, current, namespace: picked });
  return change.kind === 'grouped' ? change.groupBy : undefined;
}

/** What the picker says beside the grouping in force. */
function describeCurrentGrouping(
  id: AgendaGroupBy,
  current: AgendaGroupBy,
  namespace: string,
): string | undefined {
  if (id !== current) {
    return undefined;
  }
  return id === 'tag' ? `Current: #${namespace}` : 'Current';
}

/** Asks which namespace to group by, busiest first; nothing when none is in use. */
export async function pickTagNamespace(
  agenda: Pick<AgendaService<AgendaGroup>, 'readStatusNamespace'>,
  index: WorkspaceIndex,
  current?: string,
): Promise<string | undefined> {
  const namespaces = listTaskNamespaces(index, [agenda.readStatusNamespace()]);
  if (namespaces.length === 0) {
    void vscode.window.showInformationMessage(
      'No open task carries a namespaced tag, such as #context/phone, yet. Write one on a task, or on the heading above it, to group by it.',
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    namespaces.map((namespace) => ({
      label: `#${namespace.name}`,
      description: `${namespace.openTasks} open ${namespace.openTasks === 1 ? 'task' : 'tasks'}${namespace.name === current ? ' · Current' : ''}`,
      detail: describeNamespaceValues(namespace.values),
      name: namespace.name,
    })),
    {
      title: 'Group tasks by tag namespace',
      placeHolder: 'Choose the namespace whose tags are the groups',
    },
  );
  return picked?.name;
}

/**
 * Deckard: Reschedule Overdue Tasks: every task the Tasks view lists as
 * overdue, once the index is built, or a word that nothing is.
 */
export async function rescheduleOverdueCommand(
  agenda: AgendaService<AgendaGroup>,
  writes: TaskWrites,
): Promise<void> {
  const overdue = await agenda.listOverdue();
  if (overdue.length === 0) {
    void vscode.window.showInformationMessage('Nothing is overdue.');
    return;
  }
  await rescheduleTasks(writes, agenda.describeSubject(overdue, 'overdue tasks'), overdue, agenda.rescheduleContext());
}

/** The Tasks view as its menu commands read it: the tasks a menu was run on. */
interface AgendaSelection {
  tasksFor(node?: AgendaNode, selected?: readonly AgendaNode[]): Task[];
  showMore(groupId: string): void;
}

/** What the Tasks view's commands work with. */
export interface AgendaCommandServices {
  view: AgendaSelection;
  agenda: AgendaService<AgendaGroup>;
  writes: TaskWrites;
  indexer: IndexReader<vscode.Uri>;
  /** What Move to… ranks destinations by and records a heading in. */
  preferences: Pick<PreferenceServices, 'reader' | 'usage'>;
}

/**
 * The Tasks view's own menus: a date by name or in plain words, on one
 * task, on the tasks selected, or on every task in a group; Move to…,
 * Reschedule…, Show More, Edit Task, and Break into Steps; and Reschedule
 * Overdue Tasks from the palette and the status bar.
 */
export function registerAgendaCommands(services: AgendaCommandServices): vscode.Disposable[] {
  const { view, agenda, writes, indexer, preferences } = services;
  /**
   * A command that sets the due date of the tasks the view's node or
   * selection stands for, to the date `date` asks for by the tasks' subject.
   * Nothing is done when there are no tasks, or when `date` answers null
   * (cancelled); undefined clears the date.
   */
  const dueFromView = (date: (subject: string) => Promise<string | undefined | null>) =>
    async (node?: AgendaNode, selected?: readonly AgendaNode[]) => {
      const tasks = view.tasksFor(node, selected);
      if (tasks.length === 0) {
        return;
      }
      const chosen = await date(agenda.describeSubject(tasks));
      if (chosen !== null) {
        await setTasksDue(writes, tasks, chosen, agenda.rescheduleContext());
      }
    };
  /**
   * The date a named day stands for. It is read on the day the menu item is
   * chosen, not when the command was registered.
   */
  const named = (choice: DueChoice) => () => Promise.resolve(dueDateFor(choice, Date.now()));
  return [
    registerCommand('deckard.agenda.dueToday', dueFromView(named('today'))),
    registerCommand('deckard.agenda.dueTomorrow', dueFromView(named('tomorrow'))),
    registerCommand('deckard.agenda.dueNextWeek', dueFromView(named('nextWeek'))),
    registerCommand('deckard.agenda.dueOnDate', dueFromView(askForDueDate)),
    registerCommand(
      'deckard.agenda.moveTo',
      async (node?: AgendaNode, selected?: readonly AgendaNode[]) => {
        const tasks = view.tasksFor(node, selected);
        if (tasks.length > 0) {
          await moveTasks(indexer, preferences, writes, tasks);
        }
      },
    ),
    registerCommand(
      'deckard.agenda.reschedule',
      async (node?: AgendaNode, selected?: readonly AgendaNode[]) => {
        const tasks = view.tasksFor(node, selected);
        if (tasks.length === 0) {
          return;
        }
        await rescheduleTasks(writes, agenda.describeSubject(tasks), tasks, agenda.rescheduleContext());
      },
    ),
    registerCommand('deckard.agenda.showMore', (groupId?: unknown) => {
      if (typeof groupId === 'string') {
        view.showMore(groupId);
      }
    }),
    registerCommand('deckard.rescheduleOverdue', () => rescheduleOverdueCommand(agenda, writes)),
    ...registerTaskMenus(services),
  ];
}

/** Edit Task and Break into Steps, on a task in the Tasks view. */
function registerTaskMenus({ view, writes, indexer }: AgendaCommandServices): vscode.Disposable[] {
  return [
    registerCommand(
      'deckard.agenda.editTask',
      async (node?: AgendaNode) => {
        const [task] = view.tasksFor(node);
        if (task && (await openTask(task))) {
          await vscode.commands.executeCommand('deckard.editTask');
        }
      },
    ),
    registerCommand(
      'deckard.agenda.breakIntoSteps',
      async (node?: AgendaNode) => {
        const [task] = view.tasksFor(node);
        if (task) {
          await breakIntoStepsCommand(indexer, writes, task);
        }
      },
    ),
  ];
}
