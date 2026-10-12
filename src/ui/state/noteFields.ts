/**
 * A typed row's fields as the Note page and a tag's page draw them
 * (docs/implementation/30-databases.md § Surfaces 5 and 6).
 *
 * - The row's own fields come first: those that hold something, in the
 *   schema's order, then the note's other front-matter keys, its identity
 *   (`describes:`, `type:`) aside. Then the reverses other rows' relations
 *   give the row, which the page draws under "From other notes", each
 *   saying where it is set: "Set in each person's manager", "Set in
 *   Payments' lead" (docs/implementation/33-clearer-fields.md).
 * - Each schema field the note writes carries its key, which its name opens
 *   the form on; the pages edit nothing in place
 *   (docs/implementation/34-edit-fields-form.md).
 * - On a tag's page with no hub note, the reverses alone, each value
 *   naming what the row it names holds of people other than this one
 *   (`on-call Sam Ortiz`), so a row with no note still shows who owns it.
 */
import { noteTitle } from '../../domain/index/backlinks';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import type { WorkspaceIndex } from '../../domain/model';
import { getTypeIndex, type FieldValue, type RowField, type TypeIndex, type TypeRow } from '../../domain/types/typeIndex';
import type { DrawnField, DrawnFields, DrawnFieldValue, FieldSource } from '../protocol/fields';
import { rowTag } from './typeHover';
import { valueTitle } from './typeRows';

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
 * The Note page's fields for a note that is a typed row, each its type
 * defines with its key; undefined for a note no type has. `others` are the
 * note's other front-matter keys, as the page reads them.
 */
export function describeNoteFields(index: WorkspaceIndex, filePath: string, others: readonly OtherKey[]): DrawnFields | undefined {
  const types = getTypeIndex(index);
  const row = types.isEmpty ? undefined : findNoteRow(types, filePath);
  return row ? describeRowFields(types, row, { others }) : undefined;
}

/**
 * A tag's page's fields for its typed row: with its hub note, the hub's
 * fields and other keys, as the Note page draws them; without one, the
 * reverses other rows give it, each value with what the row it names holds
 * of people. Undefined for a tag no type has, or a row with no note whose
 * type has no fields and that nothing names.
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
  const typeFields = types.registry.get(row.typeKey)?.fields ?? [];
  return typeFields.length > 0 || fields.fields.length > 0 ? fields : undefined;
}

/** What drawing a row's fields takes besides the row. */
interface RowFieldOptions {
  /** The note's other keys, drawn after the fields. */
  others: readonly OtherKey[];
  /** Whether each value that names a row says what that row holds of people. */
  details?: boolean;
}

/**
 * A row's fields as a page draws them: its own that hold something, each
 * the schema defines with its key, then the note's other keys, then the
 * reverses, each saying where it is set.
 */
function describeRowFields(types: TypeIndex, row: TypeRow, options: RowFieldOptions): DrawnFields {
  const type = types.registry.get(row.typeKey);
  const schemaKeys = new Set((type?.fields ?? []).map((field) => field.key));
  const all = types.fields(row.id);
  const draw = (field: RowField): DrawnField => {
    const tip = describeReverseTip(types, field);
    const from = describeFieldSources(types, field);
    const key = field.field && !isReverse(field) ? field.field.key : undefined;
    return {
      name: field.name,
      ...(key ? { key } : {}),
      source: field.source === 'computed' ? 'reverse' : field.source,
      ...(tip ? { tip } : {}),
      ...(from.length > 0 ? { from } : {}),
      values: field.values.map((value) => drawValue(types, value, options.details ? row.id : undefined)),
    };
  };
  const others: DrawnField[] = options.others
    .filter((other) => !IDENTITY_KEYS.has(other.name.toLowerCase()) && !schemaKeys.has(other.name.toLowerCase()) && other.values.length > 0)
    .map((other) => ({ name: other.name, source: 'written', values: other.values }));
  const filled = all.filter((field) => field.values.length > 0);
  return {
    typeName: type?.name ?? formatKeyWords(row.typeKey),
    typeQuery: `type = ${row.typeKey}`,
    fields: [...filled.filter((field) => !isReverse(field)).map(draw), ...others, ...filled.filter(isReverse).map(draw)],
  };
}

