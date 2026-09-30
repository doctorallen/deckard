import * as vscode from 'vscode';

import {
  parseTaskDraft,
  TaskDraft,
} from '../../domain/markdown/taskDraft';
import {
  CompletionWrite,
  formatIsoDate,
  TaskMetadataFormat,
} from '../../domain/markdown/taskMetadata';
import { WorkspaceIndex } from '../../core/types';
import { AddTaskInput, ChangeTaskInput } from '../state/assistantWriteInput';
import { formatCaptureLine, getCaptureInsertion } from './capture';
import { ensureDailyNote } from './dailyNote';
import { resolveSourceUri } from './navigation';
import { completeDraft, writeEditedTask } from './taskEditor';
import { readTaskMetadataFormat } from './taskActions';
import { WorkspaceWriteHistory } from './workspaceWrites';

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

export {
  ADD_TASK_TOOL_NAME,
  CHANGE_TASK_TOOL_NAME,
  readAddTaskInput,
  readChangeTaskInput,
} from '../state/assistantWriteInput';
export type { AddTaskInput, ChangeTaskInput } from '../state/assistantWriteInput';

/** The task line an added task becomes. */
export function addedTaskLine(text: string): string {
  return formatCaptureLine(text);
}

/**
 * A task line with the requested changes made, and nothing else touched:
 * the draft keeps every field it does not name, in the format the line
 * already uses. Completing a repeating task starts its next occurrence on
 * the line above, as a checkbox does.
 */
export function changeTaskLine(
  line: string,
  changes: Omit<ChangeTaskInput, 'note' | 'line'>,
  now: number,
  fallbackFormat: TaskMetadataFormat = 'emoji',
  eol = '\n',
  /** `deckard.tasks.addDoneDate`; off, completing writes no ✅ date. */
  addDoneDate = true,
): CompletionWrite {
  const before: TaskDraft = parseTaskDraft(line, fallbackFormat);
  let draft = before;
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
    draft = completeDraft(draft, now, addDoneDate);
  }
  return writeEditedTask(before, draft, now, eol);
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

export async function addTask(
  indexer: WriteIndexSource,
  history: WorkspaceWriteHistory,
  input: AddTaskInput,
): Promise<WriteAnswer> {
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
  const completion = changeTaskLine(
    current.text,
    changes,
    now,
    readTaskMetadataFormat(configuration),
    document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
    configuration.get<boolean>('tasks.addDoneDate', true),
  );
  const replacement = completion.text;
  if (replacement === current.text) {
    return { text: 'The task already reads that way; nothing to change.' };
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, current.range, replacement);
  const written = await history.write(edit, {
    label: 'Assistant: change a task',
    description: `${describeChange(changes)} — "${shorten(task.title)}" in ${task.filePath}`,
    preview: 'always',
  });
  if (!written.applied) {
    return { text: 'The user declined the change in the preview. Nothing was written.', isError: true };
  }
  const repeat =
    completion.next !== undefined
      ? `\nIt repeats, so the next one was added above it: ${completion.next}`
      : completion.unreadRule !== undefined
        ? `\nIts repeat rule "${completion.unreadRule}" could not be read, so no next one was added.`
        : '';
  return {
    text: `Changed ${task.filePath} line ${task.lineNumber}:\n${replacement}${repeat}\nThe user can take it back with Deckard: Undo Last Change.`,
  };
}

function shorten(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

export { formatIsoDate as formatDayForTask };
