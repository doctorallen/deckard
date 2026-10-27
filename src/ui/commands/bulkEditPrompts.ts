import * as vscode from 'vscode';

import { createStatusPicks } from './taskEditor';
import { readTaskStatusOptions } from './parseSettings';
import { getEntityNamespaceAliases, stripTags } from '../../domain/markdown/parser';
import { findLineTags, readTagKey, type TagLineOptions } from '../../domain/markdown/tagLineEdits';
import {
  applyBulkEdit,
  BulkEdit,
  BulkEntry,
  reportBulkEditResult,
} from './bulkEdit';
import { askForDate } from './datePrompt';
import { WorkspaceWriteHistory } from './workspaceWrites';
import { Section, Task, TaskPriority } from '../../domain/model';

/**
 * Asking what to do to a search's results, and to which of them.
 *
 * The choosing is a VS Code quick pick rather than checkboxes drawn on the
 * page: every result is listed with its note and line, all picked to start
 * with, and unpicking one leaves it out. It is the list people already use to
 * choose many things at once, and it keeps the page a page.
 */

/** An edit that asks for something more before it is made: a date, a tag, a status, or where to move to. */
export type BulkEditAsk =
  | 'due'
  | 'scheduled'
  | 'start'
  | 'shift'
  | 'priority'
  | 'status'
  | 'tag'
  | 'removeTag'
  | 'replaceTag'
  | 'move';

/** One row of the list of edits. */
export interface BulkEditChoice {
  label: string;
  description: string;
  edit: BulkEdit | BulkEditAsk;
}

/**
 * The edits a list of results can take. Move to… is listed for tasks when
 * the page can move them.
 */
export function listBulkEdits(kind: 'notes' | 'tasks', options: { canMove?: boolean } = {}): BulkEditChoice[] {
  const tags: BulkEditChoice[] = [
    { label: 'Add a tag', description: 'Write one tag at the end of each line', edit: 'tag' },
    { label: 'Remove a tag', description: 'Take a tag off each line that writes it', edit: 'removeTag' },
    { label: 'Replace a tag', description: 'Write another tag where one is written', edit: 'replaceTag' },
  ];
  if (kind === 'notes') {
    return tags;
  }
  return [
    {
      label: 'Complete',
      description: 'Check each open task, with its done date and next occurrence',
      edit: { kind: 'complete', completed: true },
    },
    {
      label: 'Reopen',
      description: 'Uncheck each completed task',
      edit: { kind: 'complete', completed: false },
    },
    {
      label: 'Set a status',
      description: 'In progress, Waiting, Cancelled, or any other, on each task',
      edit: 'status',
    },
    { label: 'Set a due date', description: 'Write, or clear, the 📅 date on each task', edit: 'due' },
    { label: 'Set a scheduled date', description: 'Write, or clear, the ⏳ date on each task', edit: 'scheduled' },
    { label: 'Set a start date', description: 'Write, or clear, the 🛫 date on each task', edit: 'start' },
    { label: 'Shift dates…', description: 'Move the due, scheduled, or start date each task has by some days', edit: 'shift' },
    { label: 'Set a priority', description: 'Highest to lowest, or none, on each task', edit: 'priority' },
    ...tags,
    ...(options.canMove
      ? [{ label: 'Move to…', description: 'Move each task and its steps under another heading or into another note', edit: 'move' as const }]
      : []),
  ];
}

/** How one result reads in the list of results to choose from. */
export function describeEntry(entry: BulkEntry): {
  label: string;
  description: string;
} {
  if (entry.kind === 'task') {
    const title = stripTags(entry.task.title).trim() || entry.task.title;
    return {
      label: `${entry.task.completed ? '[x]' : '[ ]'} ${title}`,
      description: `${fileName(entry.task.filePath)}:${entry.task.lineNumber}`,
    };
  }
  const heading = stripTags(entry.section.heading).trim() || entry.section.heading;
  return {
    label: heading,
    description: `${fileName(entry.section.filePath)}:${entry.section.startLine}`,
  };
}

/** The last segment of a workspace-relative path. */
function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/** What a page offers bulk edit beyond its writes: the note its settings are read for, and a way to move tasks, when it has one. */
export interface BulkEditActions {
  /** The note whose settings, such as its statuses, the edit reads; the workspace's when omitted. */
  uri?: vscode.Uri;
  /** Moves tasks and their steps where the reader chooses, as Move to… does. */
  moveTasks?(tasks: readonly Task[]): Promise<void>;
}

/**
 * Asks what to do, to which results, and does it.
 *
 * Nothing is written until the reader has chosen an edit and the results to
 * make it to; after that the edit goes through the ordinary previewed,
 * undoable write. Move to… is Move to…'s own write, with its own message.
 */
