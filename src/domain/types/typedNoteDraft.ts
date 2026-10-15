/**
 * A new note of a type, as its form builds it up before anything is
 * written (docs/implementation/31-type-note-form.md): its title, folder,
 * tag for a namespace type, and the values its fields are given, what is
 * wrong with it, and the note it comes to. The same form edits a row's
 * note that exists (docs/implementation/34-edit-fields-form.md): the draft
 * then holds the note as it was read, and a save writes only the fields
 * changed since.
 *
 * The note is `planRowNote`'s, the type's template filled or each field's
 * key, with each field the form set written by `setFrontmatterField` in
 * the form Deckard writes by kind (docs/implementation/30-databases.md
 * § Values): a row as its tag or link, several as a flow list, a date as
 * `YYYY-MM-DD`, a checkbox as `true` or `false`, a select's option as the
 * schema spells it. A value the form set takes the place of the key a
 * template writes.
 */
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { extractTags } from '../markdown/parser';
import { getExtractedNoteFileName } from '../markdown/noteNames';
import type { FieldKind, TypeField } from '../model';
import { readCheckboxValue, readDateValue, readNumberValue, readSelectValue } from './fieldValues';
import { setFrontmatterField, type FrontmatterFieldWrite } from './frontmatterWriter';
import { planRowNote, rowNotesFolder, rowTagOf, type RowNoteOptions, type RowNoteType } from './rowNotes';

/** A type a new note can be made of: what a row's note is written from, its fields in full. */
export interface DraftType extends RowNoteType {
  fields: readonly Pick<TypeField, 'key' | 'name' | 'kind'>[];
}

/**
 * One value a field is given: as Deckard writes it (`@dana`,
 * `#team/rates`, `[[RFQ outage]]`, `2026-03-01`, `true`, `Gold`), and,
 * for a row, its title, which the form shows.
 */
export interface DraftValue {
  text: string;
  title?: string;
}

/** A new note of a type, before it is written. */
export interface TypedNoteDraft {
  typeKey: string;
  title: string;
  /** Its folder under the notes folder, `Teams`, or empty for the notes folder itself. */
  folder: string;
  /**
   * A namespace type's tag, as written, once it is not the title's: given,
   * or edited. Undefined follows the title (`#team/risk-tech` for "Risk Tech").
   */
  tag?: string;
  /** Whether the tag was given and cannot be changed, as for Create Hub Note for Tag. */
  tagFixed?: boolean;
  /** Each field given a value, by its front-matter key. */
  values: Readonly<Record<string, readonly DraftValue[]>>;
  /** Set when the form edits a note that exists rather than making one. */
  existing?: ExistingNote;
  /** Words written under the title of a new note, as its first paragraph. */
  body?: string;
}

/** A row's note the form edits, as it was when the form read it. */
export interface ExistingNote {
  /** Its path in the index: `Teams/Rates.md`. */
  filePath: string;
  title: string;
  /** Each field's values as the note held them, by key, as `values` holds them. */
  original: Readonly<Record<string, readonly DraftValue[]>>;
  /** The fields the writer cannot rewrite safely, by key, each with the one-based line to open the editor at. */
  refused: Readonly<Record<string, number>>;
  /** Its front matter as read, fences and all, to tell whether it has changed since; empty for none. */
  frontmatter: string;
}

/** Where a new note's form starts: a title, a tag, or a folder already chosen. */
export interface DraftStart {
  title?: string;
  /** A namespace type's tag, which the form then keeps. */
  tag?: string;
  folder?: string;
  /** Fields already given a value, by key, such as a term note's `term`; a key the type has no field for is left out. */
  values?: Readonly<Record<string, string>>;
  /** Words to write under the title, such as a term's definition. */
  body?: string;
}

/** The keys that say what a note is a row of, which the form writes itself. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(['describes', 'type']);

/** A new note of `type`, in its folder, with `start`'s title and tag. */
export function startTypedNoteDraft(type: DraftType, start: DraftStart = {}): TypedNoteDraft {
  const tag = type.rows?.kind === 'tags' && start.tag ? start.tag : undefined;
  const keys = new Set(listDraftFields(type).map((field) => field.key));
  const values = Object.entries(start.values ?? {}).filter(([key, value]) => keys.has(key) && value.trim() !== '');
  const body = start.body?.trim();
  return {
    typeKey: type.key,
    title: start.title?.trim() ?? '',
    folder: start.folder ?? rowNotesFolder(type),
    ...(tag ? { tag, tagFixed: true } : {}),
    values: Object.fromEntries(values.map(([key, value]) => [key, [{ text: value.trim() }]])),
    ...(body ? { body } : {}),
  };
}

