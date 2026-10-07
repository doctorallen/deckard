import * as vscode from 'vscode';

import { readStatusWriteMode, setTaskStatus, type StatusWriteMode } from '../../domain/tasks/statusWrites';
import type { TaskStatusDefinition } from '../../domain/tasks/taskStatuses';
import { readStatusNamespace } from '../../domain/tasks/taskPolicy';
import {
  extractTags,
  getEntityNamespaceAliases,
  getPersonMarker,
  hasAtxHeadingClosingHashes,
} from '../../domain/markdown/parser';
import { pluralize } from '../../shared/text';
import { resolveSourceUri } from './navigation';
import { readTaskMetadataFormat } from './taskActions';
import { WorkspaceWriteHistory } from './workspaceWrites';
import { describeStale, noteName, openNoteAction, reportFailure } from './notify';
import { Section, Task } from '../../domain/model';
import { formatIsoDate } from '../../domain/markdown/calendar';
import { CompletionWrite, setTaskDate, setTaskLineCompletion, writeCompletion } from '../../domain/markdown/taskLineEdits';
import { type DateFormats, DEFAULT_DATE_FORMATS, formatDisplayDay } from '../../domain/markdown/dateFormat';
import { readDateFormats } from './datePrompt';

/**
 * One edit made to many results at once.
 *
 * A search page is where a set of notes and tasks is already gathered, so it
 * is where an edit to all of them belongs. Every line is compared with the
 * line the index recorded before it is touched — the same check a single
 * checkbox makes — and the whole edit is one write, shown before it lands and
 * taken back by `Deckard: Undo Last Change`.
 */

/** What to do to every chosen result. */
export type BulkEdit =
  | { kind: 'complete'; completed: boolean }
  /** A status of any type, as the task editor sets one. */
  | { kind: 'status'; status: TaskStatusDefinition }
  | { kind: 'due'; date: string | undefined }
  /** A due date of its own for each task, by task id, as a spread writes. */
  | { kind: 'dueEach'; dates: ReadonlyMap<string, string> }
  | { kind: 'tag'; tag: string };

/** One result an edit can be made to. */
export type BulkEntry =
  | { kind: 'task'; task: Task }
  | { kind: 'section'; section: Section };

/**
 * What a bulk edit did: what it changed, what it left and why, and in how
 * many notes, which is what its message is worded from.
 */
export interface BulkEditResult {
  /** Lines the edit changed. */
  changed: number;
  /** Results left alone: `unchanged` and `stale` together. */
  skipped: number;
  /** Results already as asked. */
  unchanged?: number;
  /** Results whose line changed since indexing, or whose note is unreadable. */
  stale?: number;
  /** The notes those stale results are in, so a message can name them. */
  staleUris?: vscode.Uri[];
  /** Notes the edit reached. */
  notes: number;
  /** Repeating tasks completed whose 🔁 rule Deckard could not read. */
  unreadRules?: number;
}

/** What a bulk edit is called, in the preview and in the Undo prompt, its date in the reader's format. */
export function describeBulkEdit(edit: BulkEdit, entries: number, formats: DateFormats = DEFAULT_DATE_FORMATS): string {
  const count = `${entries} ${entries === 1 ? 'result' : 'results'}`;
  switch (edit.kind) {
    case 'complete':
      return `${edit.completed ? 'completing' : 'reopening'} ${count}`;
    case 'status':
      return `setting the status of ${count} to ${edit.status.name}`;
    case 'due':
      return edit.date
        ? `setting the due date of ${count} to ${formatDisplayDay(edit.date, formats)}`
        : `clearing the due date of ${count}`;
    case 'dueEach':
      return `spreading the due dates of ${count}`;
    case 'tag':
      return `adding ${edit.tag} to ${count}`;
  }
}

/** The verb a bulk edit's result sentence opens with, with its preposition, its date in the reader's format. */
function verbFor(edit: BulkEdit, formats: DateFormats): string {
  switch (edit.kind) {
    case 'complete':
      return edit.completed ? 'Completed' : 'Reopened';
    case 'status':
      return `Set the status to ${edit.status.name} on`;
    case 'due':
      return edit.date ? `Set the due date to ${formatDisplayDay(edit.date, formats)} on` : 'Cleared the due date on';
    case 'dueEach':
      return 'Set a due date on';
    case 'tag':
      return `Added ${edit.tag} to`;
  }
}

