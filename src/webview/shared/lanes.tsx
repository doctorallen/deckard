/**
 * A board with lanes (docs/implementation/46-boards-and-lanes.md): columns
 * across, their heads drawn once at the top, and, with lanes, rows of cells
 * stacked down the page, one per value of a second axis, each under a head
 * that names it, counts it, and folds it. Every lane has a cell in every
 * column, so a column's cells line up down the page. Without lanes it is
 * one row of cells under the heads, as a board's columns are.
 *
 * It knows nothing of what a card is. A board hands it its columns and
 * lanes (`LaneHead`), the cards in each cell (`cardsIn`), and how to draw
 * one (`renderCard`); the grid draws the heads, the cells, and each head's
 * +, whose `data-action` is the board's own (`addAction`), carrying the
 * column's or the lane's id in `data-lane-column` or `data-lane-lane`.
 *
 * To use it on a second board, such as the Task board:
 *
 * 1. Draw `<LaneGrid>` with the board's columns and lanes, and in
 *    `renderCard` put `laneCardAttributes(key, item)` on each card's own
 *    element: the card's key in its cell, and the thing it stands for (a
 *    row, a task), which a head counts once however many cells it is in.
 * 2. Call `installLaneGrid()` once, which folds a lane when its name is
 *    chosen, remembered while the page is open. Pass `drag` to have the
 *    grid carry cards between cells: `refusal` says why a cell will not
 *    take a card (shown on the cell, faded, while the card is held), and
 *    `drop` is told of a card put down in another cell that takes it. A
 *    board with drag code of its own can leave `drag` out and use the
 *    cells' `data-lane-column` and `data-lane-lane`.
 * 3. A board whose heads say more than a name and a count, as the Task
 *    board's limits and overdue counts do, draws them with
 *    `renderColumnHead`, and what a cell holds after its cards, such as a
 *    Show N more, with `renderCellEnd`; a head's `attributes` carry what
 *    the board counts it again from.
 * 4. On a move, call `moveLaneCard(card, cell)` to show it at once,
 *    pending, until the host's next state draws the board afresh; it bumps
 *    `laneGrid.generation`, which keys the grid, so that draw makes the
 *    cells anew rather than patching elements the page moved. Call
 *    `keepLaneScroll()` before a draw, and what it returns after, to keep
 *    the grid scrolled across where it was.
 *
 * Its look is `lanes.css`, drawn with theme tokens alone as the Task
 * board's columns are; the cards bring their own.
 */
import { Fragment, type ComponentChild } from 'preact';

import { IconButton } from './buttons';
import { ChevronRightIcon, PlusIcon } from './strokeIcons';

/** A column's or a lane's head: its id, name, and count, and what its + says. */
export interface LaneHead {
  readonly id: string;
  readonly label: string;
  /** How many things it holds, over every lane or every column. */
  readonly count: number;
  /** The + on its head, by what it says to a screen reader, `Add an initiative to Active`; none draws no +. */
  readonly add?: string;
  /** Classes after its own, such as one a board colors by. */
  readonly className?: string;
  /** Attributes of the board's own on a column's head or a lane's section, such as what its counts are recounted from. */
  readonly attributes?: Readonly<Record<string, string>>;
}

/** A cell of the grid, by its column's id and its lane's, when there are lanes. */
export interface LaneCell {
  readonly column: string;
  readonly lane?: string;
}

