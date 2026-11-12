/**
 * A type's rows as a board (docs/implementation/46-boards-and-lanes.md § 1):
 * columns by one field's values, and, with lanes, rows of cells by a
 * second field's, each card a row. Nothing here knows any type: an
 * initiative is a type a reader writes, and the board works on any.
 *
 * - **The fields.** Group and Lanes offer what the table's Group by offers
 *   (D1): each select, person, and relation field of the schema, then each
 *   reverse, which other notes set.
 * - **The values** (D3). A select's options in the schema's order, empty
 *   ones too; a relation's rows, every row of the types it takes, by
 *   title; the people or values some row holds, by title, for a person
 *   field or a reverse. Then `No state`, when some row has none or a drop
 *   can write the field. A row with two values is a card in each.
 * - **A move** sets the fields its cell's column and lane stand for: a
 *   field that holds one value takes the new one; one that holds several
 *   swaps the value the card left for the one it entered (D4); `No …`
 *   takes the value out. A reverse takes no drop.
 *
 * The writes are `ui/commands/typeBoardMoves.ts`'s.
 */
import type { FieldKind, TypeField, TypeTableView } from '../../domain/model';
import type { FieldValue, TypeIndex, TypeRow } from '../../domain/types/typeIndex';
import type { TypeDefinition } from '../../domain/types/typeRegistry';
import type { TypeBoard, TypeBoardAxis, TypeBoardCard, TypeBoardValue, TypeTableColumn, TypeTableRow } from '../protocol/searchPage';
import { valueTitle, writeRowValue } from './typeRows';

/** How many details a card draws under its title. */
export const BOARD_CARD_DETAILS = 3;

/** The id of the column or lane of the rows with no value. */
export const NO_VALUE = 'none';

/** A field a type's rows can be grouped by, in the table or on the board. */
export interface GroupField {
  /** Its id: a schema field's key, or a reverse's query name. */
  id: string;
  /** Its name, as Group by lists it: `state`, `owned by`. */
  label: string;
  /** The name the type index reads it by: `field.<name>`, or the reverse's query name. */
  read: string;
  kind: FieldKind;
  /** The schema's field, which a drop writes; none for a reverse, which other notes set. */
  field?: TypeField;
}

/** One value of a row's field, as an axis of the board has it. */
export interface AxisValue {
  id: string;
  label: string;
  /** As Deckard writes it in the field. */
  written: string;
}

/**
 * The fields a type's rows can be grouped by: each select, person, and
 * relation field of the schema, in its order, then each reverse a row of
 * the type is named by, by its query name, as the table's columns list
 * them.
 */
export function listGroupFields(types: TypeIndex, type: TypeDefinition, rows: readonly TypeRow[]): GroupField[] {
  const fields: GroupField[] = type.fields
    .filter((field) => field.kind.name === 'select' || field.kind.name === 'person' || field.kind.name === 'relation')
    .map((field) => ({ id: field.key, label: field.name, read: `field.${field.name}`, kind: field.kind, field }));
  const taken = new Set(['title', ...type.fields.map((field) => field.key)]);
  (rows.length ? rows : types.rows(type.key)).forEach((row) => {
    types.fields(row.id).forEach((field) => {
      if (field.source !== 'reverse' || taken.has(field.queryName)) {
        return;
      }
      taken.add(field.queryName);
      fields.push({ id: field.queryName, label: field.name, read: field.queryName, kind: field.kind });
    });
  });
  return fields;
}

/**
 * One value as an axis has it: an option by the schema's spelling, a row
 * by its title, and anything else as written; undefined for an empty one.
 */
export function readAxisValue(types: TypeIndex, value: FieldValue): AxisValue | undefined {
  if (value.option) {
    return { id: `option:${value.option.toLowerCase()}`, label: value.option, written: value.option };
  }
  if (value.rowId) {
    const row = types.row(value.rowId);
    return { id: `row:${value.rowId}`, label: valueTitle(types, value), written: row ? writeRowValue(row).slice(1, -1) : value.rowId };
  }
  const text = value.text.trim();
  return text ? { id: `text:${text.toLowerCase()}`, label: text, written: text } : undefined;
}

/** A row's values of a field, each once, as an axis has them; none for a row that holds none. */
export function readRowAxisValues(types: TypeIndex, rowId: string, field: Pick<GroupField, 'read'>): AxisValue[] {
  const values = new Map<string, AxisValue>();
  (types.field(rowId, field.read)?.values ?? []).forEach((value) => {
    const read = readAxisValue(types, value);
    if (read && !values.has(read.id)) {
      values.set(read.id, read);
    }
  });
  return [...values.values()];
}

/** Two titles in the order a reader looks them up: by letter, any case. */
function byLabel(left: { label: string }, right: { label: string }): number {
  return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
}

/**
 * A field's values as the board's columns or lanes, in order (D3): a
 * select's options, then any other value in use; a relation's rows of the
 * types it takes and the values in use, by title; for a person field or a
 * reverse, the values in use, by title. `No <field>` last, when some row
 * has none or the field can be written. Each counts the rows that hold it.
 */