/**
 * Writes a tag at the end of a line, unless the line already carries it.
 *
 * The tag goes last, where a tag written by hand goes, ahead only of a
 * block id or a heading's closing hashes, and the sentence in front of it is
 * left exactly as it was.
 */
export function appendTagToLine(
  line: string,
  tag: string,
  options: { entityNamespaceAliases?: Record<string, string>; personMarker?: string } = {},
): string {
  const written = extractTags(
    tag,
    options.entityNamespaceAliases,
    options.personMarker,
  );
  if (written.length !== 1 || written[0].label !== tag.trim()) {
    return line;
  }
  const carried = extractTags(
    line,
    options.entityNamespaceAliases,
    options.personMarker,
  );
  if (carried.some((candidate) => candidate.key === written[0].key)) {
    return line;
  }
  // The tag goes before what must stay last: a trailing `^block-id`, which
  // is read as one only at the end of a line, and a heading's closing `#`s,
  // which would otherwise stop closing it.
  let head = line.replace(/[ \t]+$/, '');
  let tail = '';
  const blockId = /[ \t]+\^[\w-]+$/.exec(head);
  if (blockId) {
    tail = blockId[0] + tail;
    head = head.slice(0, blockId.index);
  }
  if (hasAtxHeadingClosingHashes(head)) {
    const closing = /[ \t]+#+$/.exec(head);
    if (closing) {
      tail = closing[0] + tail;
      head = head.slice(0, closing.index);
    }
  }
  return `${head} ${written[0].label}${tail}`;
}

/**
 * Applies one edit to every entry, as one write over the notes they are in.
 *
 * Entries whose line has changed since indexing are left alone and counted,
 * so an edit made while the page was open is never overwritten.
 */
export async function applyBulkEdit(
  history: WorkspaceWriteHistory,
  entries: readonly BulkEntry[],
  edit: BulkEdit,
): Promise<BulkEditResult | undefined> {
  const tally = new BulkTally();
  for (const [filePath, fileEntries] of groupByPath(entries)) {
    await tally.addNote(filePath, fileEntries, edit);
  }

  const { changed, unchanged, stale, unreadRules } = tally;
  const left = {
    skipped: unchanged + stale,
    unchanged,
    stale,
    staleUris: [...tally.staleNotes.values()],
  };
  if (changed === 0) {
    return { changed: 0, ...left, notes: 0, unreadRules: 0 };
  }
  const formats = readDateFormats();
  const written = await history.write(tally.workspaceEdit, {
    label: describeBulkEdit(edit, changed, formats),
    description: describeBulkEdit(edit, changed, formats),
  });
  return written.applied
    ? { changed, ...left, notes: written.notes.length, unreadRules }
    : undefined;
}

/** The entries by the note they are in, each note in the order its first entry came. */
function groupByPath(entries: readonly BulkEntry[]): Map<string, BulkEntry[]> {
  const byPath = new Map<string, BulkEntry[]>();
  entries.forEach((entry) => {
    const filePath =
      entry.kind === 'task' ? entry.task.filePath : entry.section.filePath;
    byPath.set(filePath, [...(byPath.get(filePath) ?? []), entry]);
  });
  return byPath;
}

/** The one write a bulk edit builds, and the count of what it changed and left. */
class BulkTally {
  public readonly workspaceEdit = new vscode.WorkspaceEdit();
  public changed = 0;
  public unchanged = 0;
  public stale = 0;
  public readonly staleNotes = new Map<string, vscode.Uri>();
  public unreadRules = 0;

  /**
   * Adds one note's entries to the write. A note that cannot be found or
   * opened leaves all its entries stale.
   */
  public async addNote(
    filePath: string,
    fileEntries: readonly BulkEntry[],
    edit: BulkEdit,
  ): Promise<void> {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      this.markStale(fileEntries.length);
      return;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      this.markStale(fileEntries.length, uri);
      return;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const configuration = vscode.workspace.getConfiguration('deckard', uri);
    fileEntries.forEach((entry) =>
      this.addEntry({ document, uri, eol, configuration }, entry, edit),
    );
  }

