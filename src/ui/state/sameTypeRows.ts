/**
 * The other rows of a typed note's type that share a relation's value with
 * it, as Context lists them under Related notes
 * (docs/implementation/32-same-type-in-context.md).
 *
 * - One group for each value the note's row holds in a relation field (a
 *   person, a row of another type, a note), in the schema's order, then for
 *   each value of its reverses: the other rows of the type whose same field
 *   holds that value. A row can be in several groups; an empty group is left
 *   out.
 * - Each group's search finds every row of the type with the value, the
 *   note's own among them: `type = person AND team = #team/payments`.
 * - Each row is listed with one fact, its parked rows last, eight to a
 *   group, and how many more there are.
 * - Sharing nothing, the section says what it compared by; a type with no
 *   relation fields has no section.
 */
import { noteTitle } from '../../domain/index/backlinks';
import { isParkedFile, isParkedOnlyTag, parkedLast } from '../../domain/index/parked';
import type { WorkspaceIndex } from '../../domain/model';
import { formatFieldCondition } from '../../domain/query/queryFormat';
import { isRowKind } from '../../domain/types/fieldKinds';
import { pluralTypeName } from '../../domain/types/rowNotes';
import { getTypeIndex, type FieldValue, type RowField, type TypeIndex, type TypeRow } from '../../domain/types/typeIndex';
import { listTypeQueryFields, type TypeQueryField } from '../../domain/types/typeQueryFields';
import type { SameTypeGroup, SameTypeRow, SameTypeRows } from '../protocol/sidebarNotes';
import { describeReverseTip, findNoteRow } from './noteFields';
import { findRowSummary, rowTag } from './typeHover';
import { valueTitle } from './typeRows';

/** How many rows a group lists before `+N more`. */
export const SAME_TYPE_GROUP_LIMIT = 8;

/** How many of the type's relation fields the line for nothing shared names. */
const EMPTY_FIELD_LIMIT = 3;

/** A group before it is cut to its limit: every row that shares its value. */
interface FullGroup {
  group: Omit<SameTypeGroup, 'rows' | 'more'>;
  rows: TypeRow[];
}

/**
 * The other rows of the note's type that share a value with it, or
 * undefined when the note is no typed row, or its type has no relation
 * field to compare by. A note that holds several rows is read as its first
 * by type key, as the Note page reads it.
 */
export function describeSameTypeRows(index: WorkspaceIndex, filePath: string): SameTypeRows | undefined {
  const types = getTypeIndex(index);
  const row = types.isEmpty ? undefined : findNoteRow(types, filePath);
  const type = row ? types.registry.get(row.typeKey) : undefined;
  if (!row || !type) {
    return undefined;
  }
  const queryFields = listTypeQueryFields(types.registry, type.key).filter((field) => field.source !== 'computed' && isRowKind(field.kind));
  if (queryFields.length === 0) {
    return undefined;
  }
  const groups = listFullGroups(types, row, queryFields);
  const typeQuery = `type = ${type.key}`;
  const counted = new Set(groups.flatMap((full) => full.rows.map((other) => other.id)));
  const section: SameTypeRows = {
    typeKey: type.key,
    plural: pluralTypeName(type.name).toLowerCase(),
    query: typeQuery,
    count: counted.size,
    groups: groups.map((full) => limitGroup(index, types, full)),
  };
  return groups.length > 0
    ? section
    : { ...section, empty: describeNothingShared(type.name.toLowerCase(), queryFields.map((field) => field.label)) };
}

/**
 * Every group with a row in it: for each relation field of the row, and
 * then each reverse, each value it holds, with the other rows of the type
 * whose same field holds it, by title.
 */
function listFullGroups(types: TypeIndex, row: TypeRow, queryFields: readonly TypeQueryField[]): FullGroup[] {
  const others = types.rows(row.typeKey).filter((other) => other.id !== row.id);
  const fields = types.fields(row.id).filter((field) => field.source !== 'computed' && isRowKind(field.kind));
  const ordered = [...fields.filter((field) => field.source !== 'reverse'), ...fields.filter((field) => field.source === 'reverse')];
  const typeQuery = `type = ${row.typeKey}`;
  return ordered.flatMap((field) => {
    const queryName = findQueryName(field, queryFields);
    const reverse = field.source === 'reverse';
    const tip = reverse ? describeReverseTip(types, field) : undefined;
    const seen = new Set<string>();
    return field.values.flatMap((value): FullGroup[] => {
      const key = valueKey(value);
      if (!key || seen.has(key)) {
        return [];
      }
      seen.add(key);
      const sharing = others
        .filter((other) => types.fields(other.id).some((candidate) => candidate.queryName === field.queryName && candidate.values.some((each) => valueKey(each) === key)))
        .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id));
      if (sharing.length === 0) {
        return [];
      }
      const written = queryName ? writeQueryValue(types, value) : undefined;
      return [{
        group: {
          id: `${field.queryName}=${key}`,
          field: field.name,
          ...(reverse ? { reverse: true as const } : {}),
          ...(tip ? { tip } : {}),
          value: valueTitle(types, value),
          ...(queryName && written ? { query: `${typeQuery} AND ${formatFieldCondition({ name: queryName, operator: 'eq', values: [written] })}` } : {}),
        },
        rows: sharing,
      }];
    });
  });
}

