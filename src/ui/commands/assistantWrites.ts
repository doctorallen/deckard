import * as vscode from 'vscode';

import {
  parseTaskDraft,
  TaskDraft,
} from '../../domain/markdown/taskDraft';
import { AddTaskInput, ChangeTaskInput } from '../state/assistantWriteInput';
import { ensureDailyNote } from './dailyNote';
import { confirmNotesWrite } from './writeTarget';
import { resolveSourceUri } from './navigation';
import { completeDraft, readDraftStatusReading, setDraftStatus, writeEditedTask, type DraftStatusReading } from './taskEditor';
import { DEFAULT_TASK_STATUSES, normalizeStatusName, type TaskStatusDefinition } from '../../domain/tasks/taskStatuses';

/** Deckard's own statuses, written as the line already writes them. */
function readDefaultStatusReading(): DraftStatusReading {
  return { statuses: DEFAULT_TASK_STATUSES, namespace: 'status', writeAs: 'match', addCancelledDate: true };
}
import { readTaskMetadataFormat } from './taskActions';
import { WorkspaceWriteHistory } from './workspaceWrites';
import { reportError } from '../../shared/timing';
import { formatCaptureLine, getCaptureInsertion } from '../../domain/capture/captureLines';
import { WorkspaceIndex } from '../../domain/model';
import { TaskMetadataFormat } from '../../domain/markdown/taskFields';
import { CompletionWrite } from '../../domain/markdown/taskLineEdits';
import { readStepsForNextOccurrence } from '../../domain/markdown/taskSteps';
import { type DateFormats, DEFAULT_DATE_FORMATS, formatDisplayDay } from '../../domain/markdown/dateFormat';
import { readDateFormats } from './datePrompt';

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

/** The task line an added task becomes. */
export function addedTaskLine(text: string): string {
  return formatCaptureLine(text);
}

/** A task line, the changes asked of it, and how it is written. */
export interface ChangeTaskLineOptions {
  line: string;
  changes: Omit<ChangeTaskInput, 'note' | 'line'>;
  now: number;
  /** The format a line with no metadata yet is written in; emoji by default. */
  fallbackFormat?: TaskMetadataFormat;
  /** The note's line ending, which joins a repeat's next line; `\n` by default. */
  eol?: string;
  /** `deckard.tasks.addDoneDate`; off, completing writes no ✅ date. On by default. */
  addDoneDate?: boolean;
  /** The steps a repeating task's next occurrence takes, unchecked; none by default. */
  steps?: readonly string[];
  /** The statuses a `status` change is found among, and how it is written; Deckard's own by default. */
  statusReading?: DraftStatusReading;
}

/**
 * The status a change names: by its name, a hyphen or a space alike and
 * case aside, or by its character in brackets. Undefined when no status is
 * called that.
 */
export function findNamedStatus(statuses: readonly TaskStatusDefinition[], named: string): TaskStatusDefinition | undefined {
  const box = /^\[(.)\]$/u.exec(named);
  return box
    ? statuses.find((status) => status.symbol === box[1])
    : statuses.find((status) => status.type !== 'nonTask' && normalizeStatusName(status.name) === normalizeStatusName(named));
}

/** A draft with its words, due date, priority, and person changed as asked; `null` clears one. */
function changeFields(draft: TaskDraft, changes: ChangeTaskLineOptions['changes']): TaskDraft {
  return {
    ...draft,
    ...(changes.title === undefined ? {} : { description: changes.title }),
    ...(changes.due === undefined ? {} : { due: changes.due ?? undefined }),
    ...(changes.priority === undefined ? {} : { priority: changes.priority ?? undefined }),
    ...(changes.assignee === undefined ? {} : { assignee: changes.assignee ?? undefined }),
  };
}

/**
 * A task line with the requested changes made, and nothing else touched:
 * the draft keeps every field it does not name, in the format the line
 * already uses. Completing a repeating task starts its next occurrence on
 * the line above, as a checkbox does.
 */
export function changeTaskLine({
  line,
  changes,
  now,
  fallbackFormat = 'emoji',
  eol = '\n',
  addDoneDate = true,
  steps = [],
  statusReading,
}: ChangeTaskLineOptions): CompletionWrite {
  const reading = statusReading ?? readDefaultStatusReading();
  const before: TaskDraft = parseTaskDraft(line, fallbackFormat, reading.statuses);
  let draft = changeFields(before, changes);
  if (changes.complete !== undefined && changes.complete !== draft.completed) {
    draft = completeDraft(draft, now, addDoneDate);
  }
  const status = changes.status === undefined ? undefined : findNamedStatus(reading.statuses, changes.status);
  if (status) {
    draft = setDraftStatus(draft, status, { now, addDoneDate, reading });
  }
  return writeEditedTask({ before, edited: draft, now, eol, steps });
}

/** One line saying what changed, for the preview's label, its date in the reader's `formats`. */
export function describeChange(changes: Omit<ChangeTaskInput, 'note' | 'line'>, formats: DateFormats = DEFAULT_DATE_FORMATS): string {
  const parts: string[] = [];
  if (changes.title !== undefined) {parts.push('retitle it');}
  if (changes.complete === true) {parts.push('complete it');}
  if (changes.complete === false) {parts.push('reopen it');}
  if (changes.status !== undefined) {parts.push(`set its status to ${changes.status}`);}
  if (changes.due !== undefined) {parts.push(changes.due ? `make it due ${formatDisplayDay(changes.due, formats)}` : 'clear its due date');}
  if (changes.priority !== undefined) {parts.push(changes.priority ? `set its priority to ${changes.priority}` : 'clear its priority');}
  if (changes.assignee !== undefined) {parts.push(changes.assignee ? `hand it to ${changes.assignee}` : 'take it from whoever it was for');}
  return parts.join(', ');
}

