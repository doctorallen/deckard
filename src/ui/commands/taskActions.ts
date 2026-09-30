import * as vscode from 'vscode';

import { getTaskLineId, parseMarkdown } from '../../core/markdown/parser';
import {
  findCheckboxColumn,
  findStepFamily,
  isCheckedTaskLine,
  readStepsForNextOccurrence,
} from '../../core/markdown/taskSteps';
import {
  formatIsoDate,
  parseTaskMetadata,
  setTaskLineCompletion,
  TaskMetadataFormat,
  writeCompletion,
} from '../../core/markdown/taskMetadata';
import { Task } from '../../core/types';
import { openSourceAt, resolveSourceUri } from './navigation';
import {
  describeRejectedEdit,
  noteName,
  openNoteAction,
  reindexAction,
  reportFailure,
  reportStale,
} from './notify';
import { WorkspaceWriteHistory } from './workspaceWrites';

/**
 * Carries a task's place in the rank order from the line it was to the line
 * it becomes. A task's id comes from its own text, so an edit Deckard writes
 * makes it a new task to anything keyed by id; the extension's keeper moves
 * its place in the preferences to the new id. Made once, where the
 * preferences live, and handed to whatever edits a task.
 */
export type TaskRankKeeper = (previousId: string, nextId: string) => void;

/**
 * Tells the rank order that a task's line was rewritten, so a completed task
 * and a task put back by Undo both keep the place they were dragged to.
 * `task` is the line as it was, its number one-based, and `replacement` what
 * was written over it.
 */
export function carryTaskRank(
  keepRank: TaskRankKeeper,
  task: Pick<Task, 'filePath' | 'lineNumber' | 'id'>,
  replacement: string,
): void {
  // A completion may add a line above, so the task is the last line written.
  const lines = replacement.split(/\r?\n/);
  const nextId = getTaskLineId(
    task.filePath,
    task.lineNumber + lines.length - 1,
    lines[lines.length - 1],
  );
  if (nextId) {
    keepRank(task.id, nextId);
  }
}

/**
 * Tells the rank order that a task now lives on another line, in its own
 * note or another one, as Move to… leaves it, so it keeps its place on the
 * board. The line is one-based.
 */
export function carryMovedTaskRank(
  keepRank: TaskRankKeeper,
  previousId: string,
  to: { filePath: string; lineNumber: number; lineText: string },
): void {
  const nextId = getTaskLineId(to.filePath, to.lineNumber, to.lineText);
  if (nextId) {
    keepRank(previousId, nextId);
  }
}

/**
 * What an edit to a task reaches beyond its own line: the write history,
 * which marks the note's save as Deckard's own so the index reads it back at
 * once, and keeps Complete Steps as the write Undo takes back; and the rank
 * keeper, which carries the task's place in the rank order to its new id.
 * Created once, where the extension starts, and handed to whatever edits a
 * task.
 */
export interface TaskWrites {
  readonly history: WorkspaceWriteHistory;
  readonly keepRank: TaskRankKeeper;
}

/** What an edit to a task line may need to know about its document. */
export interface TaskLineContext {
  uri: vscode.Uri;
  /** The document's line ending, for an edit that adds a line. */
  eol: string;
  /** The note's lines as they are before the edit. */
  lines: readonly string[];
  /** The task's own line among them, 0-based. */
  lineIndex: number;
}

/**
 * Rewrites a task's line after proving the indexed source is unchanged.
 *
 * The line comparison prevents a delayed webview action from overwriting edits
 * made after the task was indexed. Every edit Deckard makes to a task, from
 * its checkbox to a task-board move, goes through here.
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
  const uri = await resolveSourceUri(task.filePath);
  if (!uri) {
    void reportFailure({
      outcome: `Deckard could not find ${task.filePath}, so nothing was written.`,
      fix: 'It may have been moved or deleted since Deckard last read it.',
      action: reindexAction(),
    });
    return false;
  }

  // Once VS Code has taken the edit, a failure is only a failure to save.
  let applied = false;
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const sourceLine = readIndexedTaskLine(document, task);
    if (!sourceLine) {
      void reportStale([uri]);
      return false;
    }
    const line = sourceLine.text;

    const replacement = transform(line, {
      uri,
      eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
      lines: document.getText().split(/\r?\n/),
      lineIndex: task.lineNumber - 1,
    });
    if (replacement === line) {
      return true;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, sourceLine.range, replacement);
    if (!(await vscode.workspace.applyEdit(edit))) {
      void reportFailure(describeRejectedEdit(noteName(uri)));
      return false;
    }
    applied = true;

    const updatedDocument =
      vscode.workspace.textDocuments.find(
        (openDocument) => openDocument.uri.toString() === uri.toString(),
      ) ?? (await vscode.workspace.openTextDocument(uri));
    writes.history.ownWrites.note(updatedDocument.uri.toString());
    if (!(await updatedDocument.save())) {
      void reportFailure(describeUnsavedTaskEdit(uri));
      return false;
    }
    carryTaskRank(writes.keepRank, task, replacement);
    const described =
      typeof description === 'function' ? description() : description;
    const said =
      typeof described === 'string'
        ? { text: described, severity: 'info' as const }
        : described;
    if (said?.text) {
      offerUndo(
        said,
        { uri, lineNumber: task.lineNumber, replacement, original: line, filePath: task.filePath },
        writes.keepRank,
      );
    }
    return true;
  } catch (error) {
    void reportFailure(
      applied
        ? { ...describeUnsavedTaskEdit(uri), error }
        : {
            outcome: `Deckard could not update the task in ${noteName(uri)}, so nothing was written.`,
            error,
          },
    );
    return false;
  }
}

/**
 * A task's line in its note, if it still reads as the index read it: the
 * same text, with the checkbox where it was. A line past the end of the note
 * is a line that changed too.
 */