/** The fields a new note's form lists: the schema's, in its order, but for a row's identity. */
export function listDraftFields(type: Pick<DraftType, 'fields'>): DraftType['fields'] {
  return type.fields.filter((field) => !IDENTITY_KEYS.has(field.key));
}

/** The tag a namespace type's new note will describe: the one given or edited, else the title's. */
export function draftTagOf(type: Pick<RowNoteType, 'rows'>, draft: Pick<TypedNoteDraft, 'tag' | 'title'>): string | undefined {
  if (type.rows?.kind !== 'tags') {
    return undefined;
  }
  return draft.tag ?? rowTagOf(type, draft.title);
}

/**
 * A tag typed for a namespace type's new note, under its namespace: `risk`
 * is `#team/risk`, `#team/rates/emea` stays, `team/risk` is `#team/risk`;
 * for people, `omar` is `@omar`, as is `#person/omar`. Undefined when the
 * text is no tag, or the type's rows are not tags.
 */
export function readDraftTag(type: Pick<RowNoteType, 'rows'>, written: string): string | undefined {
  const rows = type.rows;
  if (rows?.kind !== 'tags') {
    return undefined;
  }
  let rest = written.trim().replace(/^[#@]/, '');
  const namespace = rows.prefix === '@' ? 'person/' : rows.prefix.slice(1);
  if (rest.toLowerCase().startsWith(namespace.toLowerCase())) {
    rest = rest.slice(namespace.length);
  }
  if (!rest) {
    return undefined;
  }
  const tag = rows.prefix === '@' ? `@${rest}` : `${rows.prefix}${rest}`;
  const read = extractTags(tag);
  return read.length === 1 && read[0].label === tag ? tag : undefined;
}

/** The draft with a field's values, or without the field when there are none. */
export function setDraftValues(draft: TypedNoteDraft, key: string, values: readonly DraftValue[]): TypedNoteDraft {
  const others = Object.fromEntries(Object.entries(draft.values).filter(([each]) => each !== key));
  return { ...draft, values: values.length > 0 ? { ...others, [key]: values } : others };
}

/** The new note's path under the notes folder, `Teams/Risk Tech.md`; undefined while the title cannot name a file. */
export function draftNotePath(draft: Pick<TypedNoteDraft, 'title' | 'folder'>): string | undefined {
  const fileName = getExtractedNoteFileName(draft.title);
  return fileName ? joinFolder(draft.folder, fileName) : undefined;
}

/** A folder under the notes folder as the form writes it: `/` between parts, none around them, `.` and `..` refused. */
export function readDraftFolder(written: string): string | undefined {
  const parts = written.trim().replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || !getExtractedNoteFileName(part))) {
    return undefined;
  }
  return parts.join('/');
}

/** Which row of the form a problem is on: the title, the tag, or the folder. */
export type DraftProblemRow = 'title' | 'tag' | 'folder';

/** What keeps a new note from being written, and the row of the form it is on. */
export interface DraftProblem {
  row: DraftProblemRow;
  message: string;
}

/** What checking a draft reads besides it: the hub note a tag has, and whether a note is already at a path. */
export interface DraftFacts {
  /** The note that already describes a tag, by the tag's key, if one does. */
  hubOf?: (tagKey: string) => string | undefined;
  /** Whether a note is already at a path under the notes folder. */
  exists?: (path: string) => boolean;
}

/**
 * The first thing that keeps the draft from being written, on the row the
 * reader would change to fix it: no title, a title that cannot name a file
 * or, unless a tag is given, a tag; a folder that cannot be one; a tag
 * that already has a hub note; or a note already at its path, which is
 * never written over.
 */