/** Whether a field is worked out from other rows rather than written in the row's note. */
function isReverse(field: RowField): boolean {
  return field.source === 'reverse' || field.source === 'computed';
}

/**
 * One value as a page draws it: a row by its title and tag or note, a note
 * by its title, else as written. With `detailsFor`, a row's value says
 * what that row holds of people other than the row `detailsFor` names.
 */
function drawValue(types: TypeIndex, value: FieldValue, detailsFor: string | undefined): DrawnFieldValue {
  const reverse = value.via ? { reverse: true as const } : {};
  if (value.rowId) {
    return { ...drawRowValue(types, value, value.rowId, detailsFor), ...reverse };
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
 * and, when asked, what the row holds of people besides the row the page
 * is about.
 */
function drawRowValue(types: TypeIndex, value: FieldValue, rowId: string, detailsFor: string | undefined): DrawnFieldValue {
  const row = types.row(rowId);
  const text = valueTitle(types, value);
  if (!row) {
    return /^[#@]/.test(rowId) ? { text, tag: { key: rowId, label: rowId } } : { text };
  }
  const tag = rowTag(row);
  const detail = detailsFor === undefined ? undefined : describeRowPeople(types, row, detailsFor);
  return {
    text,
    ...(tag ? { tag } : {}),
    ...(!tag && row.filePath ? { filePath: row.filePath } : {}),
    ...(detail ? { detail } : {}),
  };
}

/**
 * What a row holds of people, as a path through it reads (`owned-by.lead`):
 * each person field with a value, by name and titles, the first few. The
 * row the page is about, `self`, is left out, as the row it names already
 * says it: a field that names only it is dropped, and one that names it
 * among others names the others, `also decided-by Theo Park`.
 */
function describeRowPeople(types: TypeIndex, row: TypeRow, self?: string): string | undefined {
  const parts = types
    .fields(row.id)
    .filter((field) => field.kind.name === 'person' && field.source !== 'reverse' && field.values.length > 0)
    .flatMap((field) => {
      const others = field.values.filter((value) => self === undefined || value.rowId !== self);
      if (others.length === 0) {
        return [];
      }
      const names = `${field.name} ${others.map((value) => valueTitle(types, value)).join(', ')}`;
      return [others.length < field.values.length ? `also ${names}` : names];
    })
    .slice(0, DETAIL_FIELD_LIMIT);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Where a reverse, or a field merged with one, is set: each type and field
 * that gives it, by the one row that does, `Payments'` `lead`, or by its
 * type when several do, `each person's` `manager`.
 */
export function describeFieldSources(types: TypeIndex, field: RowField): FieldSource[] {
  const groups = new Map<string, { typeName: string; field: string; rows: Set<string> }>();
  field.values.forEach(({ via }) => {
    if (!via) {
      return;
    }
    const type = types.typeOf(via.rowId);
    const key = `${type?.key ?? ''}\u0000${via.field}`;
    const group = groups.get(key) ?? { typeName: type?.name ?? 'row', field: via.field, rows: new Set<string>() };
    group.rows.add(via.rowId);
    groups.set(key, group);
  });
  return [...groups.values()].map((group) => {
    const only = group.rows.size === 1 ? types.row([...group.rows][0]) : undefined;
    return { owner: only ? possessive(only.title) : `each ${group.typeName.toLowerCase()}'s`, field: group.field };
  });
}

/** A title as owning something: `Payments'`, `Theo Park's`. */
function possessive(title: string): string {
  return /s$/i.test(title) ? `${title}'` : `${title}'s`;
}

/**
 * What a reverse, or a field merged with one, is worked out from: each
 * type and field that gives it, `From each person's team`; for a merged
 * field, that it is written here too.
 */
export function describeReverseTip(types: TypeIndex, field: RowField): string | undefined {
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
