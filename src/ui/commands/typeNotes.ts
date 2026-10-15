import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import {
  describeFieldGuess,
  describeRowSource,
  guessNotesFolder,
  guessTypeFields,
  listRowSources,
  type FieldGuess,
  type RowSource,
} from '../../domain/types/createType';
import { slugTitle } from '../../domain/types/rowNotes';
import type { DraftType } from '../../domain/types/typedNoteDraft';
import type { TypeRegistry } from '../../domain/types/typeRegistry';
import { typeNotePath, writeTypeNote, type TypeNoteDraft } from '../../domain/types/typeNoteWriter';
import type { ParsedFile } from '../../domain/model';
import { fileExists } from './fs';
import { openNoteAction, reportFailure, reportNeedsFolder } from './notify';
import type { WorkspaceWriteHistory, WriteHandle } from './workspaceWrites';

/**
 * Writing typed notes (docs/implementation/30-databases.md § Writes): a
 * new type note, and Create Type from Tags, which offers the rows a type
 * could be made of and guesses its fields, and what the form a new row's
 * note is made in writes through (typeNoteForm.ts). Each new note is one
 * write, applied directly, that Undo Last Change takes back.
 */

/** What the type commands read and write through. */
export interface TypeWrites {
  indexer: Pick<
    IndexReader<vscode.Uri>,
    'ready' | 'getSnapshot' | 'getTypeIndex' | 'getUri' | 'getNotesFolderUri' | 'getTemplatesFolderUri' | 'getTypesFolderUri'
  >;
  history: WorkspaceWriteHistory;
}

/** The command Create person "Omar H"… runs: a document URI, a type's key, and the row's title. */
export const CREATE_TYPE_ROW_COMMAND = 'deckard.createTypeRow';
/** The command Create a <Type> type runs: a document URI and `{ key, name, rows }`. */
export const CREATE_TYPE_COMMAND = 'deckard.createType';
/** The command a typed row's hover copies a value with, such as its email. */
export const COPY_FIELD_VALUE_COMMAND = 'deckard.copyFieldValue';

const CREATE_TYPE_TITLE = 'Deckard: Create Type from Tags';

/**
 * Writes a new note as one write Undo Last Change takes back: the file is
 * made empty, its text put in through the write history, and an Undo
 * empties it and then deletes it, unless it has been written in since.
 * The write's handle, for an Undo offered with it; undefined, with nothing
 * left behind, when VS Code refuses the write.
 */
export async function writeNewNote(
  history: WorkspaceWriteHistory,
  uri: vscode.Uri,
  content: string,
  label: string,
): Promise<WriteHandle | undefined> {
  const fs = vscode.workspace.fs;
  await fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await fs.writeFile(uri, new Uint8Array());
  const deleteIfEmpty = async (): Promise<void> => {
    try {
      if ((await fs.readFile(uri)).length === 0) {
        await fs.delete(uri, { useTrash: false });
      }
    } catch {
      // Already gone.
    }
  };
  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(0, 0), content);
  // One note the reader asked for, so nothing to preview.
  const write = await history.write(edit, { label, preview: 'never', restore: deleteIfEmpty });
  if (!write.applied) {
    await deleteIfEmpty();
    return undefined;
  }
  return write.handle;
}

/** People, when no type has them: a quick fix can still create a person's hub note. */
const PEOPLE_FALLBACK: DraftType = { key: 'person', name: 'Person', rows: { kind: 'tags', prefix: '@', written: '@*' }, fields: [] };

/**
 * The type a new row is written from, by key: the registry's, or, for
 * `person` when no type has people, a person with no fields, so a quick
 * fix can still create a person's hub note.
 */
export function findRowNoteType(registry: Pick<TypeRegistry, 'get'>, typeKey: string): DraftType | undefined {
  return registry.get(typeKey) ?? (typeKey === PEOPLE_FALLBACK.key ? PEOPLE_FALLBACK : undefined);
}

/**
 * Writes a type note, `Types/<Display>.md`, and opens it beside the editor.
 * A type note already there is never overwritten: it is offered to open.
 */
export async function createTypeNote(
  writes: TypeWrites,
  draft: TypeNoteDraft,
  near?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const folder = findWorkspaceFolder(near);
  if (!folder) {
    void reportNeedsFolder();
    return undefined;
  }
  const path = typeNotePath(draft.name);
  if (!path) {
    void reportFailure({ outcome: `"${draft.name}" cannot name a note, so Deckard did not create the type.` });
    return undefined;
  }
  const uri = vscode.Uri.joinPath(writes.indexer.getTypesFolderUri(folder), path.split('/').pop() ?? path);
  if (await fileExists(uri)) {
    void reportFailure({
      outcome: `${path} already exists, so Deckard did not create the ${draft.name} type.`,
      action: openNoteAction(uri),
    });
    return undefined;
  }
  if (!(await writeNewNote(writes.history, uri, writeTypeNote(draft), `Create the ${draft.name} type`))) {
    void reportFailure({ outcome: `VS Code did not accept the new note, so Deckard did not create the ${draft.name} type.` });
    return undefined;
  }
  await openNewNote(uri, 'beside');
  return uri;
}

/** One row of Create Type's first list. */
interface SourceItem extends vscode.QuickPickItem {
  source?: RowSource;
  newType?: true;
}

/** One row of Create Type's second list. */
interface FieldItem extends vscode.QuickPickItem {
  guess: FieldGuess;
}

/**
 * Create Type from Tags…: choose what the rows are (a namespace, the
 * people, the notes with one `type:`, or a new note type), then which of
 * the fields their notes already write the type has, each with a guessed
 * kind; writes `Types/<Display>.md` and opens it beside. `namespace`, from
 * a tag's page, skips the first list.
 */
