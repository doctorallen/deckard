/**
 * A typed row's fields as the Note page and a tag's page draw them, and
 * what an edit on the Note page writes (docs/implementation/30-databases.md
 * § Surfaces 5 and 6, § Writes).
 *
 * - The fields that hold something come first, in the schema's order, then
 *   the reverses other rows' relations give the row, then the note's other
 *   front-matter keys, its identity (`describes:`, `type:`) aside. A reverse
 *   says what it is worked out from: "From each person's team".
 * - The schema's empty fields are listed apart, for the page to fold into
 *   "1 empty: email".
 * - On the Note page each schema field the note can write has an editor by
 *   its kind, and each relation's rows are listed once for every editor
 *   that offers them.
 * - On a tag's page with no hub note, each reverse value names what the
 *   row it names holds of people (`lead Dana Whitfield · on-call Sam
 *   Ortiz`), so a row with no note still shows who owns it.
 */
import { noteTitle } from '../../domain/index/backlinks';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import type { FieldKind, WorkspaceIndex } from '../../domain/model';
import { readDateValue, readNumberValue, readSelectValue } from '../../domain/types/fieldValues';
import type { FrontmatterFieldWrite, FrontmatterWriteValue } from '../../domain/types/frontmatterWriter';
import { getTypeIndex, type FieldValue, type RowField, type TypeIndex, type TypeRow } from '../../domain/types/typeIndex';
import type { DrawnField, DrawnFields, DrawnFieldValue, FieldChoice, FieldEditor, FieldEditValue } from '../protocol/fields';
import { rowTag } from './typeHover';
import { listKindRows, valueTitle } from './typeRows';

/** The keys that say what a note is a row of, which the page names by its type rather than as fields. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(['describes', 'type']);

/** How many person fields a reverse value's detail names at most. */
const DETAIL_FIELD_LIMIT = 3;

/** A front-matter key the note writes besides its type's fields, with its values. */
export interface OtherKey {
  name: string;
  values: DrawnFieldValue[];
}

/**
 * The row whose fields a note holds: the first by its type's key when it
 * holds several, as the type index reads a field two of them define.
 */
export function findNoteRow(types: TypeIndex, filePath: string): TypeRow | undefined {
  return types.rowsOfFile(filePath).sort((left, right) => left.typeKey.localeCompare(right.typeKey))[0];
}

/**
 * The Note page's fields for a note that is a typed row, each the note
 * writes with its editor and each relation's rows listed once; undefined
 * for a note no type has. `others` are the note's other front-matter keys,
 * as the page reads them.
 */
export function describeNoteFields(index: WorkspaceIndex, filePath: string, others: readonly OtherKey[]): DrawnFields | undefined {
  const types = getTypeIndex(index);
  const row = types.isEmpty ? undefined : findNoteRow(types, filePath);
  if (!row) {
    return undefined;
  }
  const choices: Record<string, FieldChoice[]> = {};
  const fields = describeRowFields(types, row, {
    others,
    editor: (field) => {
      const editor = describeEditor(field);
      if (editor?.choices && field.field && !choices[editor.choices]) {
        choices[editor.choices] = listKindRows(types, index, field.field.kind).map(({ id, title, detail, names }) => ({ id, title, detail, names }));
      }
      return editor;
    },
  });
  return { ...fields, choices };
}

/**
 * A tag's page's fields for its typed row, read-only: with its hub note,
 * the hub's fields and other keys, as the Note page draws them; without
 * one, the reverses other rows give it, each value with what the row it
 * names holds of people. Undefined for a tag no type has, or a row with no
 * note that nothing names.
 */
export function describeTagFields(index: WorkspaceIndex, tagKey: string, others: readonly OtherKey[] = []): DrawnFields | undefined {
  const types = getTypeIndex(index);
  const row = types.isEmpty ? undefined : types.rowOfTag(tagKey);
  if (!row) {
    return undefined;
  }
  if (row.filePath) {
    return describeRowFields(types, row, { others });
  }
  const fields = describeRowFields(types, row, { others: [], details: true });
  return fields.fields.length > 0 ? { ...fields, empty: [] } : undefined;
}

