/**
 * A type's rows as a search page's rows tab draws them
 * (docs/implementation/30-databases.md § Types as searches): one row per
 * row the search finds, its title first, then the columns the reader chose
 * of the schema's fields and what the notes compute, sorted by a column
 * and grouped by a field when asked.
 *
 * - A schema field's column is headed by its key as written; a computed
 *   one, a reverse among them, in sentence case ("Open tasks").
 * - A value that names a row or a note is a link by its title; several are
 *   joined with commas. A reverse that gives people lists the first three
 *   by first name, then how many more: "Dana, Sam, Lena +2".
 * - A date reads in words and in full, "today · 2026-10-08"; open tasks as
 *   "4 · 1 overdue".
 * - A namespace row with no hub note says so, with how many entries carry
 *   its tag, so the gap reads as one.
 */
import { noteTitle } from '../../domain/index/backlinks';
import { describeDistance } from '../../domain/markdown/dates';
import { formatDisplayDate, type DateFormats } from '../../domain/markdown/dateFormat';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import type { TypeTableView } from '../../domain/model';
import { rowNotesFolder, pluralTypeName } from '../../domain/types/rowNotes';
import type { FieldValue, RowField, TypeIndex, TypeRow } from '../../domain/types/typeIndex';
import type { TypeDefinition } from '../../domain/types/typeRegistry';
import type {
  SearchPageTypeRows,
  TypeTableCell,
  TypeTableColumn,
  TypeTableGroup,
  TypeTableRow,
  TypeTableValue,
} from '../protocol/searchPage';
import { rowTag } from './typeHover';
import { valueTitle } from './typeRows';

/** How many of a reverse's values a cell draws before `+2`. */
export const REVERSE_VALUE_LIMIT = 3;

/** The computed columns every type offers, in the order ⋯ lists them, with their headings. */
const COMPUTED_COLUMNS: ReadonlyArray<readonly [id: string, label: string]> = [
  ['open-tasks', 'Open tasks'],
  ['last-mentioned', 'Last mentioned'],
  ['mentions', 'Mentions'],
];

/** The computed columns a rows tab shows until asked for others, after every schema field. */
const DEFAULT_COMPUTED = ['open-tasks', 'last-mentioned'];

/** What a rows tab is drawn with besides the type and its rows. */
export interface TypeTableOptions {
  /** How many entries carry a tag, which a row with no hub note says. */
  entriesOf: (tagKey: string) => number;
  /** The moment dates are worded from. */
  now: number;
  dateFormats?: DateFormats;
  /** The reader's choices for this type: columns, sort, and grouping. */
  view?: TypeTableView;
}

/** A cell as the table sorts it, besides what it draws: a number, a day, or text; undefined when empty. */
type SortKey = number | string | undefined;

/** A row, its cells, and what each cell sorts by. */
interface BuiltRow {
  row: TypeTableRow;
  keys: SortKey[];
}

/**
 * A type's rows tab: the rows `rowIds` names that are the type's, in the
 * columns and order `options.view` asks for, grouped by its field when it
 * names one of the type's.
 */
export function createTypeTable(
  types: TypeIndex,
  type: TypeDefinition,
  rowIds: readonly string[],
  options: TypeTableOptions,
): SearchPageTypeRows {
  const plural = pluralTypeName(type.name);
  const rows = rowIds.flatMap((id) => {
    const row = types.row(id);
    return row && row.typeKey === type.key ? [row] : [];
  });
  const available = listTypeColumns(types, type, rows);
  const columns = chooseColumns(available, options.view?.columns);
  const built = rows.map((row) => buildRow(types, row, columns, options));
  const sort = readSort(options.view?.sort, columns);
  const ordered = sortRows(built, columns, sort);
  const groupFields = type.fields
    .filter((field) => field.kind.name === 'select' || field.kind.name === 'person' || field.kind.name === 'relation')
    .map((field) => ({ id: field.key, label: field.name }));
  const groupBy = groupFields.some((field) => field.id === options.view?.groupBy) ? options.view?.groupBy : undefined;
  return {
    key: type.key,
    name: type.name,
    plural,
    rule: describeRowsRule(type),
    filePath: type.filePath,
    rowsKind: type.rows?.kind === 'notes' ? 'notes' : 'tags',
    count: rows.length,
    columns,
    available,
    ...(sort ? { sort } : {}),
    rows: groupBy ? [] : ordered.map((each) => each.row),
    groupFields,
    ...(groupBy ? { groupBy, groups: groupRows(types, type, groupBy, ordered) } : {}),
  };
}

