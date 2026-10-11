/**
 * The form a new note of a type is made in, as rows
 * (docs/implementation/31-type-note-form.md): what each row says, the
 * title and the line under it, the types New Note from Type offers, the
 * folders the Folder row offers, and which tags make their hub note in the
 * form rather than as a bare hub note. The same form edits a row's note
 * that exists (docs/implementation/34-edit-fields-form.md): its fields as
 * the note holds them, then what other notes set on it, then Save changes.
 *
 * It is the task editor's form (`createEditorRows`) for a note: a row per
 * field with its value, separators between groups, and the last row writing.
 */
import { noteTitle } from '../../domain/index/backlinks';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import { nameDay } from '../../domain/markdown/dates';
import { type DateFormats, DEFAULT_DATE_FORMATS } from '../../domain/markdown/dateFormat';
import type { FieldKind, FieldKindName, WorkspaceIndex } from '../../domain/model';
import { formatFieldCondition } from '../../domain/query/queryFormat';
import { rowNotesFolder } from '../../domain/types/rowNotes';
import {
  draftNotePath,
  draftTagOf,
  listChangedFields,
  listDraftFields,
  type DraftProblem,
  type DraftType,
  type DraftValue,
  type TypedNoteDraft,
} from '../../domain/types/typedNoteDraft';
import type { FieldValue, RowField, TypeIndex, TypeRow } from '../../domain/types/typeIndex';
import { listTypeQueryFields } from '../../domain/types/typeQueryFields';
import { pluralize } from '../../shared/text';
import type { FieldSource } from '../protocol/fields';
import { describeFieldSources } from './noteFields';
import { writeQueryValue } from './sameTypeRows';
import { writeRowValue } from './typeRows';

/**
 * Which row of the form a row is: where the note goes, its title, its tag,
 * a field, or, editing a note, a field other notes set on it.
 */
export type FormRowKind = 'folder' | 'title' | 'tag' | 'field' | 'reverse';

/** One row of the form, as its pick lists it; a separator heads a group. */
export interface TypeNoteFormRow {
  label: string;
  description?: string;
  /** The line under it: where a field other notes set is set. */
  detail?: string;
  /** Drawn as a separator, with its label, if any, as the group's name. */
  separator?: true;
  row?: FormRowKind;
  /** The field a field's row sets, by its front-matter key; a reverse's row, the reverse's name. */
  fieldKey?: string;
  /** The last row, which writes the note, or saves the changes to it. */
  done?: true;
}

/** The codicon each kind of field is drawn with. */
const KIND_ICONS: Readonly<Record<FieldKindName, string>> = {
  person: 'person',
  relation: 'link',
  select: 'list-selection',
  date: 'calendar',
  number: 'symbol-number',
  checkbox: 'check',
  email: 'mail',
  link: 'link-external',
  phone: 'device-mobile',
  note: 'note',
  text: 'symbol-text',
};

/** A field's row's codicon, by its kind. */
export function kindIcon(kind: Pick<FieldKind, 'name'>): string {
  return KIND_ICONS[kind.name];
}

/** A folder under the notes folder as the form names it: `Teams/`, or the notes folder itself. */
export function nameDraftFolder(folder: string): string {
  return folder ? `${folder}/` : 'the notes folder';
}

/** `a team`, `an incident`: a type's name with the article a sentence gives it. */
function withArticle(name: string): string {
  const lower = name.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}`;
}

/**
 * The form's title, naming where the note goes, as Add Task's does: `Add a
 * team to Teams/`; editing a note, the note, `Edit fields: Rates`.
 */
export function titleTypeNoteForm(type: Pick<DraftType, 'name'>, draft: Pick<TypedNoteDraft, 'folder' | 'existing'>): string {
  if (draft.existing) {
    return `Edit fields: ${draft.existing.title}`;
  }
  return `Add ${withArticle(type.name)} to ${nameDraftFolder(draft.folder)}`;
}

/**
 * The line under the form's title: what will be written, the note's path
 * and, for a namespace type, its tag, `Teams/Risk Tech.md · #team/risk-tech`;
 * before a title, where it goes and that a title names it. Editing a note,
 * its type and path, `Team · Teams/Rates.md`.
 */
export function previewTypeNoteForm(type: DraftType, draft: TypedNoteDraft): string {
  if (draft.existing) {
    return `${type.name} · ${draft.existing.filePath}`;
  }
  const path = draftNotePath(draft);
  if (!path) {
    return `${nameDraftFolder(draft.folder)} · Choose Title to name the note`;
  }
  const tag = draftTagOf(type, draft);
  return tag ? `${path} · ${tag}` : path;
}

