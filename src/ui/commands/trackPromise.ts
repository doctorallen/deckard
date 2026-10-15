import * as vscode from 'vscode';

import { formatShortDay } from '../../domain/markdown/dates';
import { formatTaskDraft, parseTaskDraft } from '../../domain/markdown/taskDraft';
import type { WorkspaceIndex } from '../../domain/model';
import { formatLocalDate } from '../../domain/notes/periodicNotes';
import { findDailyNoteDate } from '../../domain/markdown/parser';
import {
  findPromises,
  formatPromiseTask,
  PromiseLine,
  PromiseReading,
  promiseLineKey,
  readPromiseLine,
} from '../../domain/tasks/promises';
import { personFirstName } from '../state/betweenYou';
import { readTopHeadings } from './activeNoteContext';
import { readDateFormats, readDateOptions } from './datePrompt';
import { describeRejectedEdit, describeStale, noteName, reportFailure } from './notify';
import { readEntityNamespaceAliases, readTaskStatusOptions } from './parseSettings';
import { readTaskMetadataFormat } from './taskActions';
import { editTaskDraft, readDraftStatusReading } from './taskEditor';

/**
 * Said they would (docs/implementation/41-said-they-would.md): what the
 * lens and the lightbulb on a promise in today's note run, Track and Not a
 * promise, and the settings a promise is read and written with.
 */

/** Tracks a promise as a waiting task under its line; its arguments are the note, the line, its words, and whether to open the task editor first. */
export const TRACK_PROMISE_COMMAND = 'deckard.trackPromise';
/** Marks a line as no promise; its arguments are the note and the line's words. */
export const NOT_A_PROMISE_COMMAND = 'deckard.notAPromise';

/** A line of a note a promise was offered on, and its words when it was. */
export interface PromiseLineAt {
  documentUri: string;
  /** 0-based. */
  line: number;
  text: string;
}

/** What the commands read the index through. */
export interface PromiseIndex {
  getSnapshot(): WorkspaceIndex;
}

/** What remembers the lines marked as no promise. */
export interface PromiseMarks {
  has(noteKey: string, lineKey: string): boolean;
  add(noteKey: string, lineKey: string): Promise<void>;
}

/** How a note's promises are read: the moment, the reader, and their date and tag settings. */
export function readPromiseSettings(scope: vscode.Uri, now: number): PromiseReading {
  const identity = vscode.workspace.getConfiguration('deckard', scope).get<unknown>('me', '');
  return {
    now,
    dateOptions: readDateOptions(),
    ...(typeof identity === 'string' && identity.trim() ? { identity: identity.trim() } : {}),
    aliases: readEntityNamespaceAliases(scope),
  };
}

/** Whether a document is the daily note for the day `now` falls on, by its name or its top heading. */
export function isTodaysNote(document: vscode.TextDocument, now: number): boolean {
  const lines = document.getText().split(/\r?\n/);
  return findDailyNoteDate(document.uri.path, readTopHeadings(lines)) === formatLocalDate(new Date(now));
}

/**
 * The promises of a note the reader has not marked as none, its lines read
 * as they are in the editor. The caller decides that the note is today's.
 */
export function findOpenPromises(document: vscode.TextDocument, marks: Pick<PromiseMarks, 'has'>, now: number): PromiseLine[] {
  const lines = document.getText().split(/\r?\n/);
  const noteKey = document.uri.toString();
  return findPromises(lines, readPromiseSettings(document.uri, now)).filter(
    (promise) => !marks.has(noteKey, promiseLineKey(lines[promise.line])),
  );
}

/** How a promise is named on its lens and in its actions: the person's first name and the day, short. */
export interface PromiseWords {
  name: string;
  day: string;
}

/** The person's first name, `Sam`, and the day in the reader's short format. */
export function describePromise(promise: PromiseLine, index: WorkspaceIndex, now: number): PromiseWords {
  return {
    name: personFirstName(index, promise.personKey),
    day: formatShortDay(promise.due, now, readDateFormats()),
  };
}

/** The waiting task's line, in the note's format and the reader's statuses. */
export function formatPromiseLine(document: vscode.TextDocument, promise: PromiseLine): string {
  return formatPromiseTask(document.getText().split(/\r?\n/), promise, {
    format: readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard', document.uri)),
    statuses: readTaskStatusOptions(document.uri),
  });
}

/**
 * One edit writing a task line under a promise's line, so one undo takes it
 * back: before the next line, or after the last.
 */
export function createPromiseEdit(document: vscode.TextDocument, line: number, text: string): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  if (line + 1 < document.lineCount) {
    edit.insert(document.uri, new vscode.Position(line + 1, 0), `${text}${eol}`);
  } else {
    edit.insert(document.uri, document.lineAt(line).range.end, `${eol}${text}`);
  }
  return edit;
}

/**
 * Track: writes the promise on a note's line as a waiting task under it,
 * or with `edit`, opens the task editor on that task first, to change its
 * day or its words. Nothing is written when the line changed since the
 * lens or the lightbulb offered it, or no longer reads as a promise.
 * Returns the line written.
 */
export async function trackPromiseCommand(
  index: PromiseIndex,
  { documentUri, line, text }: PromiseLineAt,
  { edit = false, now = Date.now() }: { edit?: boolean; now?: number } = {},
): Promise<string | undefined> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
  const promise = readPromiseAt(document, line, text, now);
  if (!promise) {
    return undefined;
  }
  let written = formatPromiseLine(document, promise);
  if (edit) {
    const status = readDraftStatusReading(document.uri);
    const format = readTaskMetadataFormat(vscode.workspace.getConfiguration('deckard', document.uri));
    const { name } = describePromise(promise, index.getSnapshot(), now);
    const edited = await editTaskDraft(parseTaskDraft(written, format, status.statuses), {
      title: `Track as waiting on ${name}`,
      index,
      now,
      status,
    });
    if (!edited || !readPromiseAt(document, line, text, now)) {
      return undefined;
    }
    written = formatTaskDraft(edited);
  }
  if (!(await vscode.workspace.applyEdit(createPromiseEdit(document, line, written)))) {
    void reportFailure(describeRejectedEdit(noteName(document.uri)));
    return undefined;
  }
  return written;
}

/**
 * The promise on a line that still reads as it did when it was offered, or
 * undefined, said, when the line changed or reads as none.
 */
function readPromiseAt(document: vscode.TextDocument, line: number, text: string, now: number): PromiseLine | undefined {
  if (line >= document.lineCount || document.lineAt(line).text !== text) {
    void reportFailure({
      outcome: describeStale([noteName(document.uri)]),
      fix: 'Track the line again from its lens or the lightbulb.',
      severity: 'warning',
    });
    return undefined;
  }
  const promise = readPromiseLine(text, line, readPromiseSettings(document.uri, now));
  if (!promise) {
    void vscode.window.showInformationMessage('This line names no one person and day to come, so nothing was written.');
  }
  return promise;
}

/** Not a promise: remembers a line of a note, by its words, so it is not offered again. */
export async function notAPromiseCommand(marks: PromiseMarks, documentUri: string, text: string): Promise<void> {
  await marks.add(documentUri, promiseLineKey(text));
}