/** What a lane grid draws. */
export interface LaneGridProps<Card> {
  /** Names the grid: which lanes are folded is kept by it, and cards move only within it. */
  readonly grid: string;
  /** What a screen reader calls the board. */
  readonly label: string;
  readonly columns: readonly LaneHead[];
  /** The lanes, top to bottom; none draws one row of cells under the heads. */
  readonly lanes?: readonly LaneHead[];
  /** The cards in a cell, in order. */
  readonly cardsIn: (cell: LaneCell) => readonly Card[];
  /** A card, its root carrying `laneCardAttributes`. */
  readonly renderCard: (card: Card, cell: LaneCell) => ComponentChild;
  /** A card's key in its cell, unique on the board. */
  readonly cardKey: (card: Card, cell: LaneCell) => string;
  /** The `data-action` of each head's +. */
  readonly addAction?: string;
  /** The heading level of the heads: 2 on a page of its own, 3 under a page's own headings (the default). */
  readonly level?: 2 | 3;
  /** Classes after `lane-grid`. */
  readonly className?: string;
  /**
   * What a column's head holds, in place of its name, count, and +, for a
   * board whose heads say more, as the Task board's limits and overdue
   * counts do.
   */
  readonly renderColumnHead?: (column: LaneHead) => ComponentChild;
  /** What a cell holds after its cards, such as a Show N more. */
  readonly renderCellEnd?: (cell: LaneCell) => ComponentChild;
}

/** What the grids on a page keep between draws: how many times a card was moved outside a draw, and the folded lanes. */
export const laneGrid: { generation: number; folded: Set<string> } = { generation: 0, folded: new Set() };

/** A folded lane's key: its grid and its id. */
function foldKey(grid: string, lane: string): string {
  return `${grid}\u0000${lane}`;
}

/** Whether a lane of a grid is folded. */
export function isLaneFolded(grid: string, lane: string): boolean {
  return laneGrid.folded.has(foldKey(grid, lane));
}

/** The attributes a card's own element carries: draggable, its key in its cell, and what it stands for, which the heads count once. */
export function laneCardAttributes(key: string, item: string): Record<string, string> {
  return { draggable: 'true', 'data-lane-card': key, 'data-lane-item': item };
}

/** A head's + , quiet until its head is pointed at or holds focus under Zen. */
function AddButton({ action, label, attributes }: { readonly action: string | undefined; readonly label: string | undefined; readonly attributes: Record<string, string> }) {
  return action && label
    ? <IconButton action={action} className="lane-add" label={label} icon={<PlusIcon />} attributes={{ ...attributes, 'data-zen-reveal': '' }} />
    : null;
}

/** A heading at the grid's level. */
function Heading({ level, className, children }: { readonly level: 2 | 3; readonly className: string; readonly children: ComponentChild }) {
  return level === 2 ? <h2 class={className}>{children}</h2> : <h3 class={className}>{children}</h3>;
}

/** One cell: its cards, as a list a screen reader counts, and room for why it will not take a card. */
function Cell<Card>({ props, cell, column, lane }: { readonly props: LaneGridProps<Card>; readonly cell: LaneCell; readonly column: LaneHead; readonly lane?: LaneHead }) {
  const cards = props.cardsIn(cell);
  const name = lane ? `${column.label}, ${lane.label}` : column.label;
  return (
    <div class="lane-cell" data-lane-column={cell.column} data-lane-lane={cell.lane}>
      <div class="lane-cards" role="list" aria-label={name}>
        {cards.map((card) => <Fragment key={props.cardKey(card, cell)}>{props.renderCard(card, cell)}</Fragment>)}
      </div>
      {props.renderCellEnd ? props.renderCellEnd(cell) : null}
    </div>
  );
}

/** A row of cells, one per column, in a lane or under the heads. */
function CellRow<Card>({ props, lane, hidden }: { readonly props: LaneGridProps<Card>; readonly lane?: LaneHead; readonly hidden?: boolean }) {
  return (
    <div class="lane-row" hidden={hidden}>
      {props.columns.map((column) => {
        const cell: LaneCell = lane ? { column: column.id, lane: lane.id } : { column: column.id };
        return <Cell key={column.id} props={props} cell={cell} column={column} lane={lane} />;
      })}
    </div>
  );
}