/** What drawing a row's fields takes besides the row. */
interface RowFieldOptions {
  /** The note's other keys, drawn after the fields. */
  others: readonly OtherKey[];
  /** Each written field's editor, on the Note page. */
  editor?: (field: RowField) => FieldEditor | undefined;
  /** Whether each value that names a row says what that row holds of people. */
  details?: boolean;
}

/** A row's fields, the empty ones apart, as a page draws them. */
function describeRowFields(types: TypeIndex, row: TypeRow, options: RowFieldOptions): DrawnFields {
  const type = types.registry.get(row.typeKey);
  const schemaKeys = new Set((type?.fields ?? []).map((field) => field.key));
  const all = types.fields(row.id);
  const draw = (field: RowField): DrawnField => {
    const tip = describeReverseTip(types, field);
    const edit = field.source === 'reverse' ? undefined : options.editor?.(field);
    return {
      name: field.name,
      source: field.source === 'computed' ? 'reverse' : field.source,
      ...(tip ? { tip } : {}),
      values: field.values.map((value) => drawValue(types, value, options.details === true)),
      ...(edit ? { edit } : {}),
    };
  };
  const others: DrawnField[] = options.others
    .filter((other) => !IDENTITY_KEYS.has(other.name.toLowerCase()) && !schemaKeys.has(other.name.toLowerCase()) && other.values.length > 0)
    .map((other) => ({ name: other.name, source: 'written', values: other.values }));
  return {
    typeName: type?.name ?? formatKeyWords(row.typeKey),
    typeQuery: `type = ${row.typeKey}`,
    fields: [...all.filter((field) => field.values.length > 0).map(draw), ...others],
    empty: all.filter((field) => field.values.length === 0 && field.field && field.source !== 'reverse').map(draw),
  };
}

/** One value as a page draws it: a row by its title and tag or note, a note by its title, else as written. */
function drawValue(types: TypeIndex, value: FieldValue, details: boolean): DrawnFieldValue {
  const reverse = value.via ? { reverse: true as const } : {};
  if (value.rowId) {
    return { ...drawRowValue(types, value, value.rowId, details), ...reverse };
  }
  if (value.notePath) {
    return { text: noteTitle(value.notePath), filePath: value.notePath, ...reverse };
  }
  if (value.checked !== undefined) {
    return { text: value.checked ? 'Yes' : 'No', ...reverse };
  }
  return { text: value.option ?? value.text, ...(value.unresolved ? { unresolved: true as const } : {}), ...reverse };
}

/**
 * A value that names a row: the row's title, with its tag to open, or its
 * note for a note row; a person no type has by the tag the value names;
 * and, when asked, what the row holds of people.
 */