export function readIndexedTaskLine(
  document: vscode.TextDocument,
  task: Pick<Task, 'lineNumber' | 'sourceLineText' | 'checkboxColumn' | 'checkboxValue'>,
): vscode.TextLine | undefined {
  if (
    task.lineNumber < 1 ||
    task.lineNumber > document.lineCount ||
    document.lineAt(task.lineNumber - 1).text !== task.sourceLineText
  ) {
    return undefined;
  }
  const sourceLine = document.lineAt(task.lineNumber - 1);
  const line = sourceLine.text;
  if (
    line[task.checkboxColumn] !== task.checkboxValue ||
    line[task.checkboxColumn - 1] !== '[' ||
    line[task.checkboxColumn + 1] !== ']'
  ) {
    return undefined;
  }
  return sourceLine;
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
 * A task line as an edit left it, and as it was: its note, its one-based
 * line, what was written, and what was there. `filePath` is the index's path
 * for the note, which the rank order is keyed by.
 */
interface TaskLineEdit {
  uri: vscode.Uri;
  lineNumber: number;
  replacement: string;
  original: string;
  filePath?: string;
}

/**
 * Says what was written to a note, and offers to put it back.
 *
 * A board move or a checkbox writes to a file the reader may not have open,
 * saves it, and leaves no trace on screen. The message is the only account of
 * the edit, so it carries the way out of it.
 */
function offerUndo(
  description: CompletionMessage,
  written: TaskLineEdit,
  keepRank: TaskRankKeeper,
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
        void revertTaskLine(written, keepRank);
      } else if (choice !== undefined && choice === description.action?.label) {
        void description.action.run();
      }
    });
}

/**
 * Puts a task line back the way it was.
 *
 * The edit may have added a line, such as the next occurrence of a repeating
 * task, so the whole written range goes back. Anything that has changed the
 * range since is left alone rather than overwritten.
 */