/** A lane: its head, which names it, counts it, folds it, and adds to it, then its cells. */
function Lane<Card>({ props, lane, level }: { readonly props: LaneGridProps<Card>; readonly lane: LaneHead; readonly level: 2 | 3 }) {
  const folded = isLaneFolded(props.grid, lane.id);
  return (
    <section class={lane.className ? `lane ${lane.className}` : 'lane'} data-lane-lane={lane.id} aria-label={`${lane.label}, ${lane.count}`} {...lane.attributes}>
      <div class="lane-head" data-zen-region="">
        <Heading level={level} className="lane-title">
          <button type="button" class="lane-fold" data-lane-fold={lane.id} aria-expanded={!folded} data-tip={folded ? `Show ${lane.label}` : `Fold ${lane.label}`}>
            <ChevronRightIcon />
            <span class="lane-label">{lane.label}</span>
            <span class="lane-count" data-lane-count="">{String(lane.count)}</span>
          </button>
        </Heading>
        <AddButton action={props.addAction} label={lane.add} attributes={{ 'data-lane-lane': lane.id }} />
      </div>
      <CellRow props={props} lane={lane} hidden={folded} />
    </section>
  );
}

/**
 * The grid: the column heads once, each with its count over every lane
 * and its + , then each lane under its head, or one row of cells.
 */
export function LaneGrid<Card>(props: LaneGridProps<Card>) {
  const level = props.level ?? 3;
  return (
    <div
      key={`${props.grid}-${laneGrid.generation}`}
      class={props.className ? `lane-grid ${props.className}` : 'lane-grid'}
      role="group"
      aria-label={props.label}
      data-lane-grid={props.grid}
    >
      <div class="lane-heads">
        {props.columns.map((column) => (
          <div key={column.id} class={column.className ? `lane-column-head ${column.className}` : 'lane-column-head'} data-lane-column={column.id} data-zen-region="" {...column.attributes}>
            {props.renderColumnHead
              ? props.renderColumnHead(column)
              : (
                <>
                  <Heading level={level} className="lane-column-title">
                    <span class="lane-column-label">{column.label}</span>
                    <span class="lane-count" data-lane-count="">{String(column.count)}</span>
                  </Heading>
                  <AddButton action={props.addAction} label={column.add} attributes={{ 'data-lane-column': column.id }} />
                </>
              )}
          </div>
        ))}
      </div>
      {props.lanes
        ? props.lanes.map((lane) => <Lane key={lane.id} props={props} lane={lane} level={level} />)
        : <CellRow props={props} />}
    </div>
  );
}

/** The cell an element is in, read from the page: its column's id and its lane's. */
export function laneCellOf(element: Element | null | undefined): LaneCell | undefined {
  const cell = element ? element.closest<HTMLElement>('.lane-cell') : null;
  const column = cell?.dataset.laneColumn;
  if (!cell || column === undefined) {
    return undefined;
  }
  const lane = cell.dataset.laneLane;
  return lane === undefined ? { column } : { column, lane };
}

/** Whether two cells are the same one. */
function sameCell(left: LaneCell, right: LaneCell): boolean {
  return left.column === right.column && left.lane === right.lane;
}

/** The cell element of a grid for a cell. */
function cellElement(grid: Element, cell: LaneCell): HTMLElement | undefined {
  return Array.from(grid.querySelectorAll<HTMLElement>('.lane-cell')).find((candidate) => {
    const at = laneCellOf(candidate);
    return at !== undefined && sameCell(at, cell);
  });
}

/** How many things the cards among `cells` stand for, each once. */
function countItems(cells: readonly Element[]): number {
  const items = new Set<string>();
  cells.forEach((cell) => cell.querySelectorAll<HTMLElement>('[data-lane-card]').forEach((card) => items.add(String(card.dataset.laneItem))));
  return items.size;
}

