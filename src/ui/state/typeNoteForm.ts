/**
 * The form a new note of a type is made in, as rows
 * (docs/implementation/31-type-note-form.md): what each row says, the
 * title and the line under it, the types New Note from Type offers, the
 * folders the Folder row offers, and which tags make their hub note in the
 * form rather than as a bare hub note.
 *
 * It is the task editor's form (`createEditorRows`) for a note: a row per
 * field with its value, separators between groups, and the last row writing.
 */
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import { nameDay } from '../../domain/markdown/dates';
import { type DateFormats, DEFAULT_DATE_FORMATS } from '../../domain/markdown/dateFormat';
import type { FieldKind, FieldKindName, WorkspaceIndex } from '../../domain/model';
import { rowNotesFolder } from '../../domain/types/rowNotes';
import {
  draftNotePath,
  draftTagOf,
  listDraftFields,
  type DraftProblem,
  type DraftType,
  type DraftValue,
  type TypedNoteDraft,
} from '../../domain/types/typedNoteDraft';
import type { TypeIndex } from '../../domain/types/typeIndex';
import { pluralize } from '../../shared/text';

/** Which row of the form a row is: where the note goes, its title, its tag, or a field. */
export type FormRowKind = 'folder' | 'title' | 'tag' | 'field';

/** One row of the form, as its pick lists it; a separator heads a group. */
export interface TypeNoteFormRow {
  label: string;
  description?: string;
  /** Drawn as a separator, with its label, if any, as the group's name. */
  separator?: true;
  row?: FormRowKind;
  /** The field a field's row sets, by its front-matter key. */
  fieldKey?: string;
  /** The last row, which writes the note. */
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

/** The form's title, naming where the note goes, as Add Task's does: `Add a team to Teams/`. */
export function titleTypeNoteForm(type: Pick<DraftType, 'name'>, draft: Pick<TypedNoteDraft, 'folder'>): string {
  return `Add ${withArticle(type.name)} to ${nameDraftFolder(draft.folder)}`;
}

/**
 * The line under the form's title: what will be written, the note's path
 * and, for a namespace type, its tag, `Teams/Risk Tech.md · #team/risk-tech`;
 * before a title, where it goes and that a title names it.
 */
export function previewTypeNoteForm(type: DraftType, draft: TypedNoteDraft): string {
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
}

/**
 * The rows of the form, as its pick shows them: Folder, Title, and, for a
 * namespace type, Tag; then the type's fields in the schema's order, each
 * with its value or Not set; then Create the note.
 */
export function createTypeNoteFormRows(type: DraftType, draft: TypedNoteDraft, options: FormRowOptions = {}): TypeNoteFormRow[] {
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
  const fields = listDraftFields(type);
  if (fields.length > 0) {
    rows.push({ label: 'Fields', separator: true });
    fields.forEach((field) => {
      const values = draft.values[field.key] ?? [];
      rows.push({
        label: `$(${kindIcon(field.kind)}) ${field.name}`,
        description: values.length > 0 ? describeDraftValues(field.kind, values, options.formats) : 'Not set',
        row: 'field',
        fieldKey: field.key,
      });
    });
  }
  rows.push({ label: '', separator: true }, { label: '$(save) Create the note', description: 'Enter', done: true });
  return rows;
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
 * at one, as a tag's page's Edit on a field Not set does: a field the form
 * lists, by its key, any case. Undefined for none, or for a key the type
 * does not have or the form writes itself, and the form opens as usual.
 */
export function findStartField(type: Pick<DraftType, 'fields'>, key: string | undefined): DraftType['fields'][number] | undefined {
  const wanted = key?.trim().toLowerCase();
  return wanted ? listDraftFields(type).find((field) => field.key === wanted) : undefined;
}