/**
 * What a field's values say in its row: a row's or note's title, a day
 * with its weekday in the reader's `formats`, a checkbox's Yes or No,
 * anything else as written; several joined by commas.
 */
export function describeDraftValues(kind: Pick<FieldKind, 'name'>, values: readonly DraftValue[], formats: DateFormats = DEFAULT_DATE_FORMATS): string {
  return values
    .map((value) => {
      if (value.title) {
        return value.title;
      }
      if (kind.name === 'date') {
        return nameDay(value.text, formats);
      }
      if (kind.name === 'checkbox') {
        return value.text === 'true' ? 'Yes' : 'No';
      }
      return kind.name === 'note' ? value.text.replace(/^\[\[|\]\]$/g, '') : value.text;
    })
    .join(', ');
}

/** What building the form's rows reads besides the type and the draft. */
export interface FormRowOptions {
  /** The reader's date formats, for a date field's value. */
  formats?: DateFormats;
  /** What keeps the note from being written, said on its row in place of its value. */
  problem?: DraftProblem;
  /** Editing a note: what other notes set on it, listed after its fields. */
  reverses?: readonly FormReverse[];
  /** Editing a note: why the changes were not saved, said on Save changes. */
  saveProblem?: string;
}

/**
 * The rows of the form, as its pick shows them: Folder, Title, and, for a
 * namespace type, Tag; then the type's fields in the schema's order, each
 * with its value or Not set; then Create the note.
 */
export function createTypeNoteFormRows(type: DraftType, draft: TypedNoteDraft, options: FormRowOptions = {}): TypeNoteFormRow[] {
  if (draft.existing) {
    return createEditFormRows(type, draft, options);
  }
  const { problem } = options;
  const said = (row: FormRowKind, description: string): string =>
    problem?.row === row ? `$(error) ${problem.message}` : description;
  const folder = draft.folder === rowNotesFolder(type) ? `${nameDraftFolder(draft.folder)} · the ${type.name.toLowerCase()} folder` : nameDraftFolder(draft.folder);
  const rows: TypeNoteFormRow[] = [
    { label: '$(file) Folder', description: said('folder', folder), row: 'folder' },
    { label: '$(pencil) Title', description: said('title', draft.title.trim() || 'Empty'), row: 'title' },
  ];
  if (type.rows?.kind === 'tags') {
    rows.push({ label: '$(tag) Tag', description: said('tag', describeDraftTag(type, draft)), row: 'tag' });
  }
  rows.push(...createFieldRows(type, draft, options));
  rows.push({ label: '', separator: true }, { label: '$(save) Create the note', description: 'Enter', done: true });
  return rows;
}

/**
 * The type's fields, under a Fields separator, in the schema's order: each
 * with its value or Not set; editing a note, a field the writer cannot
 * rewrite says to edit it in the note.
 */
function createFieldRows(type: DraftType, draft: TypedNoteDraft, options: FormRowOptions): TypeNoteFormRow[] {
  const fields = listDraftFields(type);
  if (fields.length === 0) {
    return [];
  }
  return [
    { label: 'Fields', separator: true },
    ...fields.map((field): TypeNoteFormRow => {
      const values = draft.values[field.key] ?? [];
      const refused = draft.existing?.refused[field.key] !== undefined;
      let description = values.length > 0 ? describeDraftValues(field.kind, values, options.formats) : 'Not set';
      if (refused) {
        description = 'Edit in the note';
      }
      return { label: `$(${kindIcon(field.kind)}) ${field.name}`, description, row: 'field', fieldKey: field.key };
    }),
  ];
}

/**
 * The rows of the form editing a note that exists: its fields as it holds
 * them, never its folder, title, or tag, since editing moves and renames
 * nothing; then, under From other notes, what other notes set on it, each
 * saying where; then Save changes, which says No changes until a field
 * has changed, or why the changes were not saved.
 */
function createEditFormRows(type: DraftType, draft: TypedNoteDraft, options: FormRowOptions): TypeNoteFormRow[] {
  const rows = createFieldRows(type, draft, options);
  const reverses = options.reverses ?? [];
  if (reverses.length > 0) {
    rows.push({ label: 'From other notes', separator: true });
    reverses.forEach((reverse) => {
      rows.push({ label: `$(${kindIcon(reverse.kind)}) ${reverse.name}`, description: reverse.values, detail: reverse.detail, row: 'reverse', fieldKey: reverse.name });
    });
  }
  let description = listChangedFields(type, draft).length > 0 ? 'Enter' : 'No changes';
  if (options.saveProblem) {
    description = `$(error) ${options.saveProblem}`;
  }
  rows.push({ label: '', separator: true }, { label: '$(save) Save changes', description, done: true });
  return rows;
}

