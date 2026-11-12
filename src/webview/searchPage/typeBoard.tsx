/**
 * A type's rows as a board (docs/implementation/46-boards-and-lanes.md § 1):
 * Table | Board beside the rows tab's sort note, and on Board, Group and
 * Lanes over the shared lane grid (shared/lanes.tsx), each card a row. The
 * host made the columns, lanes, and cards; the page draws them, carries a
 * card to another cell, and lists the same moves in its ⋯.
 *
 * Zen hides the view switch, Group, and Lanes with the rows' other
 * controls; the cards, counts, and lane names stay drawn, and a card's ⋯
 * waits for the pointer or focus on its card, as a table row's does.
 */
import type { SearchPageTypeRows, TypeBoard, TypeBoardAxis, TypeBoardCard, TypeTableRow } from '../../ui/protocol/searchPage';
import { IconButton } from '../shared/buttons';
import { LaneGrid, laneCardAttributes, type LaneCell, type LaneHead } from '../shared/lanes';
import { EllipsisIcon } from '../shared/strokeIcons';
import type { ContextMenuEntry } from '../shared/tagMenu';
import { CellBody, findTypeRow, typeNoteName } from './typeRows';

/** What a cell of an axis set by other notes says while a card is held over it. */
export const SET_BY_OTHER_NOTES = 'Set by other notes';

/** The menu row that moves a card to a column's value, or to a lane's. */
export const MOVE_TO_COLUMN = 'type-move-column:';
export const MOVE_TO_LANE = 'type-move-lane:';

/**
 * Table | Board, beside the rows tab's sort note: the rows as a table, or
 * as cards in columns by a field. Zen quiets it with the tab's other tools.
 */
export function TypeViewSwitch({ table }: { readonly table: SearchPageTypeRows }) {
  return (
    <div class="segmented type-view" role="group" aria-label={`${table.plural} as`} data-zen-reveal="">
      {([['table', 'Table', `${table.plural} as rows, with the columns you choose`], ['board', 'Board', `${table.plural} as cards in columns by a field`]] as const).map(([value, label, tip]) => {
        const active = table.view === value;
        return <button key={value} type="button" class={active ? 'active' : undefined} data-action="set-type-view" data-value={value} aria-pressed={active} data-tip={tip}>{label}</button>;
      })}
    </div>
  );
}

/** The key of the card at `index` of the board's cards, which finds it on the page. */
function cardKeyAt(index: number): string {
  return `card-${index}`;
}

/** An axis's value by its id. */
function valueOf(axis: TypeBoardAxis | undefined, id: string | undefined) {
  return axis && id !== undefined ? axis.values.find((value) => value.id === id) : undefined;
}

/** A card's title: the link that opens its row, its tag's page or its note, as the table's title does. */
function CardTitle({ row }: { readonly row: TypeTableRow }) {
  if (row.tag) {
    return <button type="button" class="field-link" data-action="open-tag" data-tag-key={row.tag.key} data-tip={`Open ${row.tag.label}`}>{row.title}</button>;
  }
  if (row.filePath) {
    return <button type="button" class="field-link" data-action="open-source" data-file-path={row.filePath} data-line="1" data-tip={`Open ${row.title}`}>{row.title}</button>;
  }
  return <>{row.title}</>;
}

/** Under a card's title: what it lacks and the offer of a hub note, or up to three of its columns as `label value`. */
function CardDetails({ table, row, card }: { readonly table: SearchPageTypeRows; readonly row: TypeTableRow; readonly card: TypeBoardCard }) {
  if (row.noHub) {
    return (
      <p class="source board-details type-no-hub">
        <span>{`No hub note · ${row.noHub.entries} ${row.noHub.entries === 1 ? 'entry' : 'entries'}`}</span>
        <button type="button" class="type-create-hub" data-action="create-row-hub" data-row-id={row.id} data-tip={`Create a note whose describes: front matter names ${row.tag ? row.tag.label : row.title}`} data-reveal="">Create hub note</button>
      </p>
    );
  }
  if (!card.details.length) {
    return null;
  }
  return (
    <p class="source board-details type-card-details">
      {card.details.map((detail) => {
        const column = table.columns.find((candidate) => candidate.id === detail.column);
        return (
          <span key={detail.column} class="type-card-detail">
            <span class={column?.source === 'field' ? 'type-card-key is-field' : 'type-card-key'}>{detail.label}</span>
            {' '}
            {column ? <CellBody cell={detail.cell} column={column} /> : detail.cell.text}
          </span>
        );
      })}
    </p>
  );
}

/** One card: a row in one cell, its title, its details, and its ⋯. */
function BoardCard({ table, board, card, index }: { readonly table: SearchPageTypeRows; readonly board: TypeBoard; readonly card: TypeBoardCard; readonly index: number }) {
  const row = findTypeRow(table, card.rowId);
  if (!row) {
    return null;
  }
  const where = [valueOf(board.group, card.column)?.label, valueOf(board.lanes, card.lane)?.label].filter(Boolean).join(', ');
  return (
    <article
      role="listitem"
      class="task board-card type-card"
      tabIndex={0}
      data-tip-around=""
      data-reveal-region=""
      data-row-id={row.id}
      aria-label={`${row.title}, ${where}`}
      {...laneCardAttributes(cardKeyAt(index), row.id)}
    >
      <div class="task-summary">
        <div class="task-title type-card-title"><CardTitle row={row} /></div>
        <CardDetails table={table} row={row} card={card} />
        <IconButton
          action="type-card-menu"
          className="board-move"
          label={`More for ${row.title}: open, move to another column${board.lanes ? ' or lane' : ''}`}
          tip={`More for ${row.title}`}
          icon={<EllipsisIcon />}
          attributes={{ 'data-row-id': row.id, 'aria-haspopup': 'menu', 'data-reveal': '' }}
        />
      </div>
    </article>
  );
}