function drawRowValue(types: TypeIndex, value: FieldValue, rowId: string, details: boolean): DrawnFieldValue {
  const row = types.row(rowId);
  const text = valueTitle(types, value);
  if (!row) {
    return /^[#@]/.test(rowId) ? { text, tag: { key: rowId, label: rowId } } : { text };
  }
  const tag = rowTag(row);
  const detail = details ? describeRowPeople(types, row) : undefined;
  return {
    text,
    ...(tag ? { tag } : {}),
    ...(!tag && row.filePath ? { filePath: row.filePath } : {}),
    ...(detail ? { detail } : {}),
  };
}

/**
 * What a row holds of people, as a path through it reads (`owned-by.lead`):
 * each person field with a value, by name and titles, the first few.
 */
function describeRowPeople(types: TypeIndex, row: TypeRow): string | undefined {
  const parts = types
    .fields(row.id)
    .filter((field) => field.kind.name === 'person' && field.source !== 'reverse' && field.values.length > 0)
    .slice(0, DETAIL_FIELD_LIMIT)
    .map((field) => `${field.name} ${field.values.map((value) => valueTitle(types, value)).join(', ')}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * What a reverse, or a field merged with one, is worked out from: each
 * type and field that gives it, `From each person's team`; for a merged
 * field, that it is written here too.
 */
function describeReverseTip(types: TypeIndex, field: RowField): string | undefined {
  const sources = new Set<string>();
  field.values.forEach(({ via }) => {
    if (!via) {
      return;
    }
    const typeName = types.typeOf(via.rowId)?.name ?? 'row';
    sources.add(`each ${typeName.toLowerCase()}'s ${via.field}`);
  });
  if (sources.size === 0) {
    return undefined;
  }
  const from = `From ${[...sources].join(' and ')}`;
  return field.source === 'merged' ? `Written here, and ${from.charAt(0).toLowerCase()}${from.slice(1)}` : from;
}

/** The list a relation's editor offers its rows from, one per kind of rows. */
function choicesKey(kind: FieldKind): string {
  return kind.name === 'person' ? 'people' : `rows:${[...(kind.targets ?? [])].sort().join(',')}${kind.people ? '+people' : ''}`;
}

/** How a schema field is edited, by its kind; undefined for one that is not the schema's. */
function describeEditor(field: RowField): FieldEditor | undefined {
  const schema = field.field;
  if (!schema) {
    return undefined;
  }
  const kind = schema.kind;
  const written = field.values.filter((value) => !value.via);
  const base = { key: schema.key, many: kind.many };
  switch (kind.name) {
    case 'person':
    case 'relation':
      return { ...base, input: 'rows', choices: choicesKey(kind), current: written.flatMap((value) => value.rowId ?? []) };
    case 'select':
      return kind.options?.length
        ? { ...base, input: 'options', options: [...kind.options], current: written.map((value) => value.option ?? value.text) }
        : { ...base, input: 'text', current: written.map((value) => value.text) };
    case 'date':
      return { ...base, input: 'date', current: written.map((value) => value.date ?? value.text) };
    case 'number':
      return { ...base, input: 'number', current: written.map((value) => value.text) };
    case 'checkbox':
      return { ...base, input: 'checkbox', current: written.map((value) => (value.checked ? 'true' : 'false')) };
    case 'note':
      return { ...base, input: 'note', current: written.map((value) => (value.notePath ? noteTitle(value.notePath) : value.text)) };
    case 'text':
    case 'link':
    case 'email':
    case 'phone':
      return { ...base, input: 'text', current: written.map((value) => value.text) };
  }
}

/** A field edit, planned: the key and what to write under it, and what the write is called; or why there is none. */
export type FieldWritePlan =
  | { key: string; write: FrontmatterFieldWrite; label: string; said: string }
  | { error: string };

/** A front-matter key a free field can have, as the parser reads one. */
const FREE_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * What an edit on the Note page writes, read against the index as it is
 * now: the note must be a typed row, and the key its type's field, or,
 * for typed text, a free key (Other…) other than the note's identity. A
 * row or option must be one the field's kind offers; a date is read as the
 * task editor reads one; a field that holds several adds a row or option
 * it does not hold and takes away one it does, its other values kept as
 * written.
 */
export function planNoteFieldWrite(
  index: WorkspaceIndex,
  request: { filePath: string; key: string; value: FieldEditValue },
  now: number,
): FieldWritePlan {
  const { filePath, key, value } = request;
  const types = getTypeIndex(index);
  const row = index.files.has(filePath) && !types.isEmpty ? findNoteRow(types, filePath) : undefined;
  if (!row) {
    return { error: `${noteTitle(filePath)} is not a row of any type, so Deckard did not change it.` };
  }
  const field = types.fields(row.id).find((candidate) => candidate.field && candidate.field.key === key.toLowerCase());
  const said = (what: string): { label: string; said: string } => ({ label: `${what} in "${row.title}"`, said: `${what} in "${row.title}".` });
  if (!field?.field) {
    if (value.kind === 'clear') {
      return { key, write: { values: [] }, ...said(`Cleared ${key}`) };
    }
    if (value.kind !== 'text' || !FREE_KEY.test(key) || IDENTITY_KEYS.has(key.toLowerCase())) {
      return { error: `${formatKeyWords(row.typeKey)} has no field ${key}, so Deckard did not change "${row.title}".` };
    }
    return { key, write: { values: [{ text: value.text.trim() }] }, ...said(`Set ${key}`) };
  }
  const schemaKey = field.field.key;
  if (value.kind === 'clear') {
    return { key: schemaKey, write: { values: [] }, ...said(`Cleared ${field.name}`) };
  }
  const planned = planValues({ types, index, now }, field, value);
  if ('error' in planned) {
    return planned;
  }
  return { key: schemaKey, write: { values: planned.values, list: field.kind.many }, ...said(planned.what) };
}

/** The values a field is written with after an edit, and what the edit did, in words; or why it cannot be. */
function planValues(
  { types, index, now }: { types: TypeIndex; index: WorkspaceIndex; now: number },
  field: RowField,
  value: Exclude<FieldEditValue, { kind: 'clear' }>,
): { values: FrontmatterWriteValue[]; what: string } | { error: string } {
  const kind = field.kind;
  const written = field.values.filter((each) => !each.via);
  switch (value.kind) {
    case 'row': {
      const choice = listKindRows(types, index, kind).find((each) => each.id === value.rowId);
      if (!choice) {
        return { error: `${field.name} cannot name ${value.rowId}.` };
      }
      return toggle(field, written, { text: choice.written.slice(1, -1), same: (each) => each.rowId === choice.id, title: choice.title });
    }
    case 'option': {
      const option = kind.name === 'select' ? readSelectValue(kind, value.option) : undefined;
      if (!option) {
        return { error: `${field.name} has no option "${value.option}".` };
      }
      return toggle(field, written, { text: option, same: (each) => (each.option ?? each.text).toLowerCase() === option.toLowerCase(), title: option });
    }
    case 'checkbox':
      if (kind.name !== 'checkbox') {
        return { error: `${field.name} is not a checkbox.` };
      }
      return { values: [{ text: value.checked ? 'true' : 'false', bare: true }], what: `${value.checked ? 'Checked' : 'Unchecked'} ${field.name}` };
    case 'text':
      return planText(field, value.text, now);
  }
}

/**
 * Typed text as a field of its kind writes it: a number, bare when it is
 * plain digits; a date, as `YYYY-MM-DD`; a note, as its link; several
 * values split at commas; anything else as typed.
 */
function planText(field: RowField, typed: string, now: number): { values: FrontmatterWriteValue[]; what: string } | { error: string } {
  const text = typed.trim();
  if (!text) {
    return { error: `Type a value for ${field.name}.` };
  }
  const set = (values: FrontmatterWriteValue[]) => ({ values, what: `Set ${field.name} to ${values.map((each) => each.text).join(', ')}` });
  switch (field.kind.name) {
    case 'person':
    case 'relation':
    case 'checkbox':
      return { error: `Choose ${field.name} from its list.` };
    case 'number':
      if (readNumberValue(text) === undefined) {
        return { error: `${field.name} is a number, and "${text}" is not one.` };
      }
      return set([{ text, ...(/^-?\d+(?:\.\d+)?$/.test(text) ? { bare: true } : {}) }]);
    case 'date': {
      const date = readDateValue(text, now);
      return date ? set([{ text: date }]) : { error: `${field.name} is a date, and "${text}" is not one.` };
    }
    case 'note': {
      const title = text.replace(/^\[\[|\]\]$/g, '').trim();
      return set([{ text: `[[${title}]]` }]);
    }
    case 'text':
    case 'select':
    case 'link':
    case 'email':
    case 'phone': {
      const values = field.kind.many ? text.split(',').map((each) => each.trim()).filter(Boolean) : [text];
      return set(values.map((each) => ({ text: each })));
    }
  }
}

/**
 * A row or option chosen for a field: its one value, or, for a field that
 * holds several, added to those written or taken away from them, the
 * others kept as written.
 */
function toggle(
  field: RowField,
  written: readonly FieldValue[],
  chosen: { text: string; same: (value: FieldValue) => boolean; title: string },
): { values: FrontmatterWriteValue[]; what: string } {
  if (!field.kind.many) {
    return { values: [{ text: chosen.text }], what: `Set ${field.name} to ${chosen.title}` };
  }
  if (written.some(chosen.same)) {
    const kept = written.filter((value) => !chosen.same(value));
    return { values: kept.map((value) => ({ text: value.text })), what: `Took ${chosen.title} out of ${field.name}` };
  }
  return {
    values: [...written.map((value) => ({ text: value.text })), { text: chosen.text }],
    what: `Added ${chosen.title} to ${field.name}`,
  };
}
