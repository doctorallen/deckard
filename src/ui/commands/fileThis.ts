import * as vscode from 'vscode';

import type { PreferenceServices } from '../../core/storage/preferences';
import type { IndexReader } from '../../core/workspace/indexReader';
import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import { findFencedLines, readHeading } from '../../domain/markdown/lineShapes';
import { stripTags } from '../../domain/markdown/parser';
import { noteTitle } from '../../domain/index/backlinks';
import { setFrontmatterField, type FrontmatterFieldEdit } from '../../domain/types/frontmatterWriter';
import { planTypedNote, setDraftValues, startTypedNoteDraft, writeDraftValues } from '../../domain/types/typedNoteDraft';
import {
  describeReading,
  filedDate,
  filedWords,
  findFieldReadings,
  findLineMentions,
  formatFiledLine,
  linkToLine,
  listFilingTargets,
  placeUnderHeading,
  placeUnderNotes,
  planReadingWrite,
  possessive,
  readingValues,
  type FieldReading,
  type LineInsert,
} from '../state/fileThis';
import { findTypedHubStart } from '../state/typeNoteForm';
import { pickDestination } from './destinationPicker';
import { fileExists } from './fs';
import { readLinkStyle } from './linkMaintenancePorts';
import { readSectionTarget } from './moveTo';
import { openResultAt, resolveSourceUri } from './navigation';
import { describeRejectedEdit, describeStale, noteName, openNoteAction, reportFailure, reportNeedsFolder } from './notify';
import { readEntityNamespaceAliases } from './parseSettings';
import { askTemplateQuestions } from './templates';
import { findRowNoteType, findWorkspaceFolder, readTypeTemplate, writeNewNote } from './typeNotes';
import type { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';

/**
 * File this (docs/implementation/43-file-this.md): on the lightbulb of a
 * note's line, **Set …** for each field the line's words set on a row it
 * mentions, then **Add this line to FX’s notes** for each hub note it can
 * be filed in, and **File under…**, which files it under any heading.
 * Filing copies the line, with a link back, and leaves it where it is
 * (D23); setting a field writes the row's hub note's front matter, or a
 * new hub note for a row with none (D24). Each is one write, with Undo.
 */

/** Files a line in a hub note: the line's note, its zero-based line, and the hub's path. */
export const FILE_LINE_COMMAND = 'deckard.fileLine';
/** Files a line under a heading chosen in Move to…'s picker: the line's note and zero-based line. */
export const FILE_LINE_UNDER_COMMAND = 'deckard.fileLineUnder';
/** Sets a row's field from a line: the line's note, its zero-based line, the row, the field's key, and the value. */
export const SET_FIELD_FROM_LINE_COMMAND = 'deckard.setFieldFromLine';

/** The lightbulb's kinds: Set a field first, then File the line, which VS Code lists in the order given. */
const SET_FIELD_KIND = vscode.CodeActionKind.Refactor.append('deckard.setField');
const FILE_LINE_KIND = vscode.CodeActionKind.Refactor.append('deckard.fileLine');

/** What File this reads the index and writes notes through. */
export interface FileThisWrites {
  indexer: Pick<
    IndexReader<vscode.Uri>,
    | 'ready'
    | 'getSnapshot'
    | 'getTypeIndex'
    | 'getFilePath'
    | 'getUri'
    | 'isNotesFile'
    | 'parse'
    | 'getNotesFolderUri'
    | 'getTemplatesFolderUri'
    | 'getTypesFolderUri'
  >;
  history: WorkspaceWriteHistory;
  /** The recent headings File under… offers first, and records the one chosen in. */
  preferences: Pick<PreferenceServices, 'reader' | 'usage'>;
}

/** A line of a note File this is offered on: not blank, not a heading, outside front matter and code. */
function readOfferedLine(document: vscode.TextDocument, line: number): string | undefined {
  const text = document.lineAt(line).text;
  if (!text.trim() || readHeading(text)) {
    return undefined;
  }
  const lines = document.getText().split(/\r?\n/);
  return line <= (findFrontmatterEnd(lines) ?? -1) || findFencedLines(lines).has(line) ? undefined : text;
}

/** What a line says, as File this reads it: the fields it sets, and the hub notes it can be filed in. */
function readLine(writes: Pick<FileThisWrites, 'indexer'>, uri: vscode.Uri, text: string) {
  const { indexer } = writes;
  const index = indexer.getSnapshot();
  const types = indexer.getTypeIndex();
  const sourcePath = indexer.getFilePath(uri);
  const mentions = findLineMentions(index, types, text, { sourcePath, aliases: readEntityNamespaceAliases(uri) });
  // A line in a hub note is the hub's own: it is what filing writes to.
  const inHub = index.files.get(sourcePath)?.hub !== undefined;
  return {
    index,
    sourcePath,
    readings: findFieldReadings(types, text, mentions),
    targets: inHub ? [] : listFilingTargets(mentions, sourcePath),
  };
}

/** Offers File this's actions on the line under the cursor, in the notes. */
export class FileThisActions implements vscode.CodeActionProvider {
  /** The kinds it offers, for its registration. */
  public static readonly kinds = [SET_FIELD_KIND, FILE_LINE_KIND];

  /** Reads the index through `writes`; offers nothing outside the notes folder. */
  public constructor(private readonly writes: Pick<FileThisWrites, 'indexer'>) {}

  /**
   * Set … for each field the line sets, then Add this line to …’s notes
   * for each hub it can go in, and File under… after them; nothing on a
   * line that mentions no row.
   */
  public provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
    if (!this.writes.indexer.isNotesFile(document.uri)) {
      return [];
    }
    const line = range.start.line;
    const text = readOfferedLine(document, line);
    if (text === undefined) {
      return [];
    }
    const { readings, targets } = readLine(this.writes, document.uri, text);
    const uri = document.uri.toString();
    const actions = readings.map((reading) =>
      createAction(describeReading(reading), SET_FIELD_KIND, SET_FIELD_FROM_LINE_COMMAND, [uri, line, reading.rowId, reading.field.key, reading.value.text]),
    );
    if (targets.length) {
      actions.push(
        ...targets.map((target) => createAction(`Add this line to ${possessive(target.title)} notes`, FILE_LINE_KIND, FILE_LINE_COMMAND, [uri, line, target.hubPath])),
        createAction('File under…', FILE_LINE_KIND, FILE_LINE_UNDER_COMMAND, [uri, line]),
      );
    }
    return actions;
  }
}