  /**
   * Adds one entry's rewritten line to the write, unless its line is no
   * longer the one the index recorded (stale) or the edit leaves it as it is
   * (unchanged).
   */
  private addEntry(note: OpenNote, entry: BulkEntry, edit: BulkEdit): void {
    const { document, uri, eol, configuration } = note;
    const line = entry.kind === 'task' ? entry.task.lineNumber : entry.section.startLine;
    if (line < 1 || line > document.lineCount) {
      this.markStale(1, uri);
      return;
    }
    const source = document.lineAt(line - 1);
    const expected =
      entry.kind === 'task'
        ? entry.task.sourceLineText
        : firstLine(entry.section.rawContent);
    if (source.text !== expected) {
      this.markStale(1, uri);
      return;
    }
    const rewritten = rewrite(entry, edit, source.text, {
      eol,
      format: readTaskMetadataFormat(configuration),
      addDoneDate: configuration.get<boolean>('tasks.addDoneDate', true),
      addCancelledDate: configuration.get<boolean>('tasks.addCancelledDate', true),
      statusNamespace: readStatusNamespace(configuration),
      writeStatusAs: readStatusWriteMode(configuration.get<unknown>('tasks.writeStatusAs')),
      entityNamespaceAliases: getEntityNamespaceAliases(
        configuration.get<unknown>('entityNamespaceAliases', {}),
      ),
      personMarker: getPersonMarker(
        configuration.get<unknown>('personMarker', '@'),
      ),
    });
    const replacement = rewritten?.text;
    if (replacement === undefined || replacement === source.text) {
      this.unchanged += 1;
      return;
    }
    this.workspaceEdit.replace(uri, source.range, replacement);
    this.changed += 1;
    if (rewritten?.unreadRule !== undefined) {
      this.unreadRules += 1;
    }
  }

  /** Counts `count` results as stale, and remembers their note when it is known. */
  private markStale(count: number, uri?: vscode.Uri): void {
    this.stale += count;
    if (uri) {
      this.staleNotes.set(uri.toString(), uri);
    }
  }
}

/** A note opened for a bulk edit, with what its lines are written in. */
interface OpenNote {
  document: vscode.TextDocument;
  uri: vscode.Uri;
  eol: string;
  configuration: vscode.WorkspaceConfiguration;
}

interface RewriteOptions {
  eol: string;
  format: 'emoji' | 'dataview';
  addDoneDate: boolean;
  addCancelledDate: boolean;
  statusNamespace: string;
  writeStatusAs: StatusWriteMode;
  entityNamespaceAliases: Record<string, string>;
  personMarker: string;
}

/** What one entry's line becomes, or nothing when the edit does not fit it. */
function rewrite(
  entry: BulkEntry,
  edit: BulkEdit,
  line: string,
  options: RewriteOptions,
): CompletionWrite | undefined {
  if (edit.kind === 'tag') {
    return { text: appendTagToLine(line, edit.tag, options) };
  }
  // Only a task has a checkbox or a due date; a note section keeps its own.
  if (entry.kind !== 'task') {
    return undefined;
  }
  const task = entry.task;
  if (edit.kind === 'due') {
    return {
      text: setTaskDate(line, task.checkboxColumn, {
        field: 'due',
        date: edit.date,
        preferredFormat: options.format,
      }),
    };
  }
  if (edit.kind === 'dueEach') {
    const date = edit.dates.get(task.id);
    return date === undefined
      ? undefined
      : { text: setTaskDate(line, task.checkboxColumn, { field: 'due', date, preferredFormat: options.format }) };
  }
  if (edit.kind === 'status') {
    return writeStatus(task, edit.status, line, options);
  }
  if (task.completed === edit.completed) {
    return undefined;
  }
  const now = Date.now();
  const completed = setTaskLineCompletion(line, task.checkboxColumn, {
    completed: edit.completed,
    doneDate: options.addDoneDate ? formatIsoDate(now) : undefined,
    preferredFormat: options.format,
  });
  if (!edit.completed) {
    return { text: completed };
  }
  // A repeating task is replaced by its next occurrence here too, so a bulk
  // completion leaves the same notes behind as one checkbox would.
  return writeCompletion(completed, task.checkboxColumn, { now, eol: options.eol });
}