/** The index a write reads, once it has finished loading. */
interface WriteIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

/** What a write tool answers: text for the assistant, and whether it was refused. */
export interface WriteAnswer {
  text: string;
  isError?: boolean;
}

/** The note a task is added to, or the refusal the assistant is answered with. */
type TargetNote = { uri: vscode.Uri } | { refusal: WriteAnswer };

/**
 * Today's daily note in the first workspace folder, created if it is
 * missing; undefined when no folder is open. Rejects when the note cannot
 * be made, such as in a folder that cannot be written to.
 */
async function ensureTodaysNote(): Promise<vscode.Uri | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && (await confirmNotesWrite(folder)) ? ensureDailyNote(folder) : undefined;
}

/**
 * The note `input` names, which must be indexed, or else today's daily note
 * from `todaysNote`. A daily note that cannot be made is refused in words
 * of its own, with the reason in Deckard's log, since there is no note
 * name to give.
 */
async function resolveTargetNote(
  index: WorkspaceIndex,
  input: AddTaskInput,
  todaysNote: () => Promise<vscode.Uri | undefined>,
): Promise<TargetNote> {
  if (input.note) {
    if (!index.files.has(input.note)) {
      return { refusal: { text: `No indexed note is at "${input.note}". Paths are workspace-relative, as deckard_query reports them.`, isError: true } };
    }
    const uri = await resolveSourceUri(input.note);
    return uri ? { uri } : { refusal: { text: `The note "${input.note}" could not be opened.`, isError: true } };
  }
  let today: vscode.Uri | undefined;
  try {
    today = await todaysNote();
  } catch (error) {
    reportError("The assistant's task could not be added: today's daily note could not be made", error);
    return { refusal: { text: "Today's daily note could not be made, so nothing was written.", isError: true } };
  }
  return today
    ? { uri: today }
    : { refusal: { text: 'No folder is open, so there is no daily note to add to.', isError: true } };
}

/**
 * Adds `input.text` as an open task to the note it names, or to today's daily
 * note, through the refactor preview. Refuses a note the index does not hold,
 * or a daily note that cannot be made, and answers with an error when the
 * reader declines the preview.
 */
export async function addTask(
  indexer: WriteIndexSource,
  history: WorkspaceWriteHistory,
  input: AddTaskInput,
  /** Today's daily note, made if missing; undefined when no folder is open. */
  todaysNote: () => Promise<vscode.Uri | undefined> = ensureTodaysNote,
): Promise<WriteAnswer> {
  await indexer.ready;
  const target = await resolveTargetNote(indexer.getSnapshot(), input, todaysNote);
  if ('refusal' in target) {
    return target.refusal;
  }
  const { uri } = target;
  const document = await vscode.workspace.openTextDocument(uri);
  const line = addedTaskLine(input.text);
  const insertion = getCaptureInsertion(document.getText(), line);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(insertion.line, insertion.character), insertion.text);
  const written = await history.write(edit, {
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

/**
 * Makes the requested changes to the task at `input.note` line `input.line`,
 * through the refactor preview. Refuses when no task is indexed there, or
 * when the line no longer reads as the index knows it, so a stale answer
 * cannot rewrite whatever is there now.
 */
export async function changeTask(
  indexer: WriteIndexSource,
  history: WorkspaceWriteHistory,
  input: ChangeTaskInput,
  now = Date.now(),
): Promise<WriteAnswer> {
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
  const configuration = vscode.workspace.getConfiguration('deckard', uri);
  const statusReading = readDraftStatusReading(uri);
  if (changes.status !== undefined && !findNamedStatus(statusReading.statuses, changes.status)) {
    const names = statusReading.statuses.filter((status) => status.type !== 'nonTask').map((status) => status.name);
    return { text: `No status is called "${changes.status}". The statuses are ${[...new Set(names)].join(', ')}; or name one by its character, as [/].`, isError: true };
  }
  const completion = changeTaskLine({
    statusReading,
    line: current.text,
    changes,
    now,
    fallbackFormat: readTaskMetadataFormat(configuration),
    eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    addDoneDate: configuration.get<boolean>('tasks.addDoneDate', true),
    // A next occurrence takes the task's steps back unchecked, as a checkbox's does.
    steps: readStepsForNextOccurrence(document.getText().split(/\r?\n/), task.lineNumber - 1),
  });
  const replacement = completion.text;
  if (replacement === current.text) {
    return { text: 'The task already reads that way; nothing to change.' };
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, current.range, replacement);
  const written = await history.write(edit, {
    label: 'Assistant: change a task',
    description: `${describeChange(changes, readDateFormats())} — "${shorten(task.title)}" in ${task.filePath}`,
    preview: 'always',
  });
  if (!written.applied) {
    return { text: 'The user declined the change in the preview. Nothing was written.', isError: true };
  }
  return {
    text: `Changed ${task.filePath} line ${task.lineNumber}:\n${replacement}${describeRepeat(completion)}\nThe user can take it back with Deckard: Undo Last Change.`,
  };
}

/** The sentence on a repeat's next occurrence, or on its unreadable rule; empty for a task that does not repeat. */
function describeRepeat(completion: CompletionWrite): string {
  if (completion.next !== undefined) {
    return `\nIt repeats, so the next one was added above it: ${completion.next}`;
  }
  if (completion.unreadRule !== undefined) {
    return `\nIts repeat rule "${completion.unreadRule}" could not be read, so no next one was added.`;
  }
  return '';
}

/** The text cut to 60 characters with an ellipsis, so a preview label stays one line. */
function shorten(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