/** One action of the lightbulb, which runs a command with its arguments. */
function createAction(title: string, kind: vscode.CodeActionKind, command: string, args: unknown[]): vscode.CodeAction {
  const action = new vscode.CodeAction(title, kind);
  action.command = { command, title, arguments: args };
  return action;
}

/**
 * The line a command was asked about, read again from its note as it is
 * now; undefined when it is gone, or is no longer a line File this is
 * offered on, as a line become blank or a heading.
 */
async function readAskedLine(documentUri: unknown, line: unknown): Promise<{ uri: vscode.Uri; document: vscode.TextDocument; line: number; text: string } | undefined> {
  if (typeof documentUri !== 'string' || typeof line !== 'number' || !Number.isInteger(line) || line < 0) {
    return undefined;
  }
  const uri = vscode.Uri.parse(documentUri);
  const document = await vscode.workspace.openTextDocument(uri);
  if (line >= document.lineCount) {
    return undefined;
  }
  const text = readOfferedLine(document, line);
  return text === undefined ? undefined : { uri, document, line, text };
}

/** Says the line no longer says what the action was offered for, so nothing was written. */
function reportChangedLine(): void {
  void vscode.window.showInformationMessage('The line changed since the lightbulb read it, so nothing was written.');
}

/**
 * Add this line to …’s notes: the line, dated, with a link back to it, as
 * the last list item under the hub's Notes heading, which is made when the
 * hub has none.
 */
export async function fileLine(writes: FileThisWrites, documentUri: unknown, line: unknown, hubPath: unknown): Promise<void> {
  await writes.indexer.ready;
  const asked = await readAskedLine(documentUri, line);
  const read = asked ? readLine(writes, asked.uri, asked.text) : undefined;
  const target = read?.targets.find((candidate) => candidate.hubPath === hubPath);
  if (!asked || !read || !target) {
    reportChangedLine();
    return;
  }
  const hubUri = writes.indexer.getUri(target.hubPath) ?? (await resolveSourceUri(target.hubPath));
  if (!hubUri) {
    void reportFailure({ outcome: `Deckard could not find ${target.hubPath}, so nothing was written.` });
    return;
  }
  const hub = await vscode.workspace.openTextDocument(hubUri);
  const entry = filedEntry(asked, read, target.hubPath);
  await writeInsert(writes, hub, placeUnderNotes(hub.getText(), entry), {
    label: `Add a line to "${target.title}"`,
    said: `Added the line to ${possessive(target.title)} notes.`,
    filePath: target.hubPath,
  });
}

/** The filed line: the line's words, its day, and the link back to it from the note it goes in. */
function filedEntry(asked: { document: vscode.TextDocument; line: number; text: string }, read: ReturnType<typeof readLine>, fromPath: string): string {
  const link = linkToLine(asked.document.getText().split(/\r?\n/), asked.line, { sourcePath: read.sourcePath, fromPath, style: readLinkStyle() });
  return formatFiledLine(filedWords(asked.text), filedDate(read.index.files.get(read.sourcePath), Date.now()), link);
}

