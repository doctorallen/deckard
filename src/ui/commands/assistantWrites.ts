import * as vscode from 'vscode';

import {
  formatTaskDraft,
  parseTaskDraft,
  TaskDraft,
} from '../../core/markdown/taskDraft';
import { formatIsoDate, TaskMetadataFormat } from '../../core/markdown/taskMetadata';
import { TaskPriority, WorkspaceIndex } from '../../core/types';
import { formatCaptureLine, getCaptureInsertion } from './capture';
import { ensureDailyNote } from './dailyNote';
import { resolveSourceUri } from './navigation';
import { completeDraft } from './taskEditor';
import { readTaskMetadataFormat } from './taskActions';
import { applyWorkspaceWrite } from './workspaceWrites';

/**
 * What an assistant may write, and how.
 *
 * The query and tag tools are read-only. These two add a task and change
 * one, and every write goes through the same refactor preview Deckard's own
 * multi-note writes use - always, whatever `deckard.previewWorkspaceWrites`
 * says - so the reader sees the exact line about to change, in the note it
 * is in, and can decline it. `Deckard: Undo Last Change` takes it back
 * afterwards, as it does any write. Over MCP there is no other confirmation,
 * so the preview is the guard; in VS Code the tool also asks before it runs.
 *
 * A change names a task by its note and line, which is how the query tool
 * reports one, and it is refused when the line is not the task the index
 * knows there: an assistant working from a stale answer must not rewrite
 * whatever is on that line now.
 */

export const ADD_TASK_TOOL_NAME = 'deckard_add_task';
export const CHANGE_TASK_TOOL_NAME = 'deckard_change_task';

export interface AddTaskInput {
  /** The task's words; metadata such as 📅 2026-09-20 or ⏫ may be written in them. */
  text: string;
  /** A workspace-relative note to add it to; today's daily note when absent. */
  note?: string;
}

/** `null` clears a field; absent leaves it. */
export interface ChangeTaskInput {
  note: string;
  line: number;
  title?: string;
  complete?: boolean;
  due?: string | null;
  priority?: TaskPriority | null;
  assignee?: string | null;
}

const PRIORITIES: readonly TaskPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;

export function readAddTaskInput(value: unknown): AddTaskInput | undefined {
  if (!isRecord(value) || typeof value.text !== 'string') {
    return undefined;
  }
  const text = value.text.trim().replace(/\s+/g, ' ');
  if (!text || text.length > MAX_TEXT) {
    return undefined;
  }
  const note = typeof value.note === 'string' ? value.note.trim() : '';
  return note ? { text, note } : { text };
}

export function readChangeTaskInput(value: unknown): ChangeTaskInput | undefined {
  if (
    !isRecord(value) ||
    typeof value.note !== 'string' ||
    !value.note.trim() ||
    typeof value.line !== 'number' ||
    !Number.isInteger(value.line) ||
    value.line < 1
  ) {
    return undefined;
  }
  const input: ChangeTaskInput = { note: value.note.trim(), line: value.line };
  if (value.title !== undefined) {
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_TEXT) {return undefined;}
    input.title = value.title.trim().replace(/\s+/g, ' ');
  }
  if (value.complete !== undefined) {
    if (typeof value.complete !== 'boolean') {return undefined;}
    input.complete = value.complete;
  }
  if (value.due !== undefined) {
    if (value.due !== null && (typeof value.due !== 'string' || !ISO_DAY.test(value.due))) {return undefined;}
    input.due = value.due;
  }
  if (value.priority !== undefined) {
    if (value.priority !== null && !PRIORITIES.includes(value.priority as TaskPriority)) {return undefined;}
    input.priority = value.priority as TaskPriority | null;
  }
  if (value.assignee !== undefined) {
    if (value.assignee !== null && (typeof value.assignee !== 'string' || !/^\S{1,80}$/.test(value.assignee))) {return undefined;}
    input.assignee = value.assignee;
  }
  const fields = ['title', 'complete', 'due', 'priority', 'assignee'] as const;
  return fields.some((field) => input[field] !== undefined) ? input : undefined;
}

/** The task line an added task becomes. */
export function addedTaskLine(text: string): string {
  return formatCaptureLine(text);
}

/**
 * A task line with the requested changes made, and nothing else touched:
 * the draft keeps every field it does not name, in the format the line
 * already uses.
 */