/** A group as the section lists it: the rows not parked first, then the parked, the first eight, and how many more. */
function limitGroup(index: WorkspaceIndex, types: TypeIndex, full: FullGroup): SameTypeGroup {
  const drawn = parkedLast(full.rows.map((other) => drawRow(index, types, other, full.group.field)), (other) => other.parked === true);
  return {
    ...full.group,
    rows: drawn.slice(0, SAME_TYPE_GROUP_LIMIT),
    more: Math.max(0, drawn.length - SAME_TYPE_GROUP_LIMIT),
  };
}

/**
 * One other row: its title; what opens it, its note or else its tag; and
 * one fact: what its hover leads with, that it has no hub note, or its
 * first relation besides the group's.
 */
function drawRow(index: WorkspaceIndex, types: TypeIndex, row: TypeRow, groupField: string): SameTypeRow {
  const tag = row.implicit ? undefined : rowTag(row);
  const detail = row.filePath ? (findRowSummary(types, row.id) ?? describeOtherRelation(types, row, groupField)) : 'No hub note';
  const parked = row.filePath ? isParkedFile(index, row.filePath) : row.tagKeys.length > 0 && row.tagKeys.every((key) => isParkedOnlyTag(index, key));
  return {
    id: row.id,
    title: row.title,
    ...(detail ? { detail } : {}),
    ...(row.filePath ? { filePath: row.filePath } : {}),
    ...(!row.filePath && tag ? { tagKey: tag.key } : {}),
    ...(parked ? { parked: true as const } : {}),
  };
}

/** A row's first written relation other than the group's, `manager Alex Rivera`. */
function describeOtherRelation(types: TypeIndex, row: TypeRow, groupField: string): string | undefined {
  const field = types
    .fields(row.id)
    .find((candidate) => candidate.source !== 'reverse' && candidate.name !== groupField && isRowKind(candidate.kind) && candidate.values.some((value) => !value.via));
  return field ? `${field.name} ${field.values.filter((value) => !value.via).map((value) => valueTitle(types, value)).join(', ')}` : undefined;
}

/** What a value is compared by: the row it names, else the note; undefined for text that names neither. */
function valueKey(value: FieldValue): string | undefined {
  if (value.rowId) {
    return value.rowId;
  }
  return value.notePath ? `note:${value.notePath}` : undefined;
}

/**
 * The name a query reaches a field by: a schema field's, `field.<name>`
 * when a built-in takes its name; a reverse's query name, or none when a
 * built-in takes it.
 */
function findQueryName(field: RowField, queryFields: readonly TypeQueryField[]): string | undefined {
  const schema = field.field;
  const found = schema
    ? queryFields.find((candidate) => candidate.source === 'field' && candidate.label === schema.name)
    : queryFields.find((candidate) => candidate.source === 'reverse' && candidate.name === field.queryName);
  return found?.name;
}

/**
 * A value as a search writes it, so it resolves to the row or note it is:
 * a tag row by its tag, `@dana` or `#team/payments`; a note row or a note
 * by its title, quoted when it has to be.
 */
function writeQueryValue(types: TypeIndex, value: FieldValue): string | undefined {
  if (value.rowId) {
    const row = types.row(value.rowId);
    if (!row) {
      return /^[#@]/.test(value.rowId) ? value.rowId : undefined;
    }
    const tag = rowTag(row);
    return tag ? tag.label : row.title;
  }
  return value.notePath ? noteTitle(value.notePath) : undefined;
}

/** `No other person shares a team, manager, or project.`: the type's first three relation fields. */
function describeNothingShared(singular: string, fieldNames: readonly string[]): string {
  const names = [...new Set(fieldNames)].slice(0, EMPTY_FIELD_LIMIT);
  return `No other ${singular} shares ${withArticle(listWithOr(names))}.`;
}

/** Words joined as a sentence lists them: `team`, `team or manager`, `team, manager, or project`. */
function listWithOr(words: readonly string[]): string {
  if (words.length <= 2) {
    return words.join(' or ');
  }
  return `${words.slice(0, -1).join(', ')}, or ${words[words.length - 1]}`;
}

/** A phrase after `a`, or `an` before a vowel: `an owner`. */
function withArticle(phrase: string): string {
  return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}