/** Each head of a grid counted again from the cards it holds now. */
export function recountLaneGrid(grid: Element): void {
  const cells = Array.from(grid.querySelectorAll<HTMLElement>('.lane-cell'));
  grid.querySelectorAll<HTMLElement>('.lane-column-head').forEach((head) => {
    const count = head.querySelector('[data-lane-count]');
    const text = String(countItems(cells.filter((cell) => cell.dataset.laneColumn === head.dataset.laneColumn)));
    if (count && count.textContent !== text) {
      count.textContent = text;
    }
  });
  grid.querySelectorAll<HTMLElement>('.lane').forEach((lane) => {
    const count = lane.querySelector('.lane-head [data-lane-count]');
    const text = String(countItems(cells.filter((cell) => cell.dataset.laneLane === lane.dataset.laneLane)));
    if (count && count.textContent !== text) {
      count.textContent = text;
    }
  });
}

/**
 * Shows a move at once: the card goes to the top of its new cell, the
 * heads count again, and it is marked pending until the next draw, which
 * makes the grid afresh.
 */
export function moveLaneCard(card: HTMLElement, to: LaneCell): void {
  const grid = card.closest('.lane-grid');
  const target = grid ? cellElement(grid, to) : undefined;
  laneGrid.generation += 1;
  if (grid && target && !target.contains(card)) {
    target.querySelector('.lane-cards')?.prepend(card);
    recountLaneGrid(grid);
  }
  card.classList.add('is-pending');
  card.setAttribute('aria-busy', 'true');
  card.focus();
}

/**
 * Where each grid on the page is scrolled across now, and a function that
 * scrolls the grids drawn next back there: a move draws the grid afresh,
 * which starts at its left edge, and threw the reader back from a far
 * column.
 */
export function keepLaneScroll(): () => void {
  const kept = new Map(Array.from(document.querySelectorAll<HTMLElement>('.lane-grid')).map((grid) => [grid.dataset.laneGrid, grid.scrollLeft]));
  return () => {
    document.querySelectorAll<HTMLElement>('.lane-grid').forEach((grid) => {
      const left = kept.get(grid.dataset.laneGrid);
      if (left !== undefined && grid.scrollLeft !== left) {
        grid.scrollLeft = left;
      }
    });
  };
}

/** What the grid's drags ask of the board. */
export interface LaneDragOptions {
  /** Why `to` will not take the card, said on it while the card is held; undefined when it will. Never asked of the card's own cell. */
  readonly refusal: (card: HTMLElement, from: LaneCell, to: LaneCell) => string | undefined;
  /** A card put down in another cell that takes it. */
  readonly drop: (card: HTMLElement, from: LaneCell, to: LaneCell) => void;
}

/** The one type a lane card's drag carries, which tells the cells it is a card: words dragged from a note carry plain text. */
const LANE_CARD_TYPE = 'application/x-deckard-lane-card';

/** The card being dragged, and the cell it left, while one is. */
let held: { card: HTMLElement; from: LaneCell } | undefined;

/** Whether a drag is a lane card's, by the type its card put on it. */
function carriesLaneCard(event: DragEvent): boolean {
  return Boolean(held && event.dataTransfer && Array.from(event.dataTransfer.types).includes(LANE_CARD_TYPE));
}

/** The cell under a drag that takes the card held: in its grid, not its own, and not refused. */
function dropCell(event: DragEvent): HTMLElement | undefined {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.lane-cell') : null;
  if (!held || !target || !carriesLaneCard(event) || target.closest('.lane-grid') !== held.card.closest('.lane-grid')) {
    return undefined;
  }
  const cell = laneCellOf(target);
  return cell && !sameCell(cell, held.from) && !target.classList.contains('is-refused') ? target : undefined;
}

/** Takes the drop target's mark off every cell. */
function clearDropTargets(): void {
  document.querySelectorAll('.lane-cell.drop-target').forEach((cell) => cell.classList.remove('drop-target'));
}

/** Lets go of the card held, if any: its marks, the cells' refusals, and which card it was. */
function endLaneDrag(): void {
  document.querySelectorAll('.lane-grid [data-lane-card].dragging').forEach((card) => card.classList.remove('dragging'));
  document.querySelectorAll('.lane-grid.is-dragging-card').forEach((grid) => grid.classList.remove('is-dragging-card'));
  document.querySelectorAll<HTMLElement>('.lane-cell.is-refused').forEach((cell) => {
    cell.classList.remove('is-refused');
    delete cell.dataset.refuses;
  });
  clearDropTargets();
  held = undefined;
}