export function changeTaskLine(
  line: string,
  changes: Omit<ChangeTaskInput, 'note' | 'line'>,
  now: number,
  fallbackFormat: TaskMetadataFormat = 'emoji',
): string {
  let draft: TaskDraft = parseTaskDraft(line, fallbackFormat);
  if (changes.title !== undefined) {
    draft = { ...draft, description: changes.title };
  }
  if (changes.due !== undefined) {
    draft = { ...draft, due: changes.due ?? undefined };
  }
  if (changes.priority !== undefined) {
    draft = { ...draft, priority: changes.priority ?? undefined };
  }
  if (changes.assignee !== undefined) {
    draft = { ...draft, assignee: changes.assignee ?? undefined };
  }
  if (changes.complete !== undefined && changes.complete !== draft.completed) {
    draft = completeDraft(draft, now);
  }
  return formatTaskDraft(draft);
}

/** One line saying what changed, for the preview's label and the answer. */
export function describeChange(changes: Omit<ChangeTaskInput, 'note' | 'line'>): string {
  const parts: string[] = [];
  if (changes.title !== undefined) {parts.push('retitle it');}
  if (changes.complete === true) {parts.push('complete it');}
  if (changes.complete === false) {parts.push('reopen it');}
  if (changes.due !== undefined) {parts.push(changes.due ? `make it due ${changes.due}` : 'clear its due date');}
  if (changes.priority !== undefined) {parts.push(changes.priority ? `set its priority to ${changes.priority}` : 'clear its priority');}
  if (changes.assignee !== undefined) {parts.push(changes.assignee ? `hand it to ${changes.assignee}` : 'take it from whoever it was for');}
  return parts.join(', ');
}

interface WriteIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

/** What a write tool answers: text for the assistant, and whether it was refused. */
export interface WriteAnswer {
  text: string;
  isError?: boolean;
}

export async function addTask(indexer: WriteIndexSource, input: AddTaskInput): Promise<WriteAnswer> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  let uri: vscode.Uri | undefined;
  if (input.note) {
    if (!index.files.has(input.note)) {
      return { text: `No indexed note is at "${input.note}". Paths are workspace-relative, as deckard_query reports them.`, isError: true };
    }
    uri = await resolveSourceUri(input.note);
  } else {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return { text: 'No folder is open, so there is no daily note to add to.', isError: true };
    }
    uri = await ensureDailyNote(folder);
  }
  if (!uri) {
    return { text: `The note "${input.note}" could not be opened.`, isError: true };
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const line = addedTaskLine(input.text);
  const insertion = getCaptureInsertion(document.getText(), line);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(insertion.line, insertion.character), insertion.text);
  const written = await applyWorkspaceWrite(edit, {
    label: 'Assistant: add a task',
    description: `Add "${shorten(input.text)}" to ${vscode.workspace.asRelativePath(uri)}`,
    preview: 'always',
  });
  if (!written.applied) {
    return { text: 'The user declined the change in the preview. Nothing was written.', isError: true };
  }
  return {
    text: `Added the task to ${vscode.workspace.asRelativePath(uri)} at line ${insertion.taskLine}:\n${line}\nThe user can take it back with Deckard: Undo Last Change.`,
  };
}

export async function changeTask(indexer: WriteIndexSource, input: ChangeTaskInput, now = Date.now()): Promise<WriteAnswer> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  const task = [...index.tasks.values()].find(
    (candidate) => candidate.filePath === input.note && candidate.lineNumber === input.line,
  );
  if (!task) {
    return { text: `No task is indexed at ${input.note} line ${input.line}. Ask deckard_query for the task first; it reports each one's note and line.`, isError: true };
  }
  const uri = await resolveSourceUri(task.filePath);
  if (!uri) {
    return { text: `The note "${task.filePath}" could not be opened.`, isError: true };
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const current = document.lineAt(task.lineNumber - 1);
  if (current.text !== task.sourceLineText) {
    return { text: `Line ${task.lineNumber} of ${task.filePath} is no longer the task the index knows there; it may have been edited or moved. Ask deckard_query again.`, isError: true };
  }
  const { note: _note, line: _line, ...changes } = input;
  const replacement = changeTaskLine(
    current.text,
    changes,
    now,
    readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard')),
  );
  if (replacement === current.text) {
    return { text: 'The task already reads that way; nothing to change.' };
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, current.range, replacement);
  const written = await applyWorkspaceWrite(edit, {
    label: 'Assistant: change a task',
    description: `${describeChange(changes)} — "${shorten(task.title)}" in ${task.filePath}`,
    preview: 'always',
  });
  if (!written.applied) {
    return { text: 'The user declined the change in the preview. Nothing was written.', isError: true };
  }
  return {
    text: `Changed ${task.filePath} line ${task.lineNumber}:\n${replacement}\nThe user can take it back with Deckard: Undo Last Change.`,
  };
}

function shorten(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { formatIsoDate as formatDayForTask };