/**
 * What a type's rows are, as its page's subtitle says it: a namespace
 * type's `rows:` as written, `#team/*`; a note type's `type:` and the
 * folder its new rows go in, `type: incident · Incidents/`.
 */
export function describeRowsRule(type: TypeDefinition): string {
  if (type.rows?.kind === 'notes') {
    const folder = rowNotesFolder(type);
    return `type: ${type.key}${folder ? ` · ${folder}/` : ''}`;
  }
  return type.rows?.written ?? '';
}

/**
 * Every column a type's rows tab can show: the title, each schema field,
 * each reverse a row of the type is named by, then the computed fields
 * that mean something for its rows.
 */
export function listTypeColumns(types: TypeIndex, type: TypeDefinition, rows: readonly TypeRow[]): TypeTableColumn[] {
  const columns: TypeTableColumn[] = [{ id: 'title', label: type.name, source: 'title' }];
  const taken = new Set(['title']);
  type.fields.forEach((field) => {
    // A field a built-in name hides keeps its own column under field.<key>.
    const id = taken.has(field.key) || COMPUTED_COLUMNS.some(([computed]) => computed === field.key) ? `field.${field.key}` : field.key;
    taken.add(id);
    columns.push({ id, label: field.name, source: 'field', ...(field.kind.name === 'select' ? { select: true as const } : {}) });
  });
  const reverses = new Map<string, string>();
  (rows.length ? rows : types.rows(type.key)).forEach((row) => {
    types.fields(row.id).forEach((field) => {
      if (field.source === 'reverse' && !taken.has(field.queryName) && !reverses.has(field.queryName)) {
        reverses.set(field.queryName, field.name);
      }
    });
  });
  reverses.forEach((name, id) => {
    taken.add(id);
    columns.push({ id, label: sentenceCase(name), source: 'computed' });
  });
  COMPUTED_COLUMNS.forEach(([id, label]) => columns.push({ id, label, source: 'computed' }));
  if (type.rows?.kind === 'notes') {
    columns.push({ id: 'linked-from', label: 'Linked from', source: 'computed' });
  } else if (types.rows(type.key).some((row) => row.parentId)) {
    columns.push({ id: 'parent', label: 'Parent', source: 'computed' }, { id: 'children', label: 'Children', source: 'computed' });
  }
  return columns;
}

/**
 * The columns shown: the reader's, in their order, of those there are,
 * the title first; or every schema field, then Open tasks and Last
 * mentioned.
 */
function chooseColumns(available: readonly TypeTableColumn[], chosen: readonly string[] | undefined): TypeTableColumn[] {
  const byId = new Map(available.map((column) => [column.id, column]));
  const ids = chosen?.length
    ? ['title', ...chosen.filter((id) => id !== 'title')]
    : ['title', ...available.filter((column) => column.source === 'field').map((column) => column.id), ...DEFAULT_COMPUTED];
  return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
}

/** A stored sort, when it names a column shown. */
function readSort(
  sort: TypeTableView['sort'],
  columns: readonly TypeTableColumn[],
): SearchPageTypeRows['sort'] {
  return sort && columns.some((column) => column.id === sort.column) ? { column: sort.column, direction: sort.direction } : undefined;
}

/** One row as drawn: its title, link, note, hub, what its ⋯ copies, and its cells. */
function buildRow(types: TypeIndex, row: TypeRow, columns: readonly TypeTableColumn[], options: TypeTableOptions): BuiltRow {
  const tag = row.implicit ? undefined : rowTag(row);
  // A level no tag is written for has no tag to describe, and so no hub to offer.
  const noHub = row.tagKeys.length > 0 && !row.filePath;
  const copy = findCopyValue(types, row);
  const cells = columns.map((column) => buildCell(types, row, column, options));
  return {
    row: {
      id: row.id,
      title: row.title,
      ...(tag ? { tag } : {}),
      ...(row.filePath ? { filePath: row.filePath } : {}),
      ...(noHub ? { noHub: { entries: row.tagKeys.reduce((total, key) => total + options.entriesOf(key), 0) } } : {}),
      ...(copy ? { copy } : {}),
      cells: cells.map((cell) => cell.cell),
    },
    keys: cells.map((cell) => cell.key),
  };
}