/**
 * File under…: Move to…'s picker, its recent headings first, and the line
 * filed under the heading chosen as Add this line to … files it under
 * Notes: the last list item of the heading's own lines.
 */
export async function fileLineUnder(writes: FileThisWrites, documentUri: unknown, line: unknown): Promise<void> {
  await writes.indexer.ready;
  const asked = await readAskedLine(documentUri, line);
  if (!asked) {
    reportChangedLine();
    return;
  }
  const destination = await pickDestination(writes.indexer.getSnapshot(), writes.preferences.reader, {
    title: 'Deckard: File under…',
    placeholder: 'Choose the heading to add the line under',
  });
  if (destination?.kind !== 'heading') {
    return;
  }
  const uri = writes.indexer.getUri(destination.filePath) ?? (await resolveSourceUri(destination.filePath));
  const document = uri ? await vscode.workspace.openTextDocument(uri) : undefined;
  const found = uri && document
    ? readSectionTarget(writes.indexer.getSnapshot(), destination.filePath, destination.section, writes.indexer.parse(uri, document.getText()).sections)
    : undefined;
  const heading = stripTags(destination.section.heading).trim() || destination.section.heading;
  if (!document || !found) {
    void reportFailure({ outcome: `Deckard did not file it: the heading “${heading}” is no longer in ${noteTitle(destination.filePath)}.` });
    return;
  }
  const read = readLine(writes, asked.uri, asked.text);
  const entry = filedEntry(asked, read, destination.filePath);
  const lines = document.getText().split(/\r?\n/);
  const written = await writeInsert(writes, document, placeUnderHeading(lines, found.section.startLine - 1, entry), {
    label: `Add a line under "${heading}"`,
    said: `Added the line under ${noteTitle(destination.filePath)} › ${heading}.`,
    filePath: destination.filePath,
  });
  if (written) {
    await writes.preferences.usage.recordRecentHeading(found.recent);
  }
}

/** Puts lines into a note as one write, with Open and Undo; whether it was written. */
async function writeInsert(
  writes: Pick<FileThisWrites, 'history'>,
  document: vscode.TextDocument,
  insert: LineInsert,
  { label, said, filePath }: { label: string; said: string; filePath: string },
): Promise<boolean> {
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const edit = new vscode.WorkspaceEdit();
  if (insert.at >= document.lineCount) {
    edit.insert(document.uri, document.lineAt(document.lineCount - 1).range.end, `${eol}${insert.lines.join(eol)}`);
  } else {
    edit.insert(document.uri, new vscode.Position(insert.at, 0), insert.lines.map((text) => `${text}${eol}`).join(''));
  }
  // One note the reader chose, so nothing to preview.
  const result = await writes.history.write(edit, { label, preview: 'never' });
  if (!result.applied) {
    void reportFailure(describeRejectedEdit(noteName(document.uri)));
    return false;
  }
  const at = insert.at + insert.lines.length;
  result.handle.offerUndo(said, { guard: 'latest', done: 'Took the line back out.' }, {
    label: 'Open',
    run: async () => {
      await openResultAt(filePath, at, { pin: true });
    },
  });
  return true;
}

/**
 * Set …: the field the line's words set, read again from the line as it is
 * now, written in the row's hub note's front matter, or in a new hub note
 * for a row with none, as one write with Undo.
 */
export async function setFieldFromLine(writes: FileThisWrites, ...args: unknown[]): Promise<void> {
  await writes.indexer.ready;
  const [documentUri, line, rowId, fieldKey, value] = args;
  const asked = await readAskedLine(documentUri, line);
  const reading = asked
    ? readLine(writes, asked.uri, asked.text).readings.find(
        (candidate) => candidate.rowId === rowId && candidate.field.key === fieldKey && candidate.value.text === value,
      )
    : undefined;
  if (!asked || !reading) {
    reportChangedLine();
    return;
  }
  const handle = reading.filePath ? await writeField(writes, reading, reading.filePath) : await writeNewHub(writes, reading, asked.uri);
  if (!handle) {
    return;
  }
  const field = reading.field.name;
  handle.offerUndo(
    `${reading.field.kind.many ? `Added ${reading.value.title} to` : 'Set'} ${possessive(reading.rowTitle)} ${field}${reading.field.kind.many ? '' : ` to ${reading.value.title}`}.`,
    { guard: 'latest', done: `Put ${possessive(reading.rowTitle)} ${field} back.` },
  );
}

