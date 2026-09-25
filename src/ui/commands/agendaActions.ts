import * as vscode from 'vscode';

import { parseTaskDateInput } from '../../core/markdown/taskDraft';
import {
  addDays,
  formatIsoDate,
  setTaskDate,
  startOfDay,
} from '../../core/markdown/taskMetadata';
import { Task } from '../../core/types';
import { applyBulkEdit, describeBulkEditResult } from './bulkEdit';
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

/** The date a named choice means, as `YYYY-MM-DD`. Next week is its Monday. */
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
 * Asks for a date in plain words: `friday`, `in 3 days`, `2026-10-02`.
 *
 * Returns the date, `undefined` for an empty answer, which clears the date,
 * or `null` when the box was closed.
 */
export async function askForDueDate(
  subject: string,
): Promise<string | undefined | null> {
  const answer = await vscode.window.showInputBox({
    title: `Due date for ${subject}`,
    prompt: 'A date in plain words: friday, next monday, in 3 days, +2w, or 2026-10-02. Empty clears it.',
    placeHolder: 'friday',
    validateInput: (value) =>
      parseTaskDateInput(value) === undefined
        ? 'Deckard cannot read that as a date.'
        : undefined,
  });
  if (answer === undefined) {
    return null;
  }
  return parseTaskDateInput(answer)?.date;
}

/**
 * Writes one due date on every task. One task is one line, offered back with
 * an Undo; several are one write, previewed as any multi-note write is and
 * taken back by Undo Last Change.
 */
export async function setTasksDue(
  tasks: readonly Task[],
  date: string | undefined,
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
  if (result) {
    void vscode.window.showInformationMessage(describeBulkEditResult(edit, result));
  }
}

/**
 * One date for a group of tasks, chosen from a short list: the names first,
 * then a date in plain words, then no date at all.
 */
export async function pickReschedule(
  subject: string,
): Promise<string | undefined | null> {
  const now = Date.now();
  const items: (vscode.QuickPickItem & { date?: string | undefined; ask?: boolean })[] = [
    { label: 'Today', description: dueDateFor('today', now), date: dueDateFor('today', now) },
    { label: 'Tomorrow', description: dueDateFor('tomorrow', now), date: dueDateFor('tomorrow', now) },
    { label: 'Next week', description: dueDateFor('nextWeek', now), date: dueDateFor('nextWeek', now) },
    { label: 'A date…', description: 'friday, in 3 days, 2026-10-02', ask: true },
    { label: 'No due date', date: undefined },
  ];
  const chosen = await vscode.window.showQuickPick(items, {
    title: `Reschedule ${subject}`,
    placeHolder: 'When they are due',
  });
  if (!chosen) {
    return null;
  }
  return chosen.ask ? askForDueDate(subject) : chosen.date;
}