/** The first email, else link or phone, a row holds, for its ⋯'s Copy. */
function findCopyValue(types: TypeIndex, row: TypeRow): TypeTableRow['copy'] {
  const fields = types.fields(row.id).filter((field) => field.source !== 'reverse' && field.values.length > 0);
  for (const kind of ['email', 'link', 'phone'] as const) {
    const field = fields.find((candidate) => candidate.kind.name === kind);
    if (field) {
      return { label: field.name, value: field.values[0].text };
    }
  }
  return undefined;
}

/** One cell, and what it sorts by. */
function buildCell(types: TypeIndex, row: TypeRow, column: TypeTableColumn, options: TypeTableOptions): { cell: TypeTableCell; key: SortKey } {
  if (column.source === 'title') {
    return { cell: { text: row.title }, key: row.title.toLocaleLowerCase() };
  }
  if (column.id === 'open-tasks') {
    const computed = types.computed(row.id, options.now);
    const count = String(computed.openTasks);
    return {
      cell: computed.overdue
        ? { text: `${count} · ${computed.overdue} overdue`, values: [{ text: count }], overdue: computed.overdue }
        : { text: count, values: [{ text: count }] },
      key: computed.openTasks,
    };
  }
  if (column.id === 'last-mentioned') {
    const at = types.computed(row.id, options.now).lastMentioned;
    return at === undefined ? { cell: { text: '' }, key: undefined } : { cell: { text: describeDay(at, options) }, key: at };
  }
  const name = column.source === 'field' ? fieldNameOf(types, row, column) : column.id;
  const field = types.field(row.id, name, options.now);
  return field ? drawField(types, field, options) : { cell: { text: '' }, key: undefined };
}

/** The name a schema field's column reads its field by: `field.<key>`, which reaches it whatever a built-in is called. */
function fieldNameOf(types: TypeIndex, row: TypeRow, column: TypeTableColumn): string {
  const key = column.id.startsWith('field.') ? column.id.slice('field.'.length) : column.id;
  const field = types.registry.get(row.typeKey)?.fields.find((candidate) => candidate.key === key);
  return `field.${field?.name ?? key}`;
}

/** A field's values as one cell, by its kind, and what the cell sorts by. */
function drawField(types: TypeIndex, field: RowField, options: TypeTableOptions): { cell: TypeTableCell; key: SortKey } {
  const values = field.values;
  if (values.length === 0) {
    return { cell: { text: '' }, key: undefined };
  }
  const plain = drawPlainField(field, options);
  if (plain) {
    return plain;
  }
  const drawn = values.map((value) => drawValue(types, value));
  const text = drawn.map((value) => value.text).join(', ');
  const key = text.toLocaleLowerCase();
  if (field.source !== 'reverse' || drawn.length <= REVERSE_VALUE_LIMIT + 1) {
    return { cell: { text, values: field.source === 'reverse' ? drawn.map(shortenPerson) : drawn }, key };
  }
  return {
    cell: { text, values: drawn.slice(0, REVERSE_VALUE_LIMIT).map(shortenPerson), more: drawn.length - REVERSE_VALUE_LIMIT },
    key,
  };
}

/** A number, date, or checkbox field's values as one cell's text, and what it sorts by; undefined for any other kind. */
function drawPlainField(field: RowField, options: TypeTableOptions): { cell: TypeTableCell; key: SortKey } | undefined {
  const values = field.values;
  const kind = field.kind.name;
  if (kind === 'number') {
    const text = values.map((value) => value.text).join(', ');
    return { cell: { text }, key: values[0].number ?? text.toLocaleLowerCase() };
  }
  if (kind === 'date') {
    const days = values.map((value) => (value.date ? Date.parse(`${value.date}T00:00:00`) : undefined));
    const text = values.map((value, at) => (days[at] === undefined ? value.text : describeDay(days[at] as number, options))).join(', ');
    return { cell: { text }, key: days[0] ?? text.toLocaleLowerCase() };
  }
  if (kind === 'checkbox') {
    const text = values.map(describeCheckbox).join(', ');
    return { cell: { text }, key: text.toLocaleLowerCase() };
  }
  return undefined;
}