export async function editResults(
  history: WorkspaceWriteHistory,
  kind: 'notes' | 'tasks',
  results: { tasks: readonly Task[]; sections: readonly Section[] },
  actions: BulkEditActions = {},
): Promise<void> {
  const { uri } = actions;
  const entries: BulkEntry[] =
    kind === 'tasks'
      ? results.tasks.map((task) => ({ kind: 'task', task }))
      : results.sections.map((section) => ({ kind: 'section', section }));
  if (entries.length === 0) {
    void vscode.window.showInformationMessage(
      `This search found no ${kind === 'tasks' ? 'tasks' : 'notes'} to edit.`,
    );
    return;
  }

  const action = await vscode.window.showQuickPick(listBulkEdits(kind, { canMove: actions.moveTasks !== undefined }), {
    title: `Edit ${entries.length} ${
      kind === 'tasks' ? 'task' : 'note'
    }${entries.length === 1 ? '' : 's'} this search found`,
    placeHolder: 'Choose what to do to them',
  });
  if (!action) {
    return;
  }

  const edit = action.edit === 'move' ? 'move' : await readEdit(action.edit, entries, uri);
  if (!edit) {
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    entries.map((entry) => ({ ...describeEntry(entry), entry, picked: true })),
    {
      canPickMany: true,
      title: 'Which results?',
      placeHolder: 'Every result is chosen; unpick any to leave it as it is',
    },
  );
  if (!chosen || chosen.length === 0) {
    return;
  }

  if (edit === 'move') {
    await actions.moveTasks?.(chosen.flatMap((item) => (item.entry.kind === 'task' ? [item.entry.task] : [])));
    return;
  }
  const result = await applyBulkEdit(
    history,
    chosen.map((item) => item.entry),
    edit,
  );
  if (result) {
    reportBulkEditResult(edit, result);
  }
}

/** Fills in an edit that still needs a value: a date, a priority, a status, a shift, or a tag. */
async function readEdit(
  chosen: Exclude<BulkEditChoice['edit'], 'move'>,
  entries: readonly BulkEntry[],
  uri?: vscode.Uri,
): Promise<BulkEdit | undefined> {
  if (typeof chosen !== 'string') {
    return chosen;
  }
  const tagOptions = {
    entityNamespaceAliases: getEntityNamespaceAliases(
      vscode.workspace.getConfiguration('deckard', uri).get<unknown>('entityNamespaceAliases', {}),
    ),
  };
  switch (chosen) {
    case 'status': {
      const picked = await vscode.window.showQuickPick(createStatusPicks(readTaskStatusOptions(uri), ''), {
        title: 'Set a status',
        placeHolder: 'Choose the status every chosen task gets',
      });
      return picked ? { kind: 'status', status: picked.status } : undefined;
    }
    case 'due': {
      const read = await askForDate({ title: 'Due date' });
      return read ? { kind: 'due', date: read.date } : undefined;
    }
    case 'scheduled':
    case 'start': {
      const read = await askForDate({ title: chosen === 'start' ? 'Start date' : 'Scheduled date' });
      return read ? { kind: 'date', field: chosen, date: read.date } : undefined;
    }
    case 'priority':
      return askForPriority();
    case 'shift':
      return askForShift(entries);
    case 'tag': {
      const written = await askForTag('Add a tag', 'One tag, such as #project/atlas or @ren-kade, written at the end of each line.', tagOptions);
      return written ? { kind: 'tag', tag: written } : undefined;
    }
    case 'removeTag': {
      const tag = await pickWrittenTag(entries, 'Remove a tag', tagOptions);
      return tag ? { kind: 'removeTag', tag } : undefined;
    }
    case 'replaceTag': {
      const from = await pickWrittenTag(entries, 'Replace a tag', tagOptions);
      if (!from) {
        return undefined;
      }
      const to = await askForTag(`Replace ${from} with`, `One tag, such as #project/atlas, written where ${from} is.`, tagOptions, from);
      return to ? { kind: 'replaceTag', from, to } : undefined;
    }
  }
}

/** Asks for one tag, refusing anything else, and `unlike` when given. */
async function askForTag(title: string, prompt: string, options: TagLineOptions, unlike?: string): Promise<string | undefined> {
  const unlikeKey = unlike === undefined ? undefined : readTagKey(unlike, options);
  const written = await vscode.window.showInputBox({
    title,
    prompt,
    validateInput: (value) => {
      const key = readTagKey(value, options);
      if (key === undefined) {
        return 'Write exactly one tag, such as #project/atlas.';
      }
      return key === unlikeKey ? `Write a tag other than ${unlike}.` : undefined;
    },
  });
  return written?.trim() || undefined;
}

