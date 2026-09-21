import * as vscode from 'vscode';

import {
  extractTags,
  getEntityNamespaceAliases,
  getPersonMarker,
} from '../../core/markdown/parser';
import {
  createNextOccurrence,
  formatIsoDate,
  setTaskDate,
  setTaskLineCompletion,
} from '../../core/markdown/taskMetadata';
import { Section, Task } from '../../core/types';
import { resolveSourceUri } from './navigation';
import { readTaskMetadataFormat } from './taskActions';
import { applyWorkspaceWrite } from './workspaceWrites';

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
  | { kind: 'tag'; tag: string };

/** One result an edit can be made to. */
export type BulkEntry =
  | { kind: 'task'; task: Task }
  | { kind: 'section'; section: Section };

export interface BulkEditResult {
  /** Lines the edit changed. */
  changed: number;
  /** Results left alone: already as asked, or changed since indexing. */
  skipped: number;
  /** Notes the edit reached. */
  notes: number;
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
    default:
      return `adding ${edit.tag} to ${count}`;
  }
}

/**
 * Writes a tag at the end of a line, unless the line already carries it.
 *
 * The tag goes last, where a tag written by hand goes, and the sentence in
 * front of it is left exactly as it was.
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
  return `${line.replace(/[ \t]+$/, '')} ${written[0].label}`;
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
  let skipped = 0;

  const byPath = new Map<string, BulkEntry[]>();
  entries.forEach((entry) => {
    const filePath =
      entry.kind === 'task' ? entry.task.filePath : entry.section.filePath;
    byPath.set(filePath, [...(byPath.get(filePath) ?? []), entry]);
  });

  for (const [filePath, fileEntries] of byPath) {
    const uri = await resolveSourceUri(filePath);
    if (!uri) {
      skipped += fileEntries.length;
      continue;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      skipped += fileEntries.length;
      continue;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const configuration = vscode.workspace.getConfiguration('deckard', uri);

    fileEntries.forEach((entry) => {
      const line = entry.kind === 'task' ? entry.task.lineNumber : entry.section.startLine;
      if (line < 1 || line > document.lineCount) {
        skipped += 1;
        return;
      }
      const source = document.lineAt(line - 1);
      const expected =
        entry.kind === 'task'
          ? entry.task.sourceLineText
          : firstLine(entry.section.rawContent);
      if (source.text !== expected) {
        skipped += 1;
        return;
      }
      const replacement = rewrite(entry, edit, source.text, {
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
      if (replacement === undefined || replacement === source.text) {
        skipped += 1;
        return;
      }
      workspaceEdit.replace(uri, source.range, replacement);
      paths.add(filePath);
      changed += 1;
    });
  }

  if (changed === 0) {
    return { changed: 0, skipped, notes: 0 };
  }
  const written = await applyWorkspaceWrite(workspaceEdit, {
    label: describeBulkEdit(edit, changed),
    description: describeBulkEdit(edit, changed),
  });
  return written.applied
    ? { changed, skipped, notes: written.notes.length }
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
): string | undefined {
  if (edit.kind === 'tag') {
    return appendTagToLine(line, edit.tag, options);
  }
  // Only a task has a checkbox or a due date; a note section keeps its own.
  if (entry.kind !== 'task') {
    return undefined;
  }
  const task = entry.task;
  if (edit.kind === 'due') {
    return setTaskDate(
      line,
      task.checkboxColumn,
      'due',
      edit.date,
      options.format,
    );
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
    return completed;
  }
  // A repeating task is replaced by its next occurrence here too, so a bulk
  // completion leaves the same notes behind as one checkbox would.
  const next = createNextOccurrence(line, task.checkboxColumn, now);
  return next === undefined ? completed : `${next}${options.eol}${completed}`;
}

function firstLine(content: string): string {
  return content.split(/\r?\n/)[0] ?? '';
}

/** One sentence for what a bulk edit did. */
export function describeBulkEditResult(
  edit: BulkEdit,
  result: BulkEditResult,
): string {
  if (result.changed === 0) {
    return `Nothing to change: every result is already as you asked, or has changed since it was indexed.`;
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
        : `Added ${edit.tag} to`;
  const left =
    result.skipped === 0
      ? ''
      : ` ${result.skipped} ${result.skipped === 1 ? 'was' : 'were'} left as they are.`;
  return `${verb} ${result.changed} ${
    result.changed === 1 ? 'result' : 'results'
  } in ${result.notes} ${result.notes === 1 ? 'note' : 'notes'}.${left}`;
}