/**
 * One axis's values as the grid's heads, each with its + when the axis can
 * be written: a new row with its value, or, for No …, with none. A reverse
 * is set by other notes, so its heads have no +.
 */
function headsOf(table: SearchPageTypeRows, axis: TypeBoardAxis, lane: boolean): LaneHead[] {
  const name = table.name.toLowerCase();
  const article = /^[aeiou]/.test(name) ? 'an' : 'a';
  return axis.values.map((value) => ({
    id: value.id,
    label: value.label,
    count: value.count,
    ...(axis.writable ? { add: `Add ${article} ${name}${value.written ? ` to ${lane ? 'lane ' : ''}${value.label}` : ` with no ${axis.name}`}` } : {}),
    ...(value.id === 'none' ? { className: 'is-none' } : {}),
  }));
}

/**
 * Group and Lanes over the board: the field the columns are by, and the
 * one the lanes are by, or None. Each offers the table's Group by fields,
 * Lanes all but the one Group uses.
 */
function BoardAxes({ table, board }: { readonly table: SearchPageTypeRows; readonly board: TypeBoard }) {
  const lanes = board.lanes?.field ?? '';
  return (
    <div class="type-board-bar" data-zen-region="">
      <label class="control-label" data-zen-reveal="">
        Group:
        <select data-action="set-type-board-group" aria-label={`Columns of ${table.plural.toLowerCase()} by`} data-tip="The field whose values are the columns">
          {table.groupFields.map((field) => <option key={field.id} value={field.id} selected={field.id === board.group.field}>{field.label}</option>)}
        </select>
      </label>
      <label class="control-label" data-zen-reveal="">
        Lanes:
        <select data-action="set-type-board-lanes" aria-label={`Lanes of ${table.plural.toLowerCase()} by`} data-tip="A second field, whose values are rows of cells across the columns">
          <option value="" selected={lanes === ''}>None</option>
          {table.groupFields
            .filter((field) => field.id !== board.group.field)
            .map((field) => <option key={field.id} value={field.id} selected={field.id === lanes}>{field.label}</option>)}
        </select>
      </label>
    </div>
  );
}

/**
 * The rows tab on Board: Group and Lanes, then the grid of cards; or, for
 * a type with no field to group by, what a board needs and the way to add
 * one.
 */
export function TypeBoardView({ table }: { readonly table: SearchPageTypeRows }) {
  const board = table.board;
  if (!board) {
    return (
      <div class="empty type-board-none">
        {`A board groups by a select, person, or relation field, and ${table.name} has none. `}
        <button type="button" data-action="open-type-note" data-tip={`Open ${typeNoteName(table)} at its fields`}>Add a field…</button>
      </div>
    );
  }
  const indexed = board.cards.map((card, index) => ({ card, index }));
  const inCell = (cell: LaneCell) => indexed.filter(({ card }) => card.column === cell.column && card.lane === cell.lane);
  return (
    <div class="type-board">
      <BoardAxes table={table} board={board} />
      <LaneGrid
        grid={`type:${table.key}`}
        label={`${table.plural} by ${board.group.name}${board.lanes ? ` and ${board.lanes.name}` : ''}`}
        className="type-board-grid"
        columns={headsOf(table, board.group, false)}
        {...(board.lanes ? { lanes: headsOf(table, board.lanes, true) } : {})}
        cardsIn={inCell}
        cardKey={({ index }) => cardKeyAt(index)}
        renderCard={({ card, index }) => <BoardCard table={table} board={board} card={card} index={index} />}
        addAction="add-type-row"
      />
    </div>
  );
}

/**
 * Why a card cannot go from one cell to another: an axis whose value
 * would change is set by other notes. Undefined when it can.
 */
export function boardRefusal(board: TypeBoard, from: LaneCell, to: LaneCell): string | undefined {
  const columnMoves = from.column !== to.column && !board.group.writable;
  const laneMoves = from.lane !== to.lane && board.lanes !== undefined && !board.lanes.writable;
  return columnMoves || laneMoves ? SET_BY_OTHER_NOTES : undefined;
}

/**
 * The moves a card's ⋯ lists after the row's own: Move to each other
 * value of the columns' field, then Move to lane each other value of the
 * lanes', for a field a move can write.
 */
export function cardMoves(board: TypeBoard, cell: LaneCell): ContextMenuEntry[] {
  const columns = board.group.writable
    ? board.group.values.filter((value) => value.id !== cell.column).map((value) => ({ action: `${MOVE_TO_COLUMN}${value.id}`, label: `Move to ${value.label}` }))
    : [];
  const lanes = board.lanes?.writable
    ? board.lanes.values.filter((value) => value.id !== cell.lane).map((value) => ({ action: `${MOVE_TO_LANE}${value.id}`, label: `Move to lane ${value.label}` }))
    : [];
  return [...(columns.length ? ['separator' as const, ...columns] : []), ...(lanes.length ? ['separator' as const, ...lanes] : [])];
}

/** Where a card goes for a ⋯ move: its cell with the column or the lane changed; undefined for no move. */
export function cellForMove(action: string, cell: LaneCell): LaneCell | undefined {
  if (action.startsWith(MOVE_TO_COLUMN)) {
    return { ...cell, column: action.slice(MOVE_TO_COLUMN.length) };
  }
  if (action.startsWith(MOVE_TO_LANE)) {
    return { ...cell, lane: action.slice(MOVE_TO_LANE.length) };
  }
  return undefined;
}
