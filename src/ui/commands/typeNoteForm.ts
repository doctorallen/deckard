import * as vscode from 'vscode';

import type { IndexReader } from '../../core/workspace/indexReader';
import { noteTitle } from '../../domain/index/backlinks';
import type { FieldKind } from '../../domain/model';
import {
  checkFieldText,
  checkTypedNoteDraft,
  draftNotePath,
  draftTagOf,
  listDraftFields,
  planTypedNote,
  readDraftFolder,
  readDraftTag,
  readFieldText,
  setDraftValues,
  startTypedNoteDraft,
  type DraftProblem,
  type DraftStart,
  type DraftType,
  type DraftValue,
  type TypedNoteDraft,
} from '../../domain/types/typedNoteDraft';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';
import { pluralTypeName } from '../../domain/types/rowNotes';
import { listNoteChoices } from '../state/addTaskTarget';
import {
  createTypeNoteFormRows,
  findTypedHubStart,
  describeDraftValues,
  listFolderChoices,
  listTypeChoices,
  previewTypeNoteForm,
  titleTypeNoteForm,
  type FolderChoice,
  type FormRowKind,
  type TypeNoteFormRow,
} from '../state/typeNoteForm';
import { listKindRows } from '../state/typeRows';
import { askForDate, readDateFormats } from './datePrompt';
import { fileExists } from './fs';
import { createHubNote } from './hubNote';
import { openNoteAction, reportFailure, reportNeedsFolder } from './notify';
import { showQuickPickUntilHidden } from './prompts';
import { askTemplateQuestions } from './templates';
import { findRowNoteType, findWorkspaceFolder, openNewNote, readTypeTemplate, writeNewNote, type TypeWrites } from './typeNotes';

/**
 * The form a new note of a type is made in
 * (docs/implementation/31-type-note-form.md): one quick pick that stays
 * open, as Add Task's editor is, listing where the note goes, its title,
 * its tag for a namespace type, and every field of the type with its
 * value. Choosing a row opens that row's own input and comes back; nothing
 * is written until Create the note, and then as one write Undo Last
 * Change takes back.
 *
 * New Note from Type…, a type's Add <type>…, the quick fix Create person
 * "Omar H"…, and Create hub note on a tag a type has rows of all open it.
 */

/** What the form is opened on: a type, what it starts with, and where the note is opened once written. */
export interface TypeNoteFormRequest {
  typeKey: string;
  /** A title, tag, or folder already chosen: the quick fix's title, a tag's hub note. */
  start?: DraftStart;
  /** A note in the workspace folder the new note belongs in; the first folder when absent. */
  near?: vscode.Uri;
  /** Where the note opens once written: in the editor in front (the default), or beside it. */
  open?: 'active' | 'beside';
}

/** A row of the form's pick. */
type FormItem = vscode.QuickPickItem & Pick<TypeNoteFormRow, 'row' | 'fieldKey' | 'done'>;

/**
 * Opens the form on a new note of a type and writes the note when Create
 * the note is chosen and nothing is wrong with it. The note's URI, or
 * undefined when the reader left or nothing was written.
 */
export async function openTypeNoteForm(writes: TypeWrites, request: TypeNoteFormRequest): Promise<vscode.Uri | undefined> {
  const { indexer } = writes;
  await indexer.ready;
  const type = findRowNoteType(indexer.getTypeIndex().registry, request.typeKey);
  if (!type) {
    void reportFailure({ outcome: `No type is named ${request.typeKey}, so Deckard did not open its form.` });
    return undefined;
  }
  const folder = findWorkspaceFolder(request.near);
  if (!folder) {
    void reportNeedsFolder();
    return undefined;
  }
  const notesFolder = indexer.getNotesFolderUri(folder);
  const template = await readTypeTemplate(indexer, folder, type.key);
  const form: FormContext = { writes, type, notesFolder };
  let draft = startTypedNoteDraft(type, request.start);
  let problem: DraftProblem | undefined;
  let focus: FocusRow = { row: 'title' };
  for (;;) {
    const chosen = await pickRow(form, draft, problem, focus);
    if (!chosen) {
      return undefined;
    }
    if (chosen.done) {
      problem = await checkDraft(form, draft);
      if (problem) {
        focus = { row: problem.row };
        continue;
      }
      const written = await writeDraft(form, draft, { template, open: request.open ?? 'active' });
      if (written !== 'back') {
        return written;
      }
      continue;
    }
    problem = undefined;
    if (chosen.row) {
      draft = (await readRow(form, draft, chosen)) ?? draft;
      focus = { row: chosen.row, ...(chosen.fieldKey ? { fieldKey: chosen.fieldKey } : {}) };
    }
  }
}