/** The priorities a bulk edit sets, highest first, then none. */
const PRIORITY_PICKS: ReadonlyArray<{ label: string; priority: TaskPriority | undefined }> = [
  { label: '🔺 Highest', priority: 'highest' },
  { label: '⏫ High', priority: 'high' },
  { label: '🔼 Medium', priority: 'medium' },
  { label: '🔽 Low', priority: 'low' },
  { label: '⏬ Lowest', priority: 'lowest' },
  { label: 'No priority', priority: undefined },
];

/** Asks which priority every chosen task gets. */
async function askForPriority(): Promise<BulkEdit | undefined> {
  const picked = await vscode.window.showQuickPick(PRIORITY_PICKS.map((pick) => ({ ...pick })), {
    title: 'Set a priority',
    placeHolder: 'Choose the priority every chosen task gets',
  });
  return picked ? { kind: 'priority', priority: picked.priority } : undefined;
}

/** The dates a shift may move, as its picker names them. */
const SHIFT_FIELDS: ReadonlyArray<{ field: 'due' | 'scheduled' | 'start'; label: string; has: (task: Task) => boolean }> = [
  { field: 'due', label: 'Due', has: (task) => task.dueAt !== undefined },
  { field: 'scheduled', label: 'Scheduled', has: (task) => task.scheduledAt !== undefined },
  { field: 'start', label: 'Start', has: (task) => task.startAt !== undefined },
];

/**
 * Asks which dates to move, each with how many of the results have one,
 * then by how many days.
 */
async function askForShift(entries: readonly BulkEntry[]): Promise<BulkEdit | undefined> {
  const tasks = entries.flatMap((entry) => (entry.kind === 'task' ? [entry.task] : []));
  const fields = await vscode.window.showQuickPick(
    SHIFT_FIELDS.map(({ field, label, has }) => {
      const count = tasks.filter(has).length;
      return { label, description: `${count} of ${tasks.length} ${tasks.length === 1 ? 'has' : 'have'} one`, field, picked: count > 0 };
    }),
    { canPickMany: true, title: 'Shift dates', placeHolder: 'Choose the dates to move; a task moves each one it has' },
  );
  if (!fields || fields.length === 0) {
    return undefined;
  }
  const written = await vscode.window.showInputBox({
    title: 'Shift dates by',
    prompt: 'Whole days: 3 or +3 moves them later, -2 earlier.',
    placeHolder: '+1',
    validateInput: (value) => (readShiftDays(value) === undefined ? 'Write a whole number of days, such as 3 or -2.' : undefined),
  });
  const days = written === undefined ? undefined : readShiftDays(written);
  return days === undefined ? undefined : { kind: 'shift', shift: { days, fields: fields.map((pick) => pick.field) } };
}

/**
 * The days a shift is written as: a whole number, signed or not, with
 * `d` or `days` after it if you like, and not 0; at most ten years.
 */
export function readShiftDays(value: string): number | undefined {
  const match = /^([+-]?\d+)\s*(?:d|days?)?$/i.exec(value.trim());
  const days = match ? Number(match[1]) : NaN;
  return Number.isInteger(days) && days !== 0 && Math.abs(days) <= 3650 ? days : undefined;
}

/**
 * The tags the results write on their own lines, the most written first,
 * each with how many results write it. A tag a result inherits is written
 * elsewhere, and is not one of these.
 */
export function listWrittenTags(entries: readonly BulkEntry[], options: TagLineOptions = {}): Array<{ label: string; count: number }> {
  const byKey = new Map<string, { label: string; count: number }>();
  entries.forEach((entry) => {
    const line = entry.kind === 'task' ? entry.task.sourceLineText : (entry.section.rawContent.split(/\r?\n/)[0] ?? '');
    const keys = new Map(findLineTags(line, options).map((tag) => [tag.key, tag.label]));
    keys.forEach((label, key) => {
      const found = byKey.get(key) ?? { label, count: 0 };
      found.count += 1;
      byKey.set(key, found);
    });
  });
  return [...byKey.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

/** Asks which of the tags the results write to change; nothing when they write none. */
async function pickWrittenTag(entries: readonly BulkEntry[], title: string, options: TagLineOptions): Promise<string | undefined> {
  const tags = listWrittenTags(entries, options);
  if (tags.length === 0) {
    void vscode.window.showInformationMessage(
      'None of these results writes a tag on its own line. A tag a result has from a heading or its front matter is changed where it is written.',
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    tags.map((tag) => ({ label: tag.label, description: `on ${tag.count} of ${entries.length}` })),
    { title, placeHolder: 'Choose a tag the results write on their lines' },
  );
  return picked?.label;
}
