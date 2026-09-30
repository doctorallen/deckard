import * as vscode from 'vscode';

import {
  extractTags,
  getEntityNamespaceAliases,
  getPersonMarker,
  hasAtxHeadingClosingHashes,
} from '../../core/markdown/parser';
import {
  CompletionWrite,
  formatIsoDate,
  setTaskDate,
  setTaskLineCompletion,
  writeCompletion,
} from '../../core/markdown/taskMetadata';
import { pluralize } from '../../core/text';
import { Section, Task } from '../../core/types';
import { resolveSourceUri } from './navigation';
import { readTaskMetadataFormat } from './taskActions';
import { applyWorkspaceWrite } from './workspaceWrites';
import { describeStale, noteName, openNoteAction, reportFailure } from './notify';

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
  | { kind: 'due'; date: string | undefined }
  /** A due date of its own for each task, by task id, as a spread writes. */
  | { kind: 'dueEach'; dates: ReadonlyMap<string, string> }
  | { kind: 'tag'; tag: string };

/** One result an edit can be made to. */
export type BulkEntry =
  | { kind: 'task'; task: Task }
  | { kind: 'section'; section: Section };

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

/** What a bulk edit is called, in the preview and in the Undo prompt. */
export function describeBulkEdit(edit: BulkEdit, entries: number): string {
  const count = `${entries} ${entries === 1 ? 'result' : 'results'}`;
  switch (edit.kind) {
    case 'complete':
      return `${edit.completed ? 'completing' : 'reopening'} ${count}`;
    case 'due':
      return edit.date
        ? `setting the due date of ${count} to ${edit.date}`
        : `clearing the due date of ${count}`;
    case 'dueEach':
      return `spreading the due dates of ${count}`;
    default:
      return `adding ${edit.tag} to ${count}`;
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
  entries: readonly BulkEntry[],
  edit: BulkEdit,
): Promise<BulkEditResult | undefined> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  const paths = new Set<string>();
  let changed = 0;
  let unchanged = 0;
  let stale = 0;
  const staleNotes = new Map<string, vscode.Uri>();
  const markStale = (count: number, uri?: vscode.Uri) => {
    stale += count;
    if (uri) {
      staleNotes.set(uri.toString(), uri);
    }
  };
  let unreadRules = 0;

  const byPath = new Map<string, BulkEntry[]>();
  entries.forEach((entry) => {
    const filePath =
      entry.kind === 'task' ? entry.task.filePath : entry.section.filePath;
    byPath.set(filePath, [...(byPath.get(filePath) ?? []), entry]);
  });

  for (const [filePath, fileEntries] of byPath) {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      markStale(fileEntries.length);
      continue;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      markStale(fileEntries.length, uri);
      continue;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const configuration = vscode.workspace.getConfiguration('deckard', uri);

    fileEntries.forEach((entry) => {
      const line = entry.kind === 'task' ? entry.task.lineNumber : entry.section.startLine;
      if (line < 1 || line > document.lineCount) {
        markStale(1, uri);
        return;
      }
      const source = document.lineAt(line - 1);
      const expected =
        entry.kind === 'task'
          ? entry.task.sourceLineText
          : firstLine(entry.section.rawContent);
      if (source.text !== expected) {
        markStale(1, uri);
        return;
      }
      const rewritten = rewrite(entry, edit, source.text, {
        eol,
        format: readTaskMetadataFormat(configuration),
        addDoneDate: configuration.get<boolean>('tasks.addDoneDate', true),
        entityNamespaceAliases: getEntityNamespaceAliases(
          configuration.get<unknown>('entityNamespaceAliases', {}),
        ),
        personMarker: getPersonMarker(
          configuration.get<unknown>('personMarker', '@'),
        ),
      });
      const replacement = rewritten?.text;
      if (replacement === undefined || replacement === source.text) {
        unchanged += 1;
        return;
      }
      workspaceEdit.replace(uri, source.range, replacement);
      paths.add(filePath);
      changed += 1;
      if (rewritten?.unreadRule !== undefined) {
        unreadRules += 1;
      }
    });
  }

  const left = {
    skipped: unchanged + stale,
    unchanged,
    stale,
    staleUris: [...staleNotes.values()],
  };
  if (changed === 0) {
    return { changed: 0, ...left, notes: 0, unreadRules: 0 };
  }
  const written = await applyWorkspaceWrite(workspaceEdit, {
    label: describeBulkEdit(edit, changed),
    description: describeBulkEdit(edit, changed),
  });
  return written.applied
    ? { changed, ...left, notes: written.notes.length, unreadRules }
    : undefined;
}

interface RewriteOptions {
  eol: string;
  format: 'emoji' | 'dataview';
  addDoneDate: boolean;
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
      text: setTaskDate(line, task.checkboxColumn, 'due', edit.date, options.format),
    };
  }
  if (edit.kind === 'dueEach') {
    const date = edit.dates.get(task.id);
    return date === undefined
      ? undefined
      : { text: setTaskDate(line, task.checkboxColumn, 'due', date, options.format) };
  }
  if (task.completed === edit.completed) {
    return undefined;
  }
  const now = Date.now();
  const completed = setTaskLineCompletion(
    line,
    task.checkboxColumn,
    edit.completed,
    options.addDoneDate ? formatIsoDate(now) : undefined,
    options.format,
  );
  if (!edit.completed) {
    return { text: completed };
  }
  // A repeating task is replaced by its next occurrence here too, so a bulk
  // completion leaves the same notes behind as one checkbox would.
  return writeCompletion(completed, task.checkboxColumn, now, options.eol);
}

function firstLine(content: string): string {
  return content.split(/\r?\n/)[0] ?? '';
}

/** One sentence for what a bulk edit did. */
export function describeBulkEditResult(
  edit: BulkEdit,
  result: BulkEditResult,
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
  const verb =
    edit.kind === 'complete'
      ? edit.completed
        ? 'Completed'
        : 'Reopened'
      : edit.kind === 'due'
        ? edit.date
          ? `Set the due date to ${edit.date} on`
          : 'Cleared the due date on'
        : edit.kind === 'dueEach'
          ? 'Set a due date on'
          : `Added ${edit.tag} to`;
  const left =
    (unchanged === 0
      ? ''
      : ` ${unchanged} ${unchanged === 1 ? 'was' : 'were'} already as you asked.`) +
    (stale === 0
      ? ''
      : ` ${stale} ${stale === 1 ? 'result' : 'results'} changed after Deckard last read ${
          stale === 1 ? 'it and was left as it is' : 'them and were left as they are'
        }.`);
  const unread = result.unreadRules ?? 0;
  const rules =
    unread === 0
      ? ''
      : ` Deckard could not read the repeat rule on ${
          unread === 1 ? 'one' : unread
        } of them, so no next one was added.`;
  return `${verb} ${pluralize(result.changed, 'result')} in ${pluralize(result.notes, 'note')}.${left}${rules}`;
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

/** Says what a bulk edit did, at the weight of what happened. */
export function reportBulkEditResult(
  edit: BulkEdit,
  result: BulkEditResult,
  more = '',
): void {
  const text = describeBulkEditResult(edit, result) + more;
  const severity = bulkEditSeverity(result);
  if (severity === 'error') {
    const uris = result.staleUris ?? [];
    void reportFailure({
      outcome: text,
      ...(uris.length === 1 ? { action: openNoteAction(uris[0]) } : {}),
    });
  } else if (severity === 'warning') {
    void vscode.window.showWarningMessage(text);
  } else {
    void vscode.window.showInformationMessage(text);
  }
}