export function checkTypedNoteDraft(type: DraftType, draft: TypedNoteDraft, facts: DraftFacts = {}): DraftProblem | undefined {
  const name = type.name.toLowerCase();
  const title = draft.title.trim();
  if (!title) {
    return { row: 'title', message: `A ${name} needs a title.` };
  }
  if (!getExtractedNoteFileName(title)) {
    return { row: 'title', message: `"${title}" cannot name a note: leave out / \\ : * ? " < > | and a dot or space at the end.` };
  }
  if (readDraftFolder(draft.folder) === undefined) {
    return { row: 'folder', message: `"${draft.folder}" cannot name a folder.` };
  }
  if (type.rows?.kind === 'tags') {
    const tag = draftTagOf(type, draft);
    if (!tag) {
      return draft.tag === undefined
        ? { row: 'title', message: `"${title}" cannot name a tag. Choose Tag to write one.` }
        : { row: 'tag', message: `"${draft.tag}" is not a tag.` };
    }
    const hub = facts.hubOf?.(tag.toLowerCase());
    if (hub) {
      return { row: draft.tagFixed ? 'title' : 'tag', message: `${tag} already has a hub note, ${hub}.` };
    }
  }
  const path = draftNotePath(draft);
  if (path && facts.exists?.(path)) {
    return { row: 'title', message: `${path} already exists. Choose another title or folder.` };
  }
  return undefined;
}

/** A new note of a type, as it will be written. */
export interface TypedNotePlan {
  /** Its folder under the notes folder, or empty for the notes folder itself. */
  folder: string;
  fileName: string;
  /** Its path under the notes folder: `Teams/Risk Tech.md`. */
  path: string;
  /** The tag it describes, for a namespace type's note. */
  tag?: string;
  content: string;
  /** The fields given a value that the template writes in a way Deckard cannot rewrite, by name; left as the template wrote them. */
  unwritten: string[];
}

/**
 * The note a draft comes to: `planRowNote`'s, in the draft's folder, for
 * its tag, with each field given a value written in. Undefined when the
 * title cannot name a file or, for a namespace type, there is no tag.
 */
export function planTypedNote(type: DraftType, draft: TypedNoteDraft, options: Omit<RowNoteOptions, 'tag'>): TypedNotePlan | undefined {
  const tag = draftTagOf(type, draft);
  const plan = planRowNote(type, draft.title.trim(), { ...options, ...(tag ? { tag } : {}) });
  if (!plan) {
    return undefined;
  }
  let content = plan.content;
  const unwritten: string[] = [];
  listDraftFields(type).forEach((field) => {
    const values = draft.values[field.key];
    if (!values?.length) {
      return;
    }
    const edit = setFrontmatterField(content, field.key, writeDraftValues(field.kind, values));
    if (edit.kind === 'edit') {
      content = edit.content;
    } else if (edit.kind === 'refused') {
      unwritten.push(field.name);
    }
  });
  if (draft.body) {
    content = `${content.replace(/\s*$/, '')}\n\n${draft.body}\n`;
  }
  const folder = readDraftFolder(draft.folder) ?? plan.folder;
  return { folder, fileName: plan.fileName, path: joinFolder(folder, plan.fileName), ...(plan.tag ? { tag: plan.tag } : {}), content, unwritten };
}

/**
 * What a field's values are written as: a checkbox, and a number written
 * as plain digits, bare; anything else quoted where YAML needs it; a field
 * that holds several as a list, even with one.
 */
export function writeDraftValues(kind: Pick<FieldKind, 'name' | 'many'>, values: readonly DraftValue[]): FrontmatterFieldWrite {
  return {
    values: values.map(({ text }) => ({
      text,
      ...(kind.name === 'checkbox' || (kind.name === 'number' && /^-?\d+(?:\.\d+)?$/.test(text.trim())) ? { bare: true } : {}),
    })),
    list: kind.many,
  };
}

/**
 * Typed text as a field of its kind holds it: a number as written; a date
 * as `YYYY-MM-DD`, read from plain words; a note as its link; a select's
 * option as the schema spells it; several values split at commas for a
 * field that holds several; anything else as typed. Undefined when the text
 * is not a value of the kind; empty when nothing was typed.
 */
