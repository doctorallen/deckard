import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import { formatIsoDate, parseIsoDate } from '../../domain/markdown/calendar';
import { type DateFormats, DEFAULT_DATE_FORMATS, formatDisplayDay } from '../../domain/markdown/dateFormat';
import { setTaskDate } from '../../domain/markdown/taskLineEdits';
import type { Task } from '../../domain/model';
import { formatDay } from '../../domain/tasks/agendaPlacement';
import { SnoozeChoice, snoozeDateFor } from '../../domain/tasks/reschedule';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { applyBulkEdit, reportBulkEditResult } from './bulkEdit';
import { askForDate, readDateFormats, readWeekStart } from './datePrompt';
import { findCursorTask } from './setTaskStatus';
import { quoteTaskTitle, readTaskMetadataFormat, TaskWrites, updateTaskLine } from './taskActions';

/**
 * Snooze until…: a task put off until a day, by its start date, 🛫 or
 * `[start:: …]`, so it is not a task to do before then. It works on the
 * task at the cursor, on the tasks a Tasks view menu was run on, and on a
 * Task board card.
 */

/** The named rows of the snooze picker, in the order it lists them. */
const SNOOZE_ROWS: ReadonlyArray<readonly [SnoozeChoice, string]> = [
  ['tomorrow', 'Tomorrow'],
  ['nextWeek', 'Next week'],
];

/**
 * Asks when to snooze until: Tomorrow, Next week, each with its day, or a
 * date in plain words. Returns the date, or null when the picker or the
 * date box was closed, or the box left empty.
 */
export async function pickSnoozeDate(subject: string, now: number = Date.now()): Promise<string | null> {
  const formats = readDateFormats();
  const weekStart = readWeekStart();
  type Item = vscode.QuickPickItem & { date?: string };
  const items: Item[] = [
    ...SNOOZE_ROWS.map(([choice, label]): Item => {
      const date = snoozeDateFor(choice, now, weekStart);
      return { label, description: describeDay(date, formats), date };
    }),
    { label: 'Pick a date…', description: 'friday, oct 3, in 3 days, 2026-10-02' },
  ];
  const chosen = await vscode.window.showQuickPick(items, {
    title: `Snooze ${subject} until`,
    placeHolder: 'The day it starts: it is not to do before then',
  });
  if (!chosen) {
    return null;
  }
  if (chosen.date) {
    return chosen.date;
  }
  const read = await askForDate({ title: `Snooze ${subject} until`, now });
  return read?.date ?? null;
}

/** A `YYYY-MM-DD` day as the Tasks view writes it, in the reader's format: `Wed 2026-10-28`. */
function describeDay(date: string, formats: DateFormats): string {
  const at = parseIsoDate(date);
  return at === undefined ? date : formatDay(at, formats);
}

/**
 * What a snooze says: when the task starts, and, when it is due before
 * then, that it still is, since a snooze moves no due date:
 * `"Call Ren" starts Wed 2026-10-28. It is still due 2026-10-27.`
 */
export function describeSnooze(
  title: string,
  start: string,
  dueAt: number | undefined,
  formats: DateFormats = DEFAULT_DATE_FORMATS,
): string {
  const startsAt = parseIsoDate(start);
  const when = startsAt === undefined ? start : formatDay(startsAt, formats);
  const due = dueAt !== undefined && startsAt !== undefined && dueAt < startsAt
    ? ` It is still due ${formatDisplayDay(formatIsoDate(dueAt), formats)}.`
    : '';
  return `${title} starts ${when}.${due}`;
}

/**
 * Writes one start date on every open task: one task is one line, offered
 * back with an Undo; several are one write, previewed as any multi-note
 * write is and taken back by Undo Last Change.
 */
export async function snoozeTasks(writes: TaskWrites, tasks: readonly Task[], date: string): Promise<void> {
  const open = tasks.filter(isOpenTask);
  if (open.length === 0) {
    void vscode.window.showInformationMessage('A done or cancelled task has nothing to put off. Reopen it to snooze it.');
    return;
  }
  if (open.length === 1) {
    const [task] = open;
    await updateTaskLine(
      writes,
      task,
      (line, { uri }) =>
        setTaskDate(line, task.checkboxColumn, {
          field: 'start',
          date,
          preferredFormat: readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard', uri)),
        }),
      describeSnooze(quoteTaskTitle(task), date, task.dueAt, readDateFormats()),
    );
    return;
  }
  const edit = { kind: 'date' as const, field: 'start' as const, date };
  const result = await applyBulkEdit(
    writes.history,
    open.map((task) => ({ kind: 'task' as const, task })),
    edit,
  );
  if (result) {
    reportBulkEditResult(edit, result);
  }
}

/** Asks when to snooze the tasks until, and writes it; nothing when the picker is closed. */
export async function snoozeWithPicker(writes: TaskWrites, tasks: readonly Task[], subject: string): Promise<void> {
  if (tasks.length === 0) {
    return;
  }
  const date = await pickSnoozeDate(subject);
  if (date !== null) {
    await snoozeTasks(writes, tasks, date);
  }
}

/**
 * Deckard: Snooze Task Until…, on the task at the cursor, or on the task a
 * card's menu passes.
 */
export async function snoozeTaskCommand(
  indexer: Pick<IndexReader, 'getSnapshot' | 'getFilePath'>,
  writes: TaskWrites,
  given?: Task,
): Promise<void> {
  const task = given ?? findCursorTask(indexer);
  if (!task) {
    void vscode.window.showInformationMessage(
      'Put the cursor on a task line to snooze it, or choose Snooze Until… on a task in the Tasks view or the Task board.',
    );
    return;
  }
  await snoozeWithPicker(writes, [task], quoteTaskTitle(task));
}