/** What the form's inputs read: the writes, the type, and the notes folder the note goes under. */
interface FormContext {
  writes: TypeWrites;
  type: DraftType;
  notesFolder: vscode.Uri;
}

/** The row the form's pick opens on. */
interface FocusRow {
  row: FormRowKind;
  fieldKey?: string;
}

/**
 * One turn of the form: its rows, headed by where the note goes and what
 * will be written. It opens on Title while there is none, as Add Task's
 * opens on Description, then on the row last chosen, or the row a problem
 * is on.
 */
function pickRow(form: FormContext, draft: TypedNoteDraft, problem: DraftProblem | undefined, focus: FocusRow): Promise<FormItem | undefined> {
  return showQuickPickUntilHidden<FormItem, FormItem>({
    configure: (pick) => {
      pick.title = titleTypeNoteForm(form.type, draft);
      pick.placeholder = previewTypeNoteForm(form.type, draft);
      pick.items = createTypeNoteFormRows(form.type, draft, { formats: readDateFormats(), ...(problem ? { problem } : {}) }).map(toItem);
      const target = draft.title.trim() !== '' || problem !== undefined ? focus : { row: 'title' as const };
      const active = pick.items.find((item) => item.row === target.row && item.fieldKey === target.fieldKey);
      if (active) {
        pick.activeItems = [active];
      }
      pick.ignoreFocusOut = true;
    },
    accept: (pick) => pick.selectedItems[0],
  });
}

/** A form row as a pick's item: a separator as VS Code draws one. */
function toItem(row: TypeNoteFormRow): FormItem {
  if (row.separator) {
    return { label: row.label, kind: vscode.QuickPickItemKind.Separator };
  }
  return {
    label: row.label,
    ...(row.description === undefined ? {} : { description: row.description }),
    ...(row.row ? { row: row.row } : {}),
    ...(row.fieldKey ? { fieldKey: row.fieldKey } : {}),
    ...(row.done ? { done: true } : {}),
  };
}

/** Asks for the chosen row's value and returns the draft it makes; undefined when the reader cancels. */
async function readRow(form: FormContext, draft: TypedNoteDraft, chosen: FormItem): Promise<TypedNoteDraft | undefined> {
  switch (chosen.row) {
    case 'title':
      return readTitle(form.type, draft);
    case 'tag':
      return readTag(form.type, draft);
    case 'folder':
      return readFolder(form, draft);
    case 'field': {
      const field = listDraftFields(form.type).find((each) => each.key === chosen.fieldKey);
      return field ? readField(form, draft, field) : undefined;
    }
    case undefined:
      return undefined;
  }
}

/** The note's title, which names its file and, until a tag is written, its tag. */
async function readTitle(type: DraftType, draft: TypedNoteDraft): Promise<TypedNoteDraft | undefined> {
  const tags = type.rows?.kind === 'tags' && !draft.tagFixed && draft.tag === undefined;
  const written = await vscode.window.showInputBox({
    title: 'Title',
    prompt: `The ${type.name.toLowerCase()}'s title, which names its note${tags ? ' and its tag' : ''}.`,
    value: draft.title,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim() && !getExtractedNoteFileName(value) ? 'A note cannot be named with / \\ : * ? " < > | or end in a dot or space.' : undefined,
  });
  return written === undefined ? undefined : { ...draft, title: written.trim() };
}