async function revertTaskLine(
  { uri, lineNumber, replacement, original, filePath }: TaskLineEdit,
  keepRank: TaskRankKeeper,
): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const writtenLines = replacement.split(/\r?\n/).length;
    const lastLine = lineNumber - 2 + writtenLines;
    if (lineNumber < 1 || lastLine >= document.lineCount) {
      void reportStale([uri]);
      return;
    }
    const range = new vscode.Range(
      new vscode.Position(lineNumber - 1, 0),
      document.lineAt(lastLine).range.end,
    );
    if (document.getText(range) !== replacement) {
      void reportStale([uri]);
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, range, original);
    if (await vscode.workspace.applyEdit(edit)) {
      await document.save();
      // The line is the one it was, so the task is too: give it back the
      // place in the rank order the edit carried away.
      if (filePath) {
        const written = replacement.split(/\r?\n/);
        const writtenId = getTaskLineId(
          filePath,
          lineNumber + written.length - 1,
          written[written.length - 1],
        );
        const restoredId = getTaskLineId(filePath, lineNumber, original);
        if (writtenId && restoredId) {
          keepRank(writtenId, restoredId);
        }
      }
    }
  } catch (error) {
    void reportFailure({
      outcome: `Deckard could not undo the task edit in ${noteName(uri)}, so the note keeps the edit.`,
      error,
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
  // A repeating task is completed and immediately replaced by its next
  // occurrence, which looks like nothing happened unless the edit says so.
  // A rule that could not be read is said in the same message, beside Undo.
  let startedNext: string | undefined;
  let unreadRule: string | undefined;
  // What the note says about the task's steps, read as the edit is made.
  let family: CompletionFamily | undefined;
  const description = (): string | CompletionMessage =>
    completed
      ? describeStepsCompletion(writes, task, describeCompletion(task.title, startedNext, unreadRule), family)
      : `Reopened ${quoteTaskTitle(task)}.`;
  return updateTaskLine(
    writes,
    task,
    (line, { uri, eol, lines, lineIndex }) => {
      const now = Date.now();
      const configuration = vscode.workspace.getConfiguration('deckard', uri);
      const addDoneDate = configuration.get<boolean>('tasks.addDoneDate', true);
      const replacement = setTaskLineCompletion(
        line,
        task.checkboxColumn,
        completed,
        addDoneDate ? formatIsoDate(now) : undefined,
        readTaskMetadataFormat(configuration),
      );
      if (!completed || task.completed) {
        return replacement;
      }

      const completion = writeCompletion(
        replacement,
        task.checkboxColumn,
        now,
        eol,
        readStepsForNextOccurrence(lines, lineIndex),
      );
      startedNext = completion.next;
      unreadRule = completion.unreadRule;
      family = readCompletionFamily(uri, task.filePath, lines, lineIndex, completion.text);
      return completion.text;
    },
    description,
  );
}

/**
 * What completing a task means for its steps, read from the note as it was
 * before the edit: the task whose last open step this was, or how many of
 * its own steps are still open.
 */
interface CompletionFamily {
  uri: vscode.Uri;
  filePath: string;
  /** The task this was the last open step of: its line, 0-based, and words. */
  lastStepOf?: { line: number; title: string };
  /** The task's own open steps. */
  openSteps: number;
  /** The completed task's line once the edit is written, 0-based. */
  writtenLine: number;
}

function readCompletionFamily(
  uri: vscode.Uri,
  filePath: string,
  lines: readonly string[],
  lineIndex: number,
  written: string,
): CompletionFamily {
  const family = findStepFamily(lines, lineIndex);
  const openSteps = family.steps.filter((line) => !isCheckedTaskLine(lines[line])).length;
  let lastStepOf: CompletionFamily['lastStepOf'];
  if (family.parent !== undefined && !isCheckedTaskLine(lines[family.parent])) {
    const stillOpen = findStepFamily(lines, family.parent).steps.filter(
      (line) => line !== lineIndex && !isCheckedTaskLine(lines[line]),
    );
    if (stillOpen.length === 0) {
      lastStepOf = { line: family.parent, title: readTaskWords(lines[family.parent]) };
    }
  }
  return {
    uri,
    filePath,
    openSteps,
    // A next occurrence written above moves the completed line down.
    writtenLine: lineIndex + written.split(/\r?\n/).length - 1,
    ...(lastStepOf ? { lastStepOf } : {}),
  };
}

/** A task line's words, its metadata left out. */
function readTaskWords(line: string): string {
  const words = line.slice(findCheckboxColumn(line) + 2).trim();
  return parseTaskMetadata(words).title || words;
}

/**
 * A completion's message, with what it offers next: finishing the task
 * whose last step this was, or finishing the steps a task still has open.
 * Neither is done for the reader.
 */
export function describeStepsCompletion(
  writes: TaskWrites,
  task: Pick<Task, 'title'>,
  said: CompletionMessage,
  family: CompletionFamily | undefined,
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
  const document = await vscode.workspace.openTextDocument(uri);
  const task = parseMarkdown(filePath, document.getText()).tasks.find(
    (candidate) => candidate.lineNumber === line + 1,
  );
  if (!task || task.completed) {
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
  const document = await vscode.workspace.openTextDocument(uri);
  const lines = document.getText().split(/\r?\n/);
  const open = findStepFamily(lines, taskLine).steps.filter((line) => !isCheckedTaskLine(lines[line]));
  if (open.length === 0) {
    void reportStale([uri]);
    return;
  }
  const configuration = vscode.workspace.getConfiguration('deckard', uri);
  const doneDate = configuration.get<boolean>('tasks.addDoneDate', true)
    ? formatIsoDate(Date.now())
    : undefined;
  const format = readTaskMetadataFormat(configuration);
  const edit = new vscode.WorkspaceEdit();
  open.forEach((line) => {
    const text = lines[line];
    edit.replace(
      uri,
      document.lineAt(line).range,
      setTaskLineCompletion(text, findCheckboxColumn(text), true, doneDate, format),
    );
  });
  const steps = `${open.length} ${open.length === 1 ? 'step' : 'steps'}`;
  const result = await writes.history.write(edit, {
    label: `completing ${steps} of ${quoteTitle(title)}`,
  });
  if (!result.applied) {
    void reportFailure(describeRejectedEdit(noteName(uri)));
    return;
  }
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

/** A task's words, quoted and short enough to sit in a notification. */
export function quoteTitle(text: string): string {
  const title = text.trim();
  return `"${title.length > 60 ? `${title.slice(0, 57)}…` : title}"`;
}

/**
 * The Tasks format Deckard writes for a task that has no metadata yet. A task
 * that already has some keeps its own format.
 */
export function readTaskMetadataFormat(
  configuration: vscode.WorkspaceConfiguration,
): TaskMetadataFormat {
  return configuration.get<string>('tasks.metadataFormat', 'emoji') ===
    'dataview'
    ? 'dataview'
    : 'emoji';
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