export function listAxisValues(types: TypeIndex, field: GroupField, held: readonly (readonly AxisValue[])[]): TypeBoardValue[] {
  const used = new Map<string, AxisValue>();
  held.flat().forEach((value) => {
    if (!used.has(value.id)) {
      used.set(value.id, value);
    }
  });
  let values: AxisValue[];
  if (field.field && field.kind.name === 'select') {
    const options = (field.kind.options ?? []).map((option) => ({ id: `option:${option.toLowerCase()}`, label: option, written: option }));
    values = [...options, ...[...used.values()].filter((value) => !options.some((option) => option.id === value.id)).sort(byLabel)];
  } else if (field.field && field.kind.name === 'relation') {
    const every = new Map<string, AxisValue>();
    (field.kind.targets ?? []).flatMap((target) => types.rows(target)).forEach((row) => {
      if (!row.implicit) {
        every.set(`row:${row.id}`, { id: `row:${row.id}`, label: row.title, written: writeRowValue(row).slice(1, -1) });
      }
    });
    used.forEach((value) => every.set(value.id, every.get(value.id) ?? value));
    values = [...every.values()].sort(byLabel);
  } else {
    values = [...used.values()].sort(byLabel);
  }
  const drawn: TypeBoardValue[] = values.map((value) => ({
    id: value.id,
    label: value.label,
    count: held.filter((each) => each.some((candidate) => candidate.id === value.id)).length,
    written: value.written,
  }));
  const none = held.filter((each) => each.length === 0).length;
  return none || field.field ? [...drawn, { id: NO_VALUE, label: `No ${field.label}`, count: none }] : drawn;
}

/**
 * The field a board's columns are by (D2): the one chosen for it; else
 * the table's Group by; else the first select field, else the first
 * person or relation field, else the first reverse. None for a type with
 * nothing to group by.
 */
export function chooseBoardGroup(fields: readonly GroupField[], view: TypeTableView | undefined): GroupField | undefined {
  const named = (id: string | undefined) => (id === undefined ? undefined : fields.find((field) => field.id === id));
  return named(view?.boardGroup)
    ?? named(view?.groupBy)
    ?? fields.find((field) => field.field && field.kind.name === 'select')
    ?? fields.find((field) => field.field)
    ?? fields[0];
}

/** The field a board's lanes are by: the one chosen for them, unless it is the columns'; else none (D2). */
export function chooseBoardLanes(fields: readonly GroupField[], group: GroupField, view: TypeTableView | undefined): GroupField | undefined {
  return view?.boardLanes === undefined || view.boardLanes === group.id ? undefined : fields.find((field) => field.id === view.boardLanes);
}

/** A row as the board draws it: the type index's, and the table's row, its cells in the columns' order. */
export interface BoardRow {
  source: TypeRow;
  drawn: TypeTableRow;
}

/**
 * The board of a type's rows, in their order: the columns by the field
 * chosen, the lanes by the second, and a card for each cell a row is in,
 * with up to three of the table's columns that hold something, leaving out
 * the title and the axes' own. Undefined for a type with no field to group by.
 */
export function createTypeBoard(
  types: TypeIndex,
  fields: readonly GroupField[],
  { rows, columns }: { rows: readonly BoardRow[]; columns: readonly TypeTableColumn[] },
  view: TypeTableView | undefined,
): TypeBoard | undefined {
  const group = chooseBoardGroup(fields, view);
  if (!group) {
    return undefined;
  }
  const lanes = chooseBoardLanes(fields, group, view);
  const groupHeld = rows.map((row) => readRowAxisValues(types, row.source.id, group));
  const laneHeld = lanes ? rows.map((row) => readRowAxisValues(types, row.source.id, lanes)) : undefined;
  const axes = [group, ...(lanes ? [lanes] : [])];
  const details = columns.flatMap((column, at) => (column.source === 'title' || axes.some((axis) => isAxisColumn(axis, column)) ? [] : [at]));
  const cards: TypeBoardCard[] = [];
  const idsOf = (held: readonly AxisValue[]): string[] => (held.length ? held.map((value) => value.id) : [NO_VALUE]);
  rows.forEach((row, at) => {
    const columnIds = idsOf(groupHeld[at]);
    const laneIds: Array<string | undefined> = laneHeld ? idsOf(laneHeld[at]) : [undefined];
    const drawnDetails = details
      .filter((index) => isWorthSaying(columns[index], row.drawn.cells[index]?.text))
      .slice(0, BOARD_CARD_DETAILS)
      .map((index) => ({ column: columns[index].id, label: columns[index].label, cell: row.drawn.cells[index] }));
    laneIds.forEach((lane) => {
      columnIds.forEach((column) => {
        cards.push({ rowId: row.drawn.id, column, ...(lane === undefined ? {} : { lane }), details: drawnDetails });
      });
    });
  });
  return {
    group: describeAxis(types, group, groupHeld),
    ...(lanes && laneHeld ? { lanes: describeAxis(types, lanes, laneHeld) } : {}),
    cards,
  };
}

/**
 * Whether a cell says something on a card: not empty, and not a computed
 * count of nothing, `Open tasks 0`, which a card has no room to say.
 */