/** A namespace type's tag, under its namespace; empty follows the title again. A tag given to the form stays. */
async function readTag(type: DraftType, draft: TypedNoteDraft): Promise<TypedNoteDraft | undefined> {
  if (draft.tagFixed || type.rows?.kind !== 'tags') {
    vscode.window.setStatusBarMessage(`This note is the hub note of ${draftTagOf(type, draft) ?? 'its tag'}, so its tag stays.`, 5000);
    return undefined;
  }
  const namespace = type.rows.written;
  const written = await vscode.window.showInputBox({
    title: 'Tag',
    prompt: `The tag this note describes, under ${namespace}; nested tags are fine. Leave it empty to follow the title.`,
    value: draftTagOf(type, draft) ?? '',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() && !readDraftTag(type, value) ? `Write a tag such as ${draftTagOf(type, { title: 'Risk Tech' }) ?? namespace}.` : undefined),
  });
  if (written === undefined) {
    return undefined;
  }
  if (!written.trim()) {
    return { ...draft, tag: undefined };
  }
  const tag = readDraftTag(type, written);
  return tag ? { ...draft, tag } : undefined;
}

/**
 * Where the note goes: the folders under the notes folder that hold notes,
 * the type's own first; a folder typed that is not listed is made when the
 * note is written.
 */
async function readFolder(form: FormContext, draft: TypedNoteDraft): Promise<TypedNoteDraft | undefined> {
  const { indexer } = form.writes;
  const prefix = `${form.notesFolder.path.replace(/\/+$/, '')}/`;
  const underNotes = [...indexer.getSnapshot().files.keys()].flatMap((filePath) => {
    const uri = indexer.getUri(filePath);
    return uri?.scheme === form.notesFolder.scheme && uri.path.startsWith(prefix) ? [uri.path.slice(prefix.length)] : [];
  });
  const choices = listFolderChoices(underNotes, { notesFolder: '', typeFolder: startTypedNoteDraft(form.type).folder });
  const chosen = await showQuickPickUntilHidden<FolderChoice & vscode.QuickPickItem, string>({
    configure: (pick) => {
      pick.title = `Where should the ${form.type.name.toLowerCase()} go?`;
      pick.placeholder = 'Choose a folder, or write a new one such as Teams/EMEA';
      pick.items = choices;
      pick.activeItems = choices.filter((choice) => choice.folder === draft.folder);
      pick.ignoreFocusOut = true;
    },
    accept: (pick) => pick.selectedItems[0]?.folder ?? (pick.value.trim() || undefined),
  });
  if (chosen === undefined) {
    return undefined;
  }
  const folder = readDraftFolder(chosen);
  if (folder === undefined) {
    void vscode.window.showWarningMessage(`"${chosen}" cannot name a folder, so the ${form.type.name.toLowerCase()} stays in ${draft.folder || 'the notes folder'}.`);
    return undefined;
  }
  return { ...draft, folder };
}

/** A field of the type as the form reads it. */
type DraftField = DraftType['fields'][number];

/**
 * A field's value, asked for by its kind: rows of the related type, a
 * note, a select's options, a date, a checkbox toggled in place, or typed
 * text, checked as it is typed.
 */
async function readField(form: FormContext, draft: TypedNoteDraft, field: DraftField): Promise<TypedNoteDraft | undefined> {
  const current = draft.values[field.key] ?? [];
  const set = (values: readonly DraftValue[] | undefined): TypedNoteDraft | undefined =>
    values === undefined ? undefined : setDraftValues(draft, field.key, values);
  const kind = field.kind;
  switch (kind.name) {
    case 'person':
    case 'relation':
      return set(await pickRows(form, field, current));
    case 'note':
      return set(await pickNotes(form, field, current));
    case 'select':
      return set(kind.options?.length ? await pickOptions(field, current) : await readText(field, current));
    case 'date': {
      const read = await askForDate({ title: field.name, value: current[0]?.text ?? '' });
      return read === undefined ? undefined : set(read.date ? [{ text: read.date }] : []);
    }
    case 'checkbox':
      return set(cycleCheckbox(current));
    case 'number':
    case 'email':
    case 'link':
    case 'phone':
    case 'text':
      return set(await readText(field, current));
  }
}