export async function createTypeFromTags(writes: TypeWrites, namespace?: string): Promise<vscode.Uri | undefined> {
  const { indexer } = writes;
  await indexer.ready;
  const index = indexer.getSnapshot();
  const registry = indexer.getTypeIndex().registry;
  const sources = listRowSources(index, registry);
  const chosen = namespace
    ? sources.find((source) => source.kind === 'namespace' && source.key === namespace.toLowerCase().replace(/^#/, '').replace(/\/$/, ''))
    : await pickRowSource(sources);
  if (chosen === undefined) {
    return undefined;
  }
  if (chosen === 'new') {
    return createNoteType(writes);
  }
  const files = chosen.filePaths.flatMap((path) => index.files.get(path) ?? []);
  const fields = await pickFields(chosen, files, registry);
  if (!fields) {
    return undefined;
  }
  return createTypeNote(writes, {
    key: chosen.key,
    name: chosen.name,
    rows: chosen.rows,
    ...(guessNotesFolder(chosen.filePaths) ? { notesFolder: guessNotesFolder(chosen.filePaths) } : {}),
    fields: fields.map((guess) => ({ name: guess.name, kind: guess.kind, ...(guess.reverse ? { reverse: guess.reverse } : {}) })),
  });
}

/**
 * The first list: namespaces with their tags and hub notes, the people,
 * then the `type:` values in use under a separator, and New note type….
 * Undefined when dismissed.
 */
async function pickRowSource(sources: readonly RowSource[]): Promise<RowSource | 'new' | undefined> {
  const tagged = sources.filter((source) => source.kind !== 'notes');
  const typed = sources.filter((source) => source.kind === 'notes');
  const toItem = (source: RowSource): SourceItem => ({ ...describeRowSource(source), source });
  const items: SourceItem[] = [
    ...tagged.map(toItem),
    { label: 'Notes with a type field', kind: vscode.QuickPickItemKind.Separator },
    ...typed.map(toItem),
    { label: '$(add) New note type…', description: 'Rows are notes whose type: names it', newType: true },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: CREATE_TYPE_TITLE,
    placeHolder: 'Choose what the rows are: the tags of a namespace, the people, or notes with a type: field',
    matchOnDescription: true,
  });
  if (!picked) {
    return undefined;
  }
  return picked.newType ? 'new' : picked.source;
}

/**
 * The second list: the fields the rows' notes write, each with its guessed
 * kind, how many write it, its reverse, and why it was renamed or what its
 * values hold besides; all chosen to start with. Undefined when dismissed;
 * empty when the notes write no field, so the type starts with none.
 */
async function pickFields(
  source: RowSource,
  files: readonly ParsedFile[],
  registry: ReturnType<TypeWrites['indexer']['getTypeIndex']>['registry'],
): Promise<FieldGuess[] | undefined> {
  const guesses = guessTypeFields(files, { typeKey: source.key, registry });
  if (guesses.length === 0) {
    return [];
  }
  const items: FieldItem[] = guesses.map((guess) => ({ label: guess.name, ...describeFieldGuess(guess), picked: true, guess }));
  const picked = await vscode.window.showQuickPick(items, {
    title: `${CREATE_TYPE_TITLE}: ${source.name}`,
    placeHolder: `Choose the fields a ${source.name} has; each is a key in its rows' front matter`,
    canPickMany: true,
    matchOnDescription: true,
  });
  return picked?.map((item) => item.guess);
}

/** New note type…: asks its name, and writes a type whose rows are notes, with an empty table. */
async function createNoteType(writes: TypeWrites): Promise<vscode.Uri | undefined> {
  const registry = writes.indexer.getTypeIndex().registry;
  const name = await vscode.window.showInputBox({
    title: CREATE_TYPE_TITLE,
    prompt: 'Name the type, such as Incident or Decision. Its rows are the notes whose front matter says type: and its key.',
    validateInput: (value) => {
      const key = slugTitle(value);
      if (!key || !typeNotePath(value)) {
        return 'Write a name a note can have.';
      }
      return registry.get(key) || registry.get(value) ? `There is a ${value.trim()} type already.` : undefined;
    },
  });
  if (!name?.trim()) {
    return undefined;
  }
  return createTypeNote(writes, { key: slugTitle(name), name: name.trim(), rows: 'notes', fields: [] });
}

/** Copies a field's value, such as an email, and says so in the status bar. */
export async function copyFieldValue(value: unknown): Promise<void> {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || !text) {
    return;
  }
  await vscode.env.clipboard.writeText(text);
  vscode.window.setStatusBarMessage(`Copied ${text}`, 3000);
}

/** The workspace folder a note is in, or the first. */
export function findWorkspaceFolder(near: vscode.Uri | undefined): vscode.WorkspaceFolder | undefined {
  return (near ? vscode.workspace.getWorkspaceFolder(near) : undefined) ?? vscode.workspace.workspaceFolders?.[0];
}

/** A type's template, `<templates folder>/<key>.md`, when the templates folder has one. */
export async function readTypeTemplate(
  indexer: TypeWrites['indexer'],
  folder: vscode.WorkspaceFolder,
  key: string,
): Promise<string | undefined> {
  const templates = indexer.getTemplatesFolderUri(folder);
  if (!templates) {
    return undefined;
  }
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(templates, `${key}.md`))).toString('utf8');
  } catch {
    return undefined;
  }
}

/** Opens a note Deckard just wrote, in front or beside, kept open. */
export async function openNewNote(uri: vscode.Uri, where: 'active' | 'beside' | 'none'): Promise<void> {
  if (where === 'none') {
    return;
  }
  await vscode.window.showTextDocument(uri, {
    preview: false,
    ...(where === 'beside' ? { viewColumn: vscode.ViewColumn.Beside } : {}),
  });
}
