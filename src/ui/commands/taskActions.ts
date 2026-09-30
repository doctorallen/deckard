import * as vscode from 'vscode';

import { parseTaskMetadata, TaskMetadataFormat } from '../../domain/markdown/taskMetadata';
import { CompletionFamily, countSteps, quoteTitle, readMetadataFormat } from '../../domain/tasks/taskLines';
import { Task } from '../../core/types';
import {
  Completion,
  LineRevert,
  LineUpdate,
  TaskLineContext as ServiceLineContext,
  TaskRankKeeper,
  TaskService,
  WrittenTaskLine,
} from '../../services/taskService';
import { MoveService } from '../../services/moveService';
import { openSourceAt } from './navigation';
import {
  describeRejectedEdit,
  noteName,
  openNoteAction,
  reindexAction,
  reportFailure,
  reportStale,
} from './notify';
import { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';

export type { TaskRankKeeper } from '../../services/taskService';
export { quoteTitle } from '../../domain/tasks/taskLines';

/**
 * What an edit to a task reaches: the task service, which makes every edit
 * to a task line and carries the task's place in the rank order to its new
 * id; the write history, which marks the note's save as Deckard's own so the
 * index reads it back at once, and keeps Complete Steps as the write Undo
 * takes back; and the rank keeper itself. Created once, where the extension
 * starts, and handed to whatever edits a task.
 */
export interface TaskWrites {
  readonly history: WorkspaceWriteHistory;
  readonly keepRank: TaskRankKeeper;
  readonly tasks: TaskService<vscode.Uri, WriteHandle>;
  /** Move to…, which takes tasks and lines to another heading or note. */
  readonly moves: MoveService<vscode.Uri, WriteHandle>;
}

/** What an edit to a task line may need to know about its document. */
export type TaskLineContext = ServiceLineContext<vscode.Uri>;

/**
 * Rewrites a task's line after proving the indexed source is unchanged.
 *
 * The line comparison prevents a delayed webview action from overwriting edits
 * made after the task was indexed. Every edit Deckard makes to a task, from
 * its checkbox to a task-board move, goes through here; the task service
 * makes the edit, and this says what became of it.
 */
export async function updateTaskLine(
  writes: TaskWrites,
  task: Task,
  transform: (line: string, context: TaskLineContext) => string,
  /**
   * What to tell the reader was written, such as "Completed 'Send proposal'".
   * An edit that says what it did is offered with an Undo; one that passes
   * nothing is silent, for edits the reader is already watching happen. A
   * function is read after the edit, for an edit that only then knows what it
   * did, such as a completion that started the next occurrence.
   */
  description?: string | (() => string | CompletionMessage),
): Promise<boolean> {
  return presentLineUpdate(writes, task, await writes.tasks.updateLine(task, transform), description);
}

/**
 * Says what became of a task line's edit: the failure, with its way out, or
 * what was written, offered with an Undo. Returns whether the edit stands.
 */
function presentLineUpdate<T>(
  writes: TaskWrites,
  task: Pick<Task, 'filePath'>,
  result: LineUpdate<vscode.Uri, T>,
  description?: string | (() => string | CompletionMessage),
): boolean {
  if (result.kind !== 'updated') {
    reportLineFailure(task, result);
    return result.kind === 'unchanged';
  }
  const described = typeof description === 'function' ? description() : description;
  const said =
    typeof described === 'string'
      ? { text: described, severity: 'info' as const }
      : described;
  if (said?.text) {
    offerUndo(writes, said, result.written);
  }
  return true;
}

/** Says why a task line's edit wrote nothing, or was not saved. */
function reportLineFailure<T>(
  task: Pick<Task, 'filePath'>,
  result: Exclude<LineUpdate<vscode.Uri, T>, { kind: 'updated' }>,
): void {
  switch (result.kind) {
    case 'unchanged':
      return;
    case 'missing':
      void reportFailure({
        outcome: `Deckard could not find ${task.filePath}, so nothing was written.`,
        fix: 'It may have been moved or deleted since Deckard last read it.',
        action: reindexAction(),
      });
      return;
    case 'stale':
      void reportStale([result.uri]);
      return;
    case 'rejected':
      void reportFailure(describeRejectedEdit(noteName(result.uri)));
      return;
    case 'unsaved':
      void reportFailure(
        'error' in result
          ? { ...describeUnsavedTaskEdit(result.uri), error: result.error }
          : describeUnsavedTaskEdit(result.uri),
      );
      return;
    case 'failed':
      void reportFailure({
        outcome: `Deckard could not update the task in ${noteName(result.uri)}, so nothing was written.`,
        error: result.error,
      });
      return;
  }
}

/** The task changed in the editor, but the note on disk did not. */
function describeUnsavedTaskEdit(uri: vscode.Uri) {
  return {
    outcome: `Deckard changed the task in ${noteName(uri)} but could not save the note.`,
    fix: 'Save it to keep the change.',
    action: openNoteAction(uri),
  };
}

/**
 * Says what was written to a note, and offers to put it back.
 *
 * A board move or a checkbox writes to a file the reader may not have open,
 * saves it, and leaves no trace on screen. The message is the only account of
 * the edit, so it carries the way out of it.
 */
function offerUndo(
  writes: TaskWrites,
  description: CompletionMessage,
  written: WrittenTaskLine<vscode.Uri>,
): void {
  // A warning when part of what was asked could not be done, such as a
  // repeat rule Deckard could not read; the edit is still offered back.
  // A next step, such as completing the task whose last step this was,
  // is offered before Undo, and is never taken for the reader.
  const choices = description.action ? [description.action.label, 'Undo'] : ['Undo'];
  void (
    description.severity === 'warning'
      ? vscode.window.showWarningMessage(description.text, ...choices)
      : vscode.window.showInformationMessage(description.text, ...choices)
  ).then((choice) => {
      if (choice === 'Undo') {
        void revertTaskLine(writes, written);
      } else if (choice !== undefined && choice === description.action?.label) {
        void description.action.run();
      }
    });
}

/**
 * Puts a task line back the way it was, through the task service, and says
 * so only when it could not: the range changed since, or the undo failed.
 */
async function revertTaskLine(
  writes: TaskWrites,
  written: WrittenTaskLine<vscode.Uri>,
): Promise<void> {
  const result: LineRevert<vscode.Uri> = await writes.tasks.revertLine(written);
  if (result.kind === 'stale') {
    void reportStale([result.uri]);
    return;
  }
  if (result.kind === 'failed') {
    void reportFailure({
      outcome: `Deckard could not undo the task edit in ${noteName(result.uri)}, so the note keeps the edit.`,
      error: result.error,
    });
  }
}

/**
 * Completes or reopens a task.
 *
 * Besides the checkbox, the edit keeps the Obsidian Tasks metadata in step: a
 * done date is added on completion and removed on reopening, and completing a
 * task with a repeat rule writes its next occurrence on the line above, where
 * Tasks puts it.
 */
export async function toggleTask(
  writes: TaskWrites,
  task: Task,
  completed: boolean,
): Promise<boolean> {
  const result = await writes.tasks.toggle(task, completed);
  // A repeating task is completed and immediately replaced by its next
  // occurrence, which looks like nothing happened unless the edit says so.
  // A rule that could not be read is said in the same message, beside Undo.
  const description = (): string | CompletionMessage => {
    if (!completed) {
      return `Reopened ${quoteTaskTitle(task)}.`;
    }
    const outcome: Completion | undefined = result.kind === 'updated' ? result.outcome : undefined;
    const family =
      result.kind === 'updated' && outcome?.family
        ? { ...outcome.family, uri: result.written.uri, filePath: task.filePath }
        : undefined;
    return describeStepsCompletion(
      writes,
      task,
      describeCompletion(task.title, outcome?.next, outcome?.unreadRule),
      family,
    );
  };
  return presentLineUpdate(writes, task, result, description);
}

/** What the note says about a completed task's steps, and where the note is. */
type StepsFamily = CompletionFamily & { uri: vscode.Uri; filePath: string };

/**
 * A completion's message, with what it offers next: finishing the task
 * whose last step this was, or finishing the steps a task still has open.
 * Neither is done for the reader.
 */
export function describeStepsCompletion(
  writes: TaskWrites,
  task: Pick<Task, 'title'>,
  said: CompletionMessage,
  family: StepsFamily | undefined,
): CompletionMessage {
  if (!family) {
    return said;
  }
  const plain = said.text === `Completed ${quoteTitle(task.title)}.`;
  if (family.lastStepOf) {
    const parent = quoteTitle(family.lastStepOf.title);
    const { line } = family.lastStepOf;
    return {
      ...said,
      text: plain
        ? `Completed ${quoteTitle(task.title)}, the last open step of ${parent}.`
        : `${said.text} It was the last open step of ${parent}.`,
      action: { label: 'Complete Task', run: () => completeTaskAtLine(writes, family.uri, family.filePath, line) },
    };
  }
  if (family.openSteps > 0) {
    const count = family.openSteps;
    return {
      ...said,
      text: `${said.text} ${count} of its steps ${count === 1 ? 'is' : 'are'} still open.`,
      action: {
        label: 'Complete Steps',
        run: () => completeOpenSteps(writes, family.uri, family.writtenLine, task.title),
      },
    };
  }
  return said;
}

/** Completes the task written on a line, through the usual completion. */
async function completeTaskAtLine(
  writes: TaskWrites,
  uri: vscode.Uri,
  filePath: string,
  line: number,
): Promise<void> {
  const task = await writes.tasks.findOpenTaskAt(uri, filePath, line);
  if (!task) {
    void reportStale([uri]);
    return;
  }
  await toggleTask(writes, task, true);
}

/**
 * Completes the open steps written directly under a task, in one change
 * that Undo takes back.
 */
async function completeOpenSteps(
  writes: TaskWrites,
  uri: vscode.Uri,
  taskLine: number,
  title: string,
): Promise<void> {
  const result = await writes.tasks.completeSteps(uri, taskLine, title);
  if (result.kind === 'stale') {
    void reportStale([uri]);
    return;
  }
  if (result.kind !== 'written') {
    void reportFailure(describeRejectedEdit(noteName(uri)));
    return;
  }
  const steps = countSteps(result.count);
  result.handle.offerUndo(`Completed ${steps} of ${quoteTitle(title)}.`, {
    guard: 'latest',
    done: `Reopened the ${steps}.`,
  });
}

/** What one completion says, and whether it is worth a warning. */
export interface CompletionMessage {
  text: string;
  severity: 'info' | 'warning';
  /** What the message offers to do next, beside Undo. */
  action?: { label: string; run: () => Promise<void> };
}

/**
 * The one sentence a completion says, wherever the task was completed: the
 * next occurrence it started, or the repeat rule it could not read.
 */
export function describeCompletion(
  title: string,
  next?: string,
  unreadRule?: string,
): CompletionMessage {
  const quoted = quoteTitle(title);
  if (next !== undefined) {
    return {
      text: `Completed ${quoted}, and started the next one${describeNextOccurrence(next)}.`,
      severity: 'info',
    };
  }
  if (unreadRule !== undefined) {
    return {
      text: `Completed ${quoted}. Deckard could not read its repeat rule "${unreadRule}", so no next one was added.`,
      severity: 'warning',
    };
  }
  return { text: `Completed ${quoted}.`, severity: 'info' };
}

/** When the occurrence a completion started is next wanted, if it says. */
export function describeNextOccurrence(line: string): string {
  const { metadata } = parseTaskMetadata(line);
  const when = metadata.due ?? metadata.scheduled ?? metadata.start;
  return when ? `, ${metadata.due ? 'due' : 'scheduled'} ${when}` : '';
}

/** A task's title, short enough to sit in a notification. */
export function quoteTaskTitle(task: Task): string {
  return quoteTitle(task.title);
}

/**
 * The Tasks format Deckard writes for a task that has no metadata yet. A task
 * that already has some keeps its own format.
 */
export function readTaskMetadataFormat(
  configuration: vscode.WorkspaceConfiguration,
): TaskMetadataFormat {
  return readMetadataFormat(configuration);
}

/**
 * Reuses the shared source navigation path so task clicks and section clicks
 * resolve relative and multi-root paths identically.
 */
export async function openTask(
  task: Task,
): Promise<vscode.TextEditor | undefined> {
  return openSourceAt(task.filePath, task.lineNumber);
}