/**
 * A task line with a status written, as Set Task Status… writes it: a
 * change to done starts a repeating task's next occurrence.
 */
function writeStatus(task: Task, status: TaskStatusDefinition, line: string, options: RewriteOptions): CompletionWrite | undefined {
  const now = Date.now();
  const date = formatIsoDate(now);
  const text = setTaskStatus(line, task.checkboxColumn, {
    to: status,
    namespace: options.statusNamespace,
    writeAs: options.writeStatusAs,
    ...(options.addDoneDate ? { doneDate: date } : {}),
    ...(options.addCancelledDate ? { cancelledDate: date } : {}),
    preferredFormat: options.format,
  });
  if (text === line) {
    return undefined;
  }
  return status.type === 'done' && !task.completed ? writeCompletion(text, task.checkboxColumn, { now, eol: options.eol }) : { text };
}

/** A section's heading line, which is what the index recorded for it. */
function firstLine(content: string): string {
  return content.split(/\r?\n/)[0] ?? '';
}

/** One sentence for what a bulk edit did, its date in the reader's `formats`. */
export function describeBulkEditResult(
  edit: BulkEdit,
  result: BulkEditResult,
  formats: DateFormats = DEFAULT_DATE_FORMATS,
): string {
  const stale = result.stale ?? 0;
  const unchanged = result.unchanged ?? result.skipped - stale;
  if (result.changed === 0) {
    return stale === 0
      ? 'Nothing to change: every result is already as you asked.'
      : describeStale(
          result.staleUris?.length ? result.staleUris.map(noteName) : ['The note'],
        );
  }
  const verb = verbFor(edit, formats);
  const left = describeLeftAlone(unchanged, stale);
  const rules = describeUnreadRules(result.unreadRules ?? 0);
  return `${verb} ${pluralize(result.changed, 'result')} in ${pluralize(result.notes, 'note')}.${left}${rules}`;
}

/** The sentences on results left alone, as already asked or as stale; empty when none were. */
function describeLeftAlone(unchanged: number, stale: number): string {
  return (
    (unchanged === 0
      ? ''
      : ` ${unchanged} ${unchanged === 1 ? 'was' : 'were'} already as you asked.`) +
    (stale === 0
      ? ''
      : ` ${stale} ${stale === 1 ? 'result' : 'results'} changed after Deckard last read ${
          stale === 1 ? 'it and was left as it is' : 'them and were left as they are'
        }.`)
  );
}

/** The sentence on completed repeats whose rule could not be read; empty when there were none. */
function describeUnreadRules(unread: number): string {
  return unread === 0
    ? ''
    : ` Deckard could not read the repeat rule on ${
        unread === 1 ? 'one' : unread
      } of them, so no next one was added.`;
}

/**
 * How heavy a bulk edit's message is: nothing written because the notes
 * changed is an error; written, but with results left out, a warning.
 */
export function bulkEditSeverity(result: BulkEditResult): 'info' | 'warning' | 'error' {
  const stale = result.stale ?? 0;
  if (result.changed === 0) {
    return stale > 0 ? 'error' : 'info';
  }
  return stale > 0 || (result.unreadRules ?? 0) > 0 ? 'warning' : 'info';
}

/** The message a bulk edit that wrote is reported in, by its weight. */
const SHOW_AT_SEVERITY: Record<'warning' | 'info', (text: string) => void> = {
  warning: (text) => void vscode.window.showWarningMessage(text),
  info: (text) => void vscode.window.showInformationMessage(text),
};

/** Says what a bulk edit did, at the weight of what happened. */
export function reportBulkEditResult(
  edit: BulkEdit,
  result: BulkEditResult,
  more = '',
): void {
  const text = describeBulkEditResult(edit, result, readDateFormats()) + more;
  const severity = bulkEditSeverity(result);
  if (severity === 'error') {
    const uris = result.staleUris ?? [];
    void reportFailure({
      outcome: text,
      ...(uris.length === 1 ? { action: openNoteAction(uris[0]) } : {}),
    });
    return;
  }
  SHOW_AT_SEVERITY[severity](text);
}