/** A checkbox's next value in place: Not set, then Yes, then No, then Not set again. */
function cycleCheckbox(current: readonly DraftValue[]): DraftValue[] {
  const now = current[0]?.text;
  if (now === undefined) {
    return [{ text: 'true' }];
  }
  return now === 'true' ? [{ text: 'false' }] : [];
}

/** One choice of a field's pick: a value to write, or Clear. */
interface ValueItem extends vscode.QuickPickItem {
  value?: DraftValue;
  clear?: true;
}

/** The first row of a pick for one value, once the field holds one: Clear. */
const CLEAR_ITEM: ValueItem = { label: '$(close) Clear', description: 'Take the value off', clear: true };

/** The title-bar button that clears a field that holds several. */
function clearButton(): vscode.QuickInputButton {
  return { iconPath: new vscode.ThemeIcon('clear-all'), tooltip: 'Clear: untick every value' };
}

/**
 * The rows a person or relation field can name, each with its type and
 * first relation; several for a field that holds several. Text typed that
 * names no row is kept as written, as values written by hand are.
 */
function pickRows(form: FormContext, field: DraftField, current: readonly DraftValue[]): Promise<DraftValue[] | undefined> {
  const index = form.writes.indexer.getSnapshot();
  const types = form.writes.indexer.getTypeIndex();
  const items: ValueItem[] = listKindRows(types, index, field.kind).map((choice) => ({
    label: choice.title,
    description: choice.id.startsWith('file:') ? undefined : choice.id,
    detail: choice.detail,
    value: { text: choice.written.slice(1, -1), title: choice.title },
  }));
  const target = field.kind.name === 'person' ? 'Person' : (types.registry.get(field.kind.targets?.[0] ?? '')?.name ?? 'Row');
  const named = field.kind.many ? pluralTypeName(target) : target;
  return pickValues(field, current, items, { placeholder: `Choose the ${named.toLowerCase()}, or write a name` });
}

/** A Note field's notes, the one changed last first; a title typed that names no note is kept as its link. */
function pickNotes(form: FormContext, field: DraftField, current: readonly DraftValue[]): Promise<DraftValue[] | undefined> {
  const items: ValueItem[] = listNoteChoices(form.writes.indexer.getSnapshot().files.values()).map((choice) => {
    const title = noteTitle(choice.filePath);
    return { label: title, description: choice.description, value: { text: `[[${title}]]`, title } };
  });
  return pickValues(field, current, items, { placeholder: 'Choose a note, or write its title' });
}

/** A select's options, as the schema spells them; several for a field that holds several. */
function pickOptions(field: DraftField, current: readonly DraftValue[]): Promise<DraftValue[] | undefined> {
  const items: ValueItem[] = (field.kind.options ?? []).map((option) => ({ label: option, value: { text: option } }));
  return pickValues(field, current, items, { placeholder: `Choose ${field.kind.many ? 'the options' : 'an option'}`, typed: false });
}

/**
 * A pick of a field's values, those it holds chosen: for one value, Enter
 * on a row takes it, Clear takes the value off, and, when `typed`, Enter
 * on text that matches no row takes the text; for several, the rows ticked
 * are its values, with the text typed added, and the Clear button takes
 * them all off.
 */