/** What one of a note's reverses opens: the one note that sets it, at its line, or the search for the rows that do. */
export type ReverseOpening = { filePath: string; line: number } | { query: string };

/** A field other notes set on a row, as the form lists it under From other notes. */
export interface FormReverse {
  name: string;
  kind: Pick<FieldKind, 'name'>;
  /** Its values, by title: `Dana Whitfield, Omar Haddad`. */
  values: string;
  /** Where it is set, in the pages' words: `Set in Payments' lead`, `Set in each person's manager`. */
  detail: string;
  open: ReverseOpening;
}

/** `Set in Payments' lead`, `Set in each person's manager and Rates' owns`: where a reverse is set, as a page says it. */
export function describeSourcesText(from: readonly FieldSource[]): string {
  return `Set in ${from.map((source) => `${source.owner} ${source.field}`).join(' and ')}`;
}

/**
 * What other notes set on a row, as the form editing its note lists them:
 * each reverse other rows' relations give it, its values by title, where
 * it is set, and what choosing it opens: the one note that sets it, at the
 * line it does, or, when several do, the search for those rows,
 * `type = person AND manager = @noor`. A reverse with nothing to open is
 * left out.
 */
export function describeFormReverses(types: TypeIndex, row: TypeRow): FormReverse[] {
  return types.fields(row.id).flatMap((field) => {
    if (field.source !== 'reverse' && field.source !== 'computed') {
      return [];
    }
    const open = findReverseOpening(types, row, field);
    const from = describeFieldSources(types, field);
    if (!open || from.length === 0) {
      return [];
    }
    return [{
      name: field.name,
      kind: field.kind,
      values: field.values.map((value) => (value.rowId ? (types.row(value.rowId)?.title ?? value.text) : value.text)).join(', '),
      detail: describeSourcesText(from),
      open,
    }];
  });
}

/** What choosing a reverse opens: the note of the one row that sets it, at its line, or the search for every row that does. */
function findReverseOpening(types: TypeIndex, row: TypeRow, field: RowField): ReverseOpening | undefined {
  const sources = field.values.filter((value): value is FieldValue & { via: NonNullable<FieldValue['via']> } => value.via !== undefined);
  const rows = new Set(sources.map((value) => value.via.rowId));
  if (rows.size === 1) {
    const value = sources[0];
    const filePath = value.filePath ?? types.row(value.via.rowId)?.filePath;
    if (filePath) {
      return { filePath, line: value.line ?? 1 };
    }
  }
  const self = writeQueryValue(types, { text: row.title, rowId: row.id });
  const groups = new Map<string, string>();
  sources.forEach(({ via }) => {
    const type = types.typeOf(via.rowId);
    const queryName = type ? listTypeQueryFields(types.registry, type.key).find((each) => each.source === 'field' && each.label === via.field)?.name : undefined;
    if (type && queryName && self) {
      groups.set(`${type.key}\u0000${queryName}`, `type = ${type.key} AND ${formatFieldCondition({ name: queryName, operator: 'eq', values: [self] })}`);
    }
  });
  const queries = [...groups.values()];
  if (queries.length === 0) {
    return undefined;
  }
  return { query: queries.length === 1 ? queries[0] : queries.map((query) => `(${query})`).join(' OR ') };
}

/**
 * Each field of a row's type as its note holds it, as the form editing it
 * starts: a value that names a row as Deckard writes it, `@dana`, with its
 * title; a note as its link; a date as `YYYY-MM-DD`; a checkbox as `true`
 * or `false`; a select's option as the schema spells it; a value that names
 * nothing as written. Values other notes give it are left out.
 */
export function readNoteDraftValues(types: TypeIndex, row: TypeRow): Record<string, DraftValue[]> {
  const values: Record<string, DraftValue[]> = {};
  types.fields(row.id).forEach((field) => {
    const schema = field.field;
    if (!schema || field.source === 'reverse' || field.source === 'computed') {
      return;
    }
    const written = field.values.filter((value) => !value.via).map((value) => readDraftValue(types, value));
    if (written.length > 0) {
      values[schema.key] = written;
    }
  });
  return values;
}

/** One value a note writes, as the form holds it. */
function readDraftValue(types: TypeIndex, value: FieldValue): DraftValue {
  if (value.unresolved) {
    return { text: value.text };
  }
  if (value.rowId) {
    const named = types.row(value.rowId);
    return named ? { text: writeRowValue(named).slice(1, -1), title: named.title } : { text: value.rowId };
  }
  if (value.notePath) {
    const title = noteTitle(value.notePath);
    return { text: `[[${title}]]`, title };
  }
  if (value.checked !== undefined) {
    return { text: value.checked ? 'true' : 'false' };
  }
  return { text: value.date ?? value.option ?? value.text };
}