/** Writes a reading's field in the row's note's front matter, only that key changing; the write's handle. */
async function writeField(writes: Pick<FileThisWrites, 'indexer' | 'history'>, reading: FieldReading, filePath: string): Promise<WriteHandle | undefined> {
  const uri = writes.indexer.getUri(filePath) ?? (await resolveSourceUri(filePath));
  if (!uri) {
    void reportFailure({ outcome: `Deckard could not find ${filePath}, so nothing was set.` });
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  // The note as it is now, which may hold more than the index read, as in
  // an edit not saved yet: a field that holds several keeps all of them.
  const values = planReadingWrite(reading, readWrittenValues(writes, uri, document.getText(), reading.field.key));
  if (values === 'stale') {
    void reportFailure({
      outcome: describeStale([noteName(uri)]),
      fix: 'Use the lightbulb on the line again.',
      severity: 'warning',
      action: { title: 'Open Note', run: () => openResultAt(filePath, 0, { pin: true }) },
    });
    return undefined;
  }
  const planned = values === 'held'
    ? ({ kind: 'unchanged' } as const)
    : setFrontmatterField(document.getText(), reading.field.key, writeDraftValues(reading.field.kind, values.map((text) => ({ text }))));
  if (planned.kind === 'unchanged') {
    void vscode.window.showInformationMessage(`${possessive(reading.rowTitle)} ${reading.field.name} already says that.`);
    return undefined;
  }
  if (planned.kind === 'refused') {
    void reportFailure({
      outcome: `${reading.field.name} is written in a way Deckard cannot rewrite, so nothing was set.`,
      action: { title: 'Open Note', run: () => openResultAt(filePath, planned.line, { pin: true }) },
    });
    return undefined;
  }
  const result = await writes.history.write(frontmatterEdit(document, planned), { label: `Set ${reading.field.name} in "${reading.rowTitle}"`, preview: 'never' });
  if (!result.applied) {
    void reportFailure(describeRejectedEdit(noteName(uri)));
    return undefined;
  }
  return result.handle;
}

/** The values a note's text writes for a front-matter key, as the parser reads them; the last of a key written twice, as the writer rewrites it. */
function readWrittenValues(writes: Pick<FileThisWrites, 'indexer'>, uri: vscode.Uri, text: string, key: string): string[] {
  const properties = writes.indexer.parse(uri, text).properties ?? [];
  const property = [...properties].reverse().find((candidate) => candidate.name.toLowerCase() === key.toLowerCase());
  return property?.values.map((value) => value.text) ?? [];
}

/** A front-matter key's new lines as an edit of the document, replacing the lines they replace. */
function frontmatterEdit(document: vscode.TextDocument, planned: Extract<FrontmatterFieldEdit, { kind: 'edit' }>): vscode.WorkspaceEdit {
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const end = planned.start + planned.deleted;
  const atEnd = end >= document.lineCount;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(new vscode.Position(planned.start, 0), atEnd ? document.lineAt(document.lineCount - 1).range.end : new vscode.Position(end, 0)),
    atEnd ? planned.lines.join(eol) : planned.lines.map((text) => `${text}${eol}`).join(''),
  );
  return edit;
}

/**
 * A row with no hub note gets one, as Create Hub Note writes it for a typed
 * row: in its type's folder, titled and tagged as the row, from the type's
 * template when it has one, with the field set. The write's handle.
 */
async function writeNewHub(writes: FileThisWrites, reading: FieldReading, near: vscode.Uri): Promise<WriteHandle | undefined> {
  const { indexer } = writes;
  const start = findTypedHubStart(indexer.getSnapshot(), indexer.getTypeIndex(), reading.rowId);
  const type = start ? findRowNoteType(indexer.getTypeIndex().registry, start.typeKey) : undefined;
  const folder = findWorkspaceFolder(near);
  if (!start || !type) {
    reportChangedLine();
    return undefined;
  }
  if (!folder) {
    void reportNeedsFolder();
    return undefined;
  }
  const template = await readTypeTemplate(indexer, folder, type.key);
  const answers = template === undefined ? undefined : await askTemplateQuestions(template, `${start.title}’s hub note`);
  if (template !== undefined && !answers) {
    return undefined;
  }
  const draft = setDraftValues(startTypedNoteDraft(type, { title: start.title, tag: start.tag }), reading.field.key, readingValues(reading).map((text) => ({ text })));
  const plan = planTypedNote(type, draft, { template, now: new Date(), answers });
  if (!plan) {
    void reportFailure({ outcome: `"${start.title}" cannot name a note, so nothing was set.` });
    return undefined;
  }
  const uri = vscode.Uri.joinPath(indexer.getNotesFolderUri(folder), ...plan.folder.split('/').filter(Boolean), plan.fileName);
  if (await fileExists(uri)) {
    void reportFailure({ outcome: `${plan.path} already exists, so nothing was set.`, action: openNoteAction(uri) });
    return undefined;
  }
  const handle = await writeNewNote(writes.history, uri, plan.content, `Create ${type.name} "${start.title}"`);
  if (!handle) {
    void reportFailure({ outcome: `VS Code did not accept the new note, so ${reading.field.name} was not set.` });
  }
  return handle;
}