export function readFieldText(kind: FieldKind, typed: string, now: number): DraftValue[] | undefined {
  const parts = (kind.many ? typed.split(',') : [typed]).map((part) => part.trim()).filter(Boolean);
  const values: DraftValue[] = [];
  for (const part of parts) {
    const value = readOneValue(kind, part, now);
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

/** One typed value of a kind, or undefined when it is not one. */
function readOneValue(kind: FieldKind, text: string, now: number): DraftValue | undefined {
  switch (kind.name) {
    case 'number':
      return readNumberValue(text) === undefined ? undefined : { text };
    case 'date': {
      const date = readDateValue(text, now);
      return date ? { text: date } : undefined;
    }
    case 'note': {
      const title = text.replace(/^\[\[|\]\]$/g, '').trim();
      return title ? { text: `[[${title}]]`, title } : undefined;
    }
    case 'select': {
      const option = readSelectValue(kind, text);
      return option ? { text: option } : undefined;
    }
    case 'checkbox': {
      const checked = readCheckboxValue(text);
      return checked === undefined ? undefined : { text: String(checked) };
    }
    case 'email':
      return EMAIL.test(text) ? { text } : undefined;
    case 'person':
    case 'relation':
    case 'text':
    case 'link':
    case 'phone':
      return { text };
  }
}

/** An email address: something, `@`, and a domain with a dot. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A URL with a scheme, or a host starting `www.`. */
const LINK = /^(?:[a-z][a-z0-9+.-]*:\S+|www\.\S+)$/i;
/** A phone number: digits, with spaces, dots, dashes, brackets, and a leading `+`. */
const PHONE = /^\+?[\d\s().-]*\d[\d\s().-]*$/;

/** What an input box says of typed text for a field: an error that refuses it, or a warning that lets it be written. */
export interface FieldTextCheck {
  message: string;
  severity: 'error' | 'warning';
}

/**
 * What a field's input box says as text is typed: a number, a date, or an
 * email that is not one is refused; a link or phone number that does not
 * look like one is let through with a warning, since plan 30 keeps values
 * written by hand as they are. Nothing for empty text.
 */
export function checkFieldText(field: Pick<TypeField, 'name' | 'kind'>, typed: string, now: number): FieldTextCheck | undefined {
  const parts = (field.kind.many ? typed.split(',') : [typed]).map((part) => part.trim()).filter(Boolean);
  const bad = parts.find((part) => readOneValue(field.kind, part, now) === undefined);
  switch (field.kind.name) {
    case 'number':
      return bad === undefined ? undefined : { message: `${field.name} is a number, and "${bad}" is not one.`, severity: 'error' };
    case 'date':
      return bad === undefined ? undefined : { message: `${field.name} is a date, and "${bad}" is not one.`, severity: 'error' };
    case 'email':
      return bad === undefined ? undefined : { message: `"${bad}" is not an email address.`, severity: 'error' };
    case 'link': {
      const odd = parts.find((part) => !LINK.test(part));
      return odd === undefined ? undefined : { message: `"${odd}" does not look like a link. It will be written as typed.`, severity: 'warning' };
    }
    case 'phone': {
      const odd = parts.find((part) => !PHONE.test(part));
      return odd === undefined ? undefined : { message: `"${odd}" does not look like a phone number. It will be written as typed.`, severity: 'warning' };
    }
    case 'text':
    case 'checkbox':
    case 'select':
    case 'person':
    case 'relation':
    case 'note':
      return undefined;
  }
}

/** A file in a folder under the notes folder, or in the notes folder itself. */
function joinFolder(folder: string, fileName: string): string {
  const clean = folder.trim().replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}/${fileName}` : fileName;
}

/** A row's note as the form reads it to edit: its path and title, its text, and each field's values. */
export interface ExistingNoteRead {
  filePath: string;
  title: string;
  content: string;
  values: Readonly<Record<string, readonly DraftValue[]>>;
}

/**
 * The draft that edits a row's note that exists: its values as read, the
 * fields the writer refuses, and its front matter, kept to tell a note
 * changed since from one that was not. Its title and folder are the
 * note's, which editing never changes.
 */
export function startExistingNoteDraft(type: DraftType, note: ExistingNoteRead): TypedNoteDraft {
  const values = Object.fromEntries(Object.entries(note.values).filter(([, each]) => each.length > 0));
  return {
    typeKey: type.key,
    title: note.title,
    folder: note.filePath.split('/').slice(0, -1).join('/'),
    values,
    existing: {
      filePath: note.filePath,
      title: note.title,
      original: values,
      refused: findRefusedFields(type, note.content),
      frontmatter: readFrontmatterBlock(note.content),
    },
  };
}

/**
 * The fields of a type a note writes in a way the writer cannot rewrite
 * safely, such as a `|` block or a nested map, by key, each with the
 * one-based line to open the editor at.
 */
export function findRefusedFields(type: Pick<DraftType, 'fields'>, content: string): Record<string, number> {
  const refused: Record<string, number> = {};
  listDraftFields(type).forEach((field) => {
    const edit = setFrontmatterField(content, field.key, { values: [{ text: 'x' }] });
    if (edit.kind === 'refused') {
      refused[field.key] = edit.line;
    }
  });
  return refused;
}

/** A note's front matter, its fences and the lines between, with `\n` between them; empty for a note with none. */
export function readFrontmatterBlock(content: string): string {
  const lines = content.split(/\r?\n/);
  const end = findFrontmatterEnd(lines);
  return end === undefined ? '' : lines.slice(0, end + 1).join('\n');
}

/** Whether two lists of values are the same, value for value, in order. */
function sameValues(left: readonly DraftValue[], right: readonly DraftValue[]): boolean {
  return left.length === right.length && left.every((value, at) => value.text === right[at].text);
}

/** The fields an edit of a note that exists has changed since it was read, in the schema's order; none for a new note. */
export function listChangedFields(type: Pick<DraftType, 'fields'>, draft: TypedNoteDraft): DraftType['fields'] {
  const existing = draft.existing;
  if (!existing) {
    return [];
  }
  return listDraftFields(type).filter((field) => !sameValues(draft.values[field.key] ?? [], existing.original[field.key] ?? []));
}

/**
 * What saving an edit comes to: nothing to write; a note whose front
 * matter changed since it was read, which is not written; a changed field
 * the writer cannot rewrite safely, and its line; or one replacement of
 * the note's lines, which an editor applies as one edit, and the names of
 * the fields it writes.
 */
export type FieldSavePlan =
  | { kind: 'unchanged' }
  | { kind: 'stale' }
  | { kind: 'refused'; key: string; name: string; line: number }
  | {
      kind: 'edit';
      content: string;
      /** The zero-based first line replaced, and how many of the old lines were replaced. */
      start: number;
      deleted: number;
      /** The lines written in their place, without line endings. */
      lines: string[];
      /** The names of the fields written, in the schema's order. */
      changed: string[];
    };

/**
 * Saves an edit of a note that exists, against `current`, the note as it
 * is now: each field changed since the note was read is written by
 * `setFrontmatterField`, in the form Deckard writes by kind, and nothing
 * else, so every other key and comment stays as written. A note whose front
 * matter is no longer what was read is stale, and nothing is written.
 */
export function planFieldSave(type: DraftType, draft: TypedNoteDraft, current: string): FieldSavePlan {
  const existing = draft.existing;
  const changed = listChangedFields(type, draft);
  if (!existing || changed.length === 0) {
    return { kind: 'unchanged' };
  }
  if (readFrontmatterBlock(current) !== existing.frontmatter) {
    return { kind: 'stale' };
  }
  let content = current;
  for (const field of changed) {
    const edit = setFrontmatterField(content, field.key, writeDraftValues(field.kind, draft.values[field.key] ?? []));
    if (edit.kind === 'refused') {
      return { kind: 'refused', key: field.key, name: field.name, line: edit.line };
    }
    if (edit.kind === 'edit') {
      content = edit.content;
    }
  }
  if (content === current) {
    return { kind: 'unchanged' };
  }
  return { kind: 'edit', content, ...diffLines(current.split(/\r?\n/), content.split(/\r?\n/)), changed: changed.map((field) => field.name) };
}

/** The one run of lines that differs between two texts: where it starts, how many old lines it replaces, and the new lines. */
function diffLines(before: readonly string[], after: readonly string[]): { start: number; deleted: number; lines: string[] } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
    tail += 1;
  }
  return { start, deleted: before.length - start - tail, lines: after.slice(start, after.length - tail) };
}