/** What the Tag row says: the tag, and whether it follows the title or was given. */
function describeDraftTag(type: DraftType, draft: TypedNoteDraft): string {
  const tag = draftTagOf(type, draft);
  if (!tag) {
    return 'Not set';
  }
  if (draft.tagFixed) {
    return `${tag} · the tag this note describes`;
  }
  return draft.tag === undefined ? `${tag} · from the title` : tag;
}

/** A type New Note from Type offers. */
export interface TypeChoice {
  label: string;
  description: string;
  typeKey: string;
}

/**
 * The workspace's types by name, each saying where its notes go and how
 * many rows it has: `Teams/ · 5 rows`, or, for a note type, what its notes
 * write and how many do, `type: incident · 7 notes`.
 */
export function listTypeChoices(types: TypeIndex): TypeChoice[] {
  return [...types.registry.types]
    .filter((type) => type.rows !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((type) => {
      const count = types.rows(type.key).filter((row) => !row.implicit).length;
      const description =
        type.rows?.kind === 'notes'
          ? `type: ${type.key} · ${pluralize(count, 'note')}`
          : `${nameDraftFolder(rowNotesFolder(type))} · ${pluralize(count, 'row')}`;
      return { label: type.name, description, typeKey: type.key };
    });
}

/** A folder the Folder row offers. */
export interface FolderChoice {
  label: string;
  description: string;
  /** The folder under the notes folder, or empty for the notes folder itself. */
  folder: string;
}

/** Which notes the Folder row counts, and what it leads with. */
export interface FolderChoiceOptions {
  /** The notes folder's index path, `notes`, or empty when it is the workspace folder. */
  notesFolder: string;
  /** The type's own folder, which leads the list whether or not it holds a note yet. */
  typeFolder: string;
}

/**
 * The folders under the notes folder that hold notes, the type's own first,
 * then the notes folder itself, then the rest, most notes first: each with
 * how many notes it holds, counting those in the folders under it.
 */
export function listFolderChoices(filePaths: Iterable<string>, options: FolderChoiceOptions): FolderChoice[] {
  const prefix = options.notesFolder ? `${options.notesFolder.replace(/\/+$/, '')}/` : '';
  const counts = new Map<string, number>([['', 0]]);
  for (const filePath of filePaths) {
    if (!filePath.startsWith(prefix)) {
      continue;
    }
    const parts = filePath.slice(prefix.length).split('/').slice(0, -1);
    counts.set('', (counts.get('') ?? 0) + 1);
    parts.forEach((_, end) => {
      const folder = parts.slice(0, end + 1).join('/');
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    });
  }
  const typeCount = counts.get(options.typeFolder) ?? 0;
  counts.delete(options.typeFolder);
  const rootCount = counts.get('') ?? 0;
  counts.delete('');
  const choice = (folder: string, count: number, also?: string): FolderChoice => ({
    label: folder ? `${folder}/` : 'The notes folder',
    description: [pluralize(count, 'note'), ...(also ? [also] : [])].join(' · '),
    folder,
  });
  return [
    choice(options.typeFolder, typeCount, 'the type\'s folder'),
    ...(options.typeFolder === '' ? [] : [choice('', rootCount)]),
    ...[...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([folder, count]) => choice(folder, count)),
  ];
}

/** Where a tag's hub note is made in the form: its type, the tag as written, and the title its row has. */
export interface TypedHubStart {
  typeKey: string;
  tag: string;
  title: string;
}

/**
 * Whether Create hub note for a tag opens the form: for a tag a type has
 * rows of, the type, the tag as the workspace writes it, and the title its
 * row goes by (`Bond Trading`); undefined for a tag no type has, whose hub
 * note is made as before.
 */
export function findTypedHubStart(index: WorkspaceIndex, types: TypeIndex, tagKey: string): TypedHubStart | undefined {
  const key = tagKey.toLowerCase();
  const type = types.isEmpty ? undefined : types.registry.forTag(key);
  if (!type) {
    return undefined;
  }
  const tag = index.tags.get(key)?.label ?? tagKey;
  const title = types.rowOfTag(key)?.title ?? formatKeyWords(key.replace(/^[#@]/, '').split('/').pop() ?? key);
  return { typeKey: type.key, tag, title };
}

/**
 * The field the form opens on before its rows, when it is asked to start
 * at one, as a field's name on a page does: a field the form lists, by its
 * key, any case. Undefined for none, or for a key the type does not have
 * or the form writes itself, and the form opens as usual.
 */
export function findStartField(type: Pick<DraftType, 'fields'>, key: string | undefined): DraftType['fields'][number] | undefined {
  const wanted = key?.trim().toLowerCase();
  return wanted ? listDraftFields(type).find((field) => field.key === wanted) : undefined;
}