function isWorthSaying(column: TypeTableColumn, text: string | undefined): boolean {
  return Boolean(text) && !(column.source === 'computed' && text === '0');
}

/** One axis of the board: its field, whether a drop writes it, and its values. */
function describeAxis(types: TypeIndex, field: GroupField, held: readonly (readonly AxisValue[])[]): TypeBoardAxis {
  return { field: field.id, name: field.label, writable: Boolean(field.field), values: listAxisValues(types, field, held) };
}

/** Whether a table's column is an axis's own field, which its column or lane already says. */
function isAxisColumn(axis: GroupField, column: TypeTableColumn): boolean {
  return column.id === axis.id || (axis.field !== undefined && column.id === `field.${axis.id}`);
}

/** A change a move makes to one field: the axis, its field's id, and the values it leaves and enters. */
export interface BoardFieldChange {
  axis: 'group' | 'lanes';
  field: string;
  from: TypeBoardValue;
  to: TypeBoardValue;
}

/** A cell of a type's board, by its column's and lane's value ids. */
export interface BoardCell {
  column: string;
  lane?: string;
}

/**
 * What moving a card from one cell to another changes: each axis whose
 * value differs, the column's first; or why it cannot, for an axis set by
 * other notes. Undefined when the board has no such card in the cell it
 * leaves, or no such cell to enter, as when the page was drawn from
 * another state.
 */
export function planTypeBoardMove(board: TypeBoard, rowId: string, from: BoardCell, to: BoardCell): { changes: BoardFieldChange[] } | { refused: string } | undefined {
  const card = board.cards.find((candidate) => candidate.rowId === rowId && candidate.column === from.column && candidate.lane === from.lane);
  const value = (axis: TypeBoardAxis | undefined, id: string | undefined) => (axis && id !== undefined ? axis.values.find((candidate) => candidate.id === id) : undefined);
  if (!card || !value(board.group, to.column) || (board.lanes ? !value(board.lanes, to.lane) : to.lane !== undefined)) {
    return undefined;
  }
  const changes: BoardFieldChange[] = [];
  const moves: Array<['group' | 'lanes', TypeBoardAxis | undefined, string | undefined, string | undefined]> = [
    ['group', board.group, from.column, to.column],
    ['lanes', board.lanes, from.lane, to.lane],
  ];
  for (const [axis, described, left, entered] of moves) {
    const leaves = value(described, left);
    const enters = value(described, entered);
    if (!described || !leaves || !enters || leaves.id === enters.id) {
      continue;
    }
    if (!described.writable) {
      return { refused: describeRefusal(described) };
    }
    changes.push({ axis, field: described.field, from: leaves, to: enters });
  }
  return { changes };
}

/** Why a card cannot go into another of an axis's values: the field is a reverse, set by other notes. */
export function describeRefusal(axis: Pick<TypeBoardAxis, 'name'>): string {
  return `${axis.name.charAt(0).toUpperCase()}${axis.name.slice(1)} is set by other notes.`;
}

/** One value a row's note writes for a field: as written, and the axis value it reads as, if any. */
export interface WrittenAxisValue {
  text: string;
  id?: string;
}

/**
 * What a field's values become when a card leaves `from` for `to`, from
 * what the row's note writes now: the new value alone, for a field that
 * holds one; for one that holds several, the rest kept, the one left
 * swapped for the one entered (D4); none for `No …`. `stale` when the note
 * does not hold the value the card left, as when another note sets it or
 * the note changed since the board was drawn.
 */
export function moveFieldValues(current: readonly WrittenAxisValue[], many: boolean, from: TypeBoardValue, to: TypeBoardValue): string[] | 'stale' {
  const holds = from.id === NO_VALUE ? current.length === 0 : current.some((value) => value.id === from.id);
  if (!holds) {
    return 'stale';
  }
  if (!many) {
    return to.written ? [to.written] : [];
  }
  const kept = current.filter((value) => value.id !== from.id).map((value) => value.text);
  return to.written && !current.some((value) => value.id === to.id) ? [...kept, to.written] : kept;
}

/** What a move says once written: `Moved Checkout v2 to Accepted.`, or to a column and a lane, `… to Accepted, Payments.` */
export function describeBoardMove(title: string, changes: readonly BoardFieldChange[]): string {
  return `Moved ${title} to ${changes.map((change) => change.to.label).join(', ')}.`;
}

/**
 * The values a new row starts with from a board's + : the column's value
 * of the columns' field, and the lane's of the lanes', each by its field's
 * key, when it can be written; none for `No …`.
 */
export function startValuesFor(board: TypeBoard, cell: Partial<BoardCell>): Record<string, string> {
  const values: Record<string, string> = {};
  const fill = (axis: TypeBoardAxis | undefined, id: string | undefined) => {
    const value = axis && axis.writable && id !== undefined ? axis.values.find((candidate) => candidate.id === id) : undefined;
    if (axis && value?.written) {
      values[axis.field] = value.written;
    }
  };
  fill(board.group, cell.column);
  fill(board.lanes, cell.lane);
  return values;
}