function pickValues(
  field: DraftField,
  current: readonly DraftValue[],
  items: readonly ValueItem[],
  choose: { placeholder: string; typed?: boolean },
): Promise<DraftValue[] | undefined> {
  const { placeholder } = choose;
  const typed = choose.typed !== false;
  const holds = (item: ValueItem): boolean => current.some((value) => value.text.toLowerCase() === item.value?.text.toLowerCase());
  const loose = current.filter((value) => !items.some((item) => item.value?.text.toLowerCase() === value.text.toLowerCase()));
  const looseItems: ValueItem[] = loose.map((value) => ({ label: value.title ?? value.text, description: 'as written', value }));
  const all = [...looseItems, ...items];
  const many = field.kind.many;
  return showQuickPickUntilHidden<ValueItem, DraftValue[]>({
    configure: (pick) => {
      pick.title = field.name;
      pick.placeholder = placeholder;
      pick.matchOnDescription = true;
      pick.ignoreFocusOut = true;
      if (many) {
        pick.canSelectMany = true;
        pick.items = all;
        pick.selectedItems = all.filter(holds);
        if (current.length > 0) {
          pick.buttons = [clearButton()];
          pick.onDidTriggerButton(() => {
            pick.selectedItems = [];
          });
        }
        return;
      }
      pick.items = current.length > 0 ? [CLEAR_ITEM, ...all] : all;
      const active = all.find(holds);
      if (active) {
        pick.activeItems = [active];
      }
    },
    accept: (pick) => {
      const text = pick.value.trim();
      const writtenAsTyped = typed && text && !all.some((item) => item.label.toLowerCase() === text.toLowerCase()) ? [{ text }] : [];
      if (many) {
        return [...pick.selectedItems.flatMap((item) => item.value ?? []), ...writtenAsTyped];
      }
      const chosen = pick.selectedItems[0];
      if (chosen?.clear) {
        return [];
      }
      if (chosen?.value) {
        return [chosen.value];
      }
      return writtenAsTyped.length > 0 ? writtenAsTyped : undefined;
    },
  });
}

/** What each kind's input box asks for. */
const TEXT_PROMPTS: Partial<Record<FieldKind['name'], string>> = {
  number: 'A number, such as 12 or 1,200.',
  email: 'An email address.',
  link: 'A link, such as https://example.com.',
  phone: 'A phone number.',
  select: 'A value.',
  text: 'Text, as it will be written.',
};

/** Typed text for a field, checked as it is typed; several split at commas for a field that holds several. Empty clears it. */
async function readText(field: DraftField, current: readonly DraftValue[]): Promise<DraftValue[] | undefined> {
  const now = Date.now();
  const many = field.kind.many ? ' Separate several with commas.' : '';
  const written = await vscode.window.showInputBox({
    title: field.name,
    prompt: `${TEXT_PROMPTS[field.kind.name] ?? 'A value.'}${many}${current.length > 0 ? ' Leave it empty to clear it.' : ''}`,
    value: describeDraftValues(field.kind, current),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const check = checkFieldText(field, value, now);
      if (!check) {
        return undefined;
      }
      return {
        message: check.message,
        severity: check.severity === 'error' ? vscode.InputBoxValidationSeverity.Error : vscode.InputBoxValidationSeverity.Warning,
      };
    },
  });
  return written === undefined ? undefined : readFieldText(field.kind, written, now);
}

/**
 * What keeps the draft from being written, read against the index and the
 * disk now: the hub note its tag already has, or a note already at its path.
 */
async function checkDraft(form: FormContext, draft: TypedNoteDraft): Promise<DraftProblem | undefined> {
  const { indexer } = form.writes;
  const index = indexer.getSnapshot();
  const types = indexer.getTypeIndex();
  const path = draftNotePath(draft);
  const there = path !== undefined && (await fileExists(vscode.Uri.joinPath(form.notesFolder, ...path.split('/'))));
  return checkTypedNoteDraft(form.type, draft, {
    hubOf: (tagKey) => types.rowOfTag(tagKey)?.filePath ?? index.tags.get(tagKey)?.hubFilePaths?.find((hub) => index.files.has(hub)),
    exists: () => there,
  });
}