/** A checkbox's value: Yes, No, or as written when it reads as neither. */
function describeCheckbox(value: FieldValue): string {
  if (value.checked === undefined) {
    return value.text;
  }
  return value.checked ? 'Yes' : 'No';
}

/** One value as a cell draws it: a row by its title and tag or note, a note by its title, an option as the schema spells it. */
function drawValue(types: TypeIndex, value: FieldValue): TypeTableValue {
  if (value.rowId) {
    const row = types.row(value.rowId);
    const tag = row && !row.implicit ? rowTag(row) : undefined;
    const text = valueTitle(types, value);
    if (tag) {
      return { text, tag };
    }
    const filePath = row?.filePath ?? value.notePath;
    if (filePath) {
      return { text, filePath };
    }
    return /^[#@]/.test(value.rowId) ? { text, tag: { key: value.rowId, label: value.rowId } } : { text };
  }
  if (value.notePath) {
    return { text: noteTitle(value.notePath), filePath: value.notePath };
  }
  if (value.option) {
    return { text: value.option, option: value.option };
  }
  return { text: value.text };
}

/** A person, in a reverse's short list, by first name when their title has more than one word. */
function shortenPerson(value: TypeTableValue): TypeTableValue {
  return value.tag?.key.startsWith('@') && /\s/.test(value.text.trim()) ? { ...value, text: value.text.trim().split(/\s+/)[0] } : value;
}

/**
 * The rows in the order asked for: by a column, a row with nothing in it
 * last either way, ties by title; else by title, A-Z.
 */
function sortRows(rows: readonly BuiltRow[], columns: readonly TypeTableColumn[], sort: SearchPageTypeRows['sort']): BuiltRow[] {
  const at = sort ? columns.findIndex((column) => column.id === sort.column) : 0;
  const sign = sort?.direction === 'desc' ? -1 : 1;
  const byTitle = (left: BuiltRow, right: BuiltRow): number =>
    left.row.title.localeCompare(right.row.title, undefined, { sensitivity: 'base' }) || left.row.id.localeCompare(right.row.id);
  return [...rows].sort((left, right) => {
    const a = left.keys[at];
    const b = right.keys[at];
    if (a === undefined || b === undefined) {
      return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0) || byTitle(left, right);
    }
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
    return sign * compared || byTitle(left, right);
  });
}

/**
 * The rows grouped by one field's values: each value a group, a row with
 * two values in both, in the select's order or by title; the rows with
 * none last, as "No team".
 */
function groupRows(types: TypeIndex, type: TypeDefinition, key: string, rows: readonly BuiltRow[]): TypeTableGroup[] {
  const field = type.fields.find((candidate) => candidate.key === key);
  if (!field) {
    return [];
  }
  const groups = new Map<string, { label: string; rows: TypeTableRow[] }>();
  const none: TypeTableRow[] = [];
  rows.forEach(({ row }) => {
    const values = types.field(row.id, `field.${field.name}`)?.values ?? [];
    const keys = new Map<string, string>();
    values.forEach((value) => {
      const label = value.option ?? valueTitle(types, value);
      keys.set(value.option?.toLowerCase() ?? value.rowId ?? value.text.toLowerCase(), label);
    });
    if (keys.size === 0) {
      none.push(row);
    }
    keys.forEach((label, groupKey) => {
      const group = groups.get(groupKey);
      if (group) {
        group.rows.push(row);
      } else {
        groups.set(groupKey, { label, rows: [row] });
      }
    });
  });
  const options = (field.kind.options ?? []).map((option) => option.toLowerCase());
  const order = (groupKey: string): number => {
    const at = options.indexOf(groupKey);
    return at < 0 ? options.length : at;
  };
  const ordered = [...groups.entries()]
    .sort(([left, a], [right, b]) => order(left) - order(right) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    .map(([, group]) => group);
  return none.length ? [...ordered, { label: `No ${field.name}`, rows: none }] : ordered;
}

/** A day in words and in full, `today · 2026-10-08`, or the full date alone beyond a month. */
function describeDay(at: number, options: TypeTableOptions): string {
  const date = formatDisplayDate(at, options.dateFormats);
  const words = describeDistance(at, options.now);
  return words ? `${words} · ${date}` : date;
}

/** A name in sentence case: `lead of` reads `Lead of`. */
function sentenceCase(name: string): string {
  const words = name.includes(' ') ? name : formatKeyWords(name).toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