/** A card picked up: it is held, and each cell that will not take it says why. */
function startLaneDrag(event: DragEvent, drag: LaneDragOptions): void {
  endLaneDrag();
  const card = event.target instanceof Element ? event.target.closest<HTMLElement>('.lane-grid [data-lane-card]') : null;
  const from = laneCellOf(card);
  const grid = card?.closest('.lane-grid');
  if (!card || !from || !grid) {
    return;
  }
  held = { card, from };
  card.classList.add('dragging');
  grid.classList.add('is-dragging-card');
  grid.querySelectorAll<HTMLElement>('.lane-cell').forEach((element) => {
    const to = laneCellOf(element);
    const reason = to && !sameCell(to, from) ? drag.refusal(card, from, to) : undefined;
    if (!reason) {
      return;
    }
    element.classList.add('is-refused');
    element.dataset.refuses = reason;
  });
  if (!event.dataTransfer) {
    return;
  }
  event.dataTransfer.effectAllowed = 'move';
  // The card's own type alone: plain text would be typed into a field it was dropped on.
  event.dataTransfer.setData(LANE_CARD_TYPE, String(card.dataset.laneCard));
}

/** Carries cards between a grid's cells: held, carried over the cells, and put down. Escape lets go, as any drag does. */
function listenForLaneDrags(drag: LaneDragOptions): void {
  document.addEventListener('dragstart', (event) => startLaneDrag(event, drag));
  document.addEventListener('dragend', () => endLaneDrag());
  document.addEventListener('dragover', (event) => {
    const cell = dropCell(event);
    if (!cell) {
      if (held) {
        clearDropTargets();
      }
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (cell.classList.contains('drop-target')) {
      return;
    }
    clearDropTargets();
    cell.classList.add('drop-target');
  });
  document.addEventListener('dragleave', (event) => {
    const cell = event.target instanceof Element ? event.target.closest('.lane-cell') : null;
    if (!cell || cell.contains(event.relatedTarget as Node | null)) {
      return;
    }
    cell.classList.remove('drop-target');
  });
  // Any drop ends the drag, since the dragend the card sends never arrives when a draw took it away.
  document.addEventListener('drop', (event) => {
    const cell = dropCell(event);
    const was = held;
    if (carriesLaneCard(event)) {
      event.preventDefault();
    }
    endLaneDrag();
    const to = laneCellOf(cell);
    if (was && to) {
      drag.drop(was.card, was.from, to);
    }
  });
}

/** Folds or unfolds a lane from its name, kept while the page is open. */
function toggleLane(button: HTMLElement): void {
  const lane = button.dataset.laneFold;
  const grid = button.closest<HTMLElement>('.lane-grid')?.dataset.laneGrid;
  if (lane === undefined || grid === undefined) {
    return;
  }
  const key = foldKey(grid, lane);
  const folded = !laneGrid.folded.has(key);
  if (folded) {
    laneGrid.folded.add(key);
  } else {
    laneGrid.folded.delete(key);
  }
  button.setAttribute('aria-expanded', String(!folded));
  button.setAttribute('data-tip', `${folded ? 'Show' : 'Fold'} ${button.querySelector('.lane-label')?.textContent ?? ''}`);
  const row = button.closest('.lane')?.querySelector<HTMLElement>('.lane-row');
  if (row) {
    row.hidden = folded;
  }
}

/** Wires the page's lane grids, once: a lane's name folds it, and, given `drag`, cards move between cells. */
export function installLaneGrid(options: { readonly drag?: LaneDragOptions } = {}): void {
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('.lane-grid [data-lane-fold]') : null;
    if (button) {
      toggleLane(button);
    }
  });
  if (options.drag) {
    listenForLaneDrags(options.drag);
  }
}