/**
 * Writes the note: asks the template's questions, if it has any, then
 * writes the note as one write and opens it. `back` when a question was
 * dismissed, so the form opens again; undefined when nothing was written.
 */
async function writeDraft(
  form: FormContext,
  draft: TypedNoteDraft,
  options: { template: string | undefined; open: 'active' | 'beside' },
): Promise<vscode.Uri | undefined | 'back'> {
  const { type } = form;
  const name = type.name.toLowerCase();
  let answers: Map<string, string> | undefined;
  if (options.template !== undefined) {
    answers = await askTemplateQuestions(options.template, `Add ${name}: ${draft.title.trim()}`);
    if (!answers) {
      return 'back';
    }
  }
  const plan = planTypedNote(type, draft, { template: options.template, now: new Date(), answers });
  if (!plan) {
    return 'back';
  }
  const uri = vscode.Uri.joinPath(form.notesFolder, ...plan.folder.split('/').filter(Boolean), plan.fileName);
  if (await fileExists(uri)) {
    void reportFailure({ outcome: `${plan.path} already exists, so Deckard did not create the ${name}.`, action: openNoteAction(uri) });
    return undefined;
  }
  if (!(await writeNewNote(form.writes.history, uri, plan.content, `Create ${type.name} "${draft.title.trim()}"`))) {
    void reportFailure({ outcome: `VS Code did not accept the new note, so Deckard did not create the ${name}.` });
    return undefined;
  }
  await openNewNote(uri, options.open);
  if (plan.unwritten.length > 0) {
    void vscode.window.showInformationMessage(
      `The ${name}'s template writes ${plan.unwritten.join(', ')} in a way Deckard cannot rewrite, so ${plan.unwritten.length === 1 ? 'it keeps' : 'they keep'} the template's value.`,
    );
  }
  return uri;
}

/**
 * New Note from Type…: the workspace's types, each with where its notes go
 * and how many it has, then the form for the one chosen. A workspace with
 * no types is told so, and offered Create Type from Tags….
 */
export async function newTypedNote(writes: TypeWrites): Promise<vscode.Uri | undefined> {
  await writes.indexer.ready;
  const choices = listTypeChoices(writes.indexer.getTypeIndex());
  if (choices.length === 0) {
    const create = 'Create Type from Tags…';
    const choice = await vscode.window.showInformationMessage(
      'This workspace has no types yet. A type is a note in Types/ that names the fields its notes have.',
      create,
    );
    if (choice === create) {
      await vscode.commands.executeCommand('deckard.createTypeFromTags');
    }
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(choices, {
    title: 'Deckard: New Note from Type',
    placeHolder: 'Choose the type of the new note',
    matchOnDescription: true,
  });
  if (!picked) {
    return undefined;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  return openTypeNoteForm(writes, { typeKey: picked.typeKey, ...(active ? { near: active } : {}) });
}

/**
 * Create hub note for a tag, from the palette, a tag's page, or a type's
 * rows tab: for a tag a type has rows of, the form, its tag and title
 * filled in and the tag kept; for any other tag, its hub note as before.
 */
export async function createHubNoteForTag(
  writes: { indexer: IndexReader<vscode.Uri>; history: TypeWrites['history'] },
  tagKey: string,
): Promise<vscode.Uri | undefined> {
  const { indexer } = writes;
  await indexer.ready;
  const index = indexer.getSnapshot();
  const start = findTypedHubStart(index, indexer.getTypeIndex(), tagKey);
  if (!start) {
    return createHubNote(indexer, tagKey);
  }
  const tag = index.tags.get(tagKey.toLowerCase());
  const near = tag?.filePaths[0] === undefined ? undefined : indexer.getUri(tag.filePaths[0]);
  return openTypeNoteForm(writes, { typeKey: start.typeKey, start: { title: start.title, tag: start.tag }, ...(near ? { near } : {}) });
}
