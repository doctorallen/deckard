/**
 * Moving cards: a card's keys, its menu, its checkbox, opening it,
 * dragging it between columns, and, on a board sorted by rank, putting it
 * in its own place within its column. A move shows at once, and the host's next
 * state confirms it or puts the card back. An edit to a task whose last
 * edit the host has not answered waits for it, on a card or on a list or
 * table row. Listeners sit on the document, installed once, so the page
 * may draw its board freely.
 *
 * On a board with lanes (plan 46) a card's place is a cell, a column's in
 * one lane, and each move, rank, and key below works on cells as it does
 * on columns: a cell is found by its column's id and its lane's, and a card
 * moved to another lane carries both.
 */
import type { TaskBoardMessage } from '../../ui/protocol/taskBoard';
import { type BoardCell, type LaneBoardRules, refuseCellMove } from '../../domain/tasks/boardLanes';
import { type ActionMenuGroup, openActionMenu } from '../shared/actionMenu';
import { openSourceMessage } from '../shared/openSource';
import { announce } from '../shared/status';
import { taskTitleOf } from '../shared/taskRow';
import { describeBoardColumn } from './board';
import { board, cardKeyOf, listsChanged } from './model';

/** Sends the host one of the board's messages. */
type Post = (message: TaskBoardMessage) => void;

/** What the board's moves read of the page: how it posts, and the namespaces its Tag… menus offer. */
export interface BoardMovesOptions {
  readonly post: Post;
  /** The namespaces open tasks carry, the one the board is grouped by, if any, and the one its lanes are by. */
  readonly namespaces: () => {
    readonly offered: ReadonlyArray<{ name: string; openTasks: number }>;
    readonly current: string | undefined;
    readonly lanes?: string;
  };
  /** Whether the board is sorted by rank, so a card can be put in its own place within its column. */
  readonly ranked: () => boolean;
  /** The columns and lanes of a board with lanes, which say which cells refuse a card; undefined without lanes. */
  readonly lanes: () => LaneBoardRules | undefined;
}

/** The card an element is in, on the board. */
function boardCard(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.task-board .board-card') : null;
}

/** A place for cards on the board: a column, or a cell of a board with lanes. */
const CELL_SELECTOR = '.board-column, .lane-cell';

/** The column or cell an element is in, on the board. */
function cellOf(target: EventTarget | null | undefined): HTMLElement | null {
  const cell = target instanceof Element ? target.closest<HTMLElement>(CELL_SELECTOR) : null;
  return cell && cell.closest('.task-board') ? cell : null;
}

/** The id of the column a column or cell is in. */
function cellColumn(cell: HTMLElement): string {
  return String(cell.dataset.columnId ?? cell.dataset.laneColumn);
}

/** The id of the lane a cell is in; undefined for a column of a board without lanes. */
function cellLane(cell: HTMLElement): string | undefined {
  return cell.dataset.laneLane;
}

/** Every column, or every cell, on the board, in the page's order. */
function boardCells(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.task-board .board-column, .task-board .lane-cell'));
}

/** Whether a cell is in a folded lane, out of sight. */
function isFolded(cell: HTMLElement): boolean {
  return Boolean(cell.closest('.lane-row[hidden]'));
}

/** Where a card is: its column and, on a board with lanes, its lane. */
function placeOf(card: HTMLElement): { column: string; lane?: string } {
  return { column: String(card.dataset.cardColumn), ...(card.dataset.cardLane === undefined ? {} : { lane: card.dataset.cardLane }) };
}

/** Whether the reader asked for less motion. */
function reducedMotion(): boolean {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** The cards of a column that the words being typed have not hidden. */
function visibleCards(column: Element): HTMLElement[] {
  return Array.from(column.querySelectorAll<HTMLElement>('.board-card')).filter((card) => !card.hidden);
}

/** A column's name, from its title, or a cell's, its column's and its lane's: "In progress, Payments". */
function columnTitle(column: Element | null | undefined): string {
  const named = column && column.classList.contains('lane-cell') ? column.querySelector('.lane-cards')?.getAttribute('aria-label') : undefined;
  if (named) {
    return named;
  }
  const title = column && column.querySelector('.board-column-title span');
  return title ? String(title.textContent) : 'the column';
}

/**
 * Whether the cards of `column` can be put in the reader's own order: the
 * board is sorted by rank, and the column is an open one. Done and
 * Cancelled always list the most recently closed first.
 */
function canRankColumn(column: HTMLElement | null | undefined, ranked: boolean): column is HTMLElement {
  return Boolean(ranked && column && cellColumn(column) !== 'done' && cellColumn(column) !== 'cancelled');
}

/** The card a card dropped at `clientY` lands before, or null for the column's end. */
function cardBefore(column: HTMLElement, clientY: number, dragged: HTMLElement | undefined): HTMLElement | null {
  for (const card of visibleCards(column)) {
    if (card === dragged) {
      continue;
    }
    const box = card.getBoundingClientRect();
    if (clientY < box.top + box.height / 2) {
      return card;
    }
  }
  return null;
}

/** Shows where a card dragged within its column will land: a line before `before`, or after the last card. */
function showRankLine(column: HTMLElement, before: HTMLElement | null): void {
  const list = column.querySelector('.board-cards, .lane-cards');
  const current = document.querySelector('.rank-drop-line');
  if (!list || (current && current.parentElement === list && current.nextElementSibling === before)) {
    return;
  }
  clearRankLine();
  const line = document.createElement('div');
  line.className = 'rank-drop-line';
  line.setAttribute('aria-hidden', 'true');
  list.insertBefore(line, before);
}

/** Takes the line a dragged card showed away. */
function clearRankLine(): void {
  document.querySelectorAll('.rank-drop-line').forEach((line) => line.remove());
}

/** The column, or cell, a card dragged within its own, on a ranked board, is over. */
function rankColumn(event: DragEvent, ranked: boolean): HTMLElement | undefined {
  const column = cellOf(event.target);
  return board.dragId && carriesCard(event) && column && cellColumn(column) === board.dragColumn && cellLane(column) === board.dragLane && canRankColumn(column, ranked)
    ? column
    : undefined;
}

/** Makes `card` the board's one Tab stop, focuses it, and scrolls it into view. */
function focusCard(card: HTMLElement | undefined): void {
  if (!card) {
    return;
  }
  document.querySelectorAll('.task-board .board-card[tabindex="0"]').forEach((other) => other.setAttribute('tabindex', '-1'));
  card.setAttribute('tabindex', '0');
  board.tabStop = cardKeyOf(card);
  card.focus();
  if (card.scrollIntoView) {
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/** A column's header counted again from the cards it holds now. */
function recountColumn(column: HTMLElement | null): void {
  if (!column) {
    return;
  }
  const cards = visibleCards(column);
  const count = cards.length + Number(column.dataset.hiddenCount || 0);
  const id = column.dataset.columnId;
  const overdue = id === 'done' || id === 'due:overdue'
    ? 0
    : cards.filter((card) => card.querySelector('.board-details .overdue') && !card.classList.contains('completed')).length;
  const limit = column.dataset.limit === undefined ? undefined : Number(column.dataset.limit);
  const described = describeBoardColumn({ label: String(column.dataset.label ?? ''), symbol: column.dataset.symbol }, count, limit, overdue);
  const counter = column.querySelector('.board-count');
  // Written only when it changed, so the text the draw made stays the one
  // the next draw updates.
  if (counter && counter.textContent !== described.count) {
    counter.textContent = described.count;
  }
  column.setAttribute('aria-label', described.name);
  column.classList.toggle('over-limit', limit !== undefined && count > limit);
}

/** How many tasks the shown cards of some cells hold, each once, and the cards the cells hold back; or, with `keep`, how many of the shown ones it keeps. */
function countShown(cells: readonly HTMLElement[], keep?: (card: HTMLElement) => boolean): number {
  const tasks = new Set<string>();
  let held = 0;
  cells.forEach((cell) => {
    visibleCards(cell).filter((card) => !keep || keep(card)).forEach((card) => tasks.add(String(card.dataset.taskId)));
    held += keep ? 0 : Number(cell.querySelector<HTMLElement>('[data-hidden-count]')?.dataset.hiddenCount || 0);
  });
  return tasks.size + held;
}

/** Whether a shown card is an open one past its due date. */
function isOverdueCard(card: HTMLElement): boolean {
  return Boolean(card.querySelector('.board-details .overdue')) && !card.classList.contains('completed');
}

/**
 * A board with lanes counted again from the cards it shows now: each
 * column's head over every lane, as a column's header is, and each lane's
 * over every column, a task in two cells counted once.
 */
function recountLanes(grid: Element | null): void {
  if (!grid) {
    return;
  }
  const cells = Array.from(grid.querySelectorAll<HTMLElement>('.lane-cell'));
  grid.querySelectorAll<HTMLElement>('.lane-column-head').forEach((head) => {
    const id = head.dataset.laneColumn;
    const own = cells.filter((cell) => cell.dataset.laneColumn === id);
    const count = countShown(own);
    const overdue = id === 'done' || id === 'due:overdue' ? 0 : countShown(own, isOverdueCard);
    const limit = head.dataset.limit === undefined ? undefined : Number(head.dataset.limit);
    const described = describeBoardColumn({ label: String(head.dataset.label ?? ''), symbol: head.dataset.symbol }, count, limit, overdue);
    const counter = head.querySelector('.board-count');
    if (counter && counter.textContent !== described.count) {
      counter.textContent = described.count;
    }
    head.classList.toggle('over-limit', limit !== undefined && count > limit);
  });
  grid.querySelectorAll<HTMLElement>('.lane').forEach((lane) => {
    const count = String(countShown(cells.filter((cell) => cell.dataset.laneLane === lane.dataset.laneLane)));
    const counter = lane.querySelector('.lane-head [data-lane-count]');
    if (counter && counter.textContent !== count) {
      counter.textContent = count;
    }
  });
}

/** A column's header, or a board with lanes' heads, counted again from the cards shown now. */
function recount(cell: HTMLElement | null): void {
  if (cell && cell.classList.contains('lane-cell')) {
    recountLanes(cell.closest('.lane-grid'));
    return;
  }
  recountColumn(cell);
}

/** Where the board was scrolled across, and each of its columns down, by column. */
export interface BoardScroll {
  readonly left: number;
  readonly columns: ReadonlyMap<string, number>;
}

/** Where the board and its columns are scrolled now, or undefined with no board drawn. */
export function readBoardScroll(): BoardScroll | undefined {
  const drawn = document.querySelector<HTMLElement>('.task-board');
  if (!drawn) {
    return undefined;
  }
  const columns = new Map<string, number>();
  drawn.querySelectorAll<HTMLElement>('.board-column').forEach((column) => {
    const cards = column.querySelector<HTMLElement>('.board-cards');
    if (cards) {
      columns.set(String(column.dataset.columnId), cards.scrollTop);
    }
  });
  return { left: drawn.scrollLeft, columns };
}

/**
 * Scrolls the board and each column it still draws back to where
 * `readBoardScroll` found them. A move or a completion makes the board
 * afresh, and a column made afresh starts at its top: moving a card far
 * down a long column threw the reader back to its first card.
 */
export function restoreBoardScroll(scroll: BoardScroll | undefined): void {
  const drawn = document.querySelector<HTMLElement>('.task-board');
  if (!scroll || !drawn) {
    return;
  }
  if (drawn.scrollLeft !== scroll.left) {
    drawn.scrollLeft = scroll.left;
  }
  drawn.querySelectorAll<HTMLElement>('.board-column').forEach((column) => {
    const cards = column.querySelector<HTMLElement>('.board-cards');
    const top = scroll.columns.get(String(column.dataset.columnId));
    if (cards && top !== undefined && cards.scrollTop !== top) {
      cards.scrollTop = top;
    }
  });
}

/**
 * Keeps the board with the cards the words being typed leave shown: each
 * column counted again from them, and the Tab stop moved to the first of
 * them when the words hid the card that held it.
 */
export function followShownCards(): void {
  document.querySelectorAll<HTMLElement>('.task-board .board-column').forEach((column) => recountColumn(column));
  document.querySelectorAll<HTMLElement>('.lane-grid.task-board').forEach((grid) => recountLanes(grid));
  // A card in a folded lane is out of sight, as one the words hide is.
  const shown = (card: HTMLElement | null): boolean => Boolean(card && !card.hidden && !card.closest('.lane-row[hidden]'));
  const stop = document.querySelector<HTMLElement>('.task-board .board-card[tabindex="0"]');
  const first = Array.from(document.querySelectorAll<HTMLElement>('.task-board .board-card')).find(shown);
  if (shown(stop) || !first) {
    return;
  }
  stop?.setAttribute('tabindex', '-1');
  first.setAttribute('tabindex', '0');
  board.tabStop = cardKeyOf(first);
}

/**
 * A card's menu once a move shows: the choice it moved to is checked in its
 * group, as the host's next state will check it.
 */
function movedMenu(groups: readonly ActionMenuGroup[], value: string): ActionMenuGroup[] {
  return groups.map((group) => (group.items.some((item) => item.value === value && item.checked !== undefined)
    ? { ...group, items: group.items.map((item) => ({ ...item, checked: item.value === value })) }
    : group));
}

/**
 * A move shows at once: the card goes to the top of its new column, or its
 * new cell, the counts change, and it is marked pending until the host's
 * next state replaces the board. A move to a column this grouping does not
 * draw, such as a priority on a status board, or to a cell that will not
 * take it, marks the card where it is: `to` is then undefined, and `value`
 * is what the move writes. Its menu goes with it, under the card's new
 * key, so its ⋯ opens before the host answers.
 */
function applyMove(card: HTMLElement, to: { column: string; lane?: string } | undefined, value: string): void {
  listsChanged();
  const groups = board.moves[cardKeyOf(card)];
  const from = cellOf(card);
  const lane = to?.lane ?? card.dataset.cardLane;
  const target = to ? boardCells().find((cell) => cellColumn(cell) === to.column && cellLane(cell) === lane) : undefined;
  if (to && target && target !== from) {
    const cards = target.querySelector('.board-cards, .lane-cards');
    cards?.querySelector('.board-empty')?.remove();
    cards?.prepend(card);
    // It is this column's card now, and this lane's, for its key and its focus.
    card.setAttribute('data-card-column', to.column);
    if (lane !== undefined) {
      card.setAttribute('data-card-lane', lane);
    }
    board.tabStop = cardKeyOf(card);
    recount(from);
    recount(target);
  }
  if (groups) {
    const moved = to ? [to.column, ...(to.lane === undefined ? [] : [to.lane])] : [value];
    board.moves[cardKeyOf(card)] = moved.reduce(movedMenu, groups);
  }
  card.classList.add('is-pending');
  card.setAttribute('aria-busy', 'true');
  focusCard(card);
}

/**
 * The tasks whose line the page asked the host to rewrite, by the id they
 * had, until the host's next state or its refusal answers the edit.
 * Rewriting a line usually gives its task a new id, so an edit sent with
 * the old one after the first was written finds no task and is refused.
 */
const unanswered = new Set<string>();

/**
 * The edits a card or a list or table row was given while its task's last
 * edit was unanswered, in order: where the task is written, the column its
 * card was in (none for a row), and how to send the edit for the card or
 * row the host draws there next.
 */
const held: { written: string; column: string | undefined; lane?: string; send: (entry: HTMLElement) => void }[] = [];

/** An attribute selector for one data attribute, its value escaped. */
function attributeSelector(name: string, value: string): string {
  return `[data-${name}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/** Where a card's task is written, its file and line, as a selector. */
function writtenAt(card: HTMLElement): string {
  return attributeSelector('file-path', String(card.dataset.filePath)) + attributeSelector('line', String(card.dataset.line));
}

/**
 * The card or row drawn now where a held edit's task is written: a card in
 * the column it was in when the edit was asked for, else in any, or a list
 * or table row.
 */
function heldEntry(edit: { written: string; column: string | undefined; lane?: string }): HTMLElement | null {
  if (edit.column === undefined) {
    return document.querySelector<HTMLElement>(`.task-row${edit.written}, .result-row${edit.written}`);
  }
  const lane = edit.lane === undefined ? '' : attributeSelector('card-lane', edit.lane);
  return document.querySelector<HTMLElement>(`.task-board .board-card${edit.written}${attributeSelector('card-column', edit.column)}${lane}`)
    || document.querySelector<HTMLElement>(`.task-board .board-card${edit.written}`);
}

/**
 * Sends the edits held for cards and rows while their task's last edit was
 * unanswered, once the host's next state is drawn, which answers it: the
 * host draws again when the write reaches the index. Each goes to the card
 * or row written where its task is written, a card in the column it was in
 * when it was asked for, and with the id the state gives the task; an edit
 * for a task the page no longer draws is dropped. Edits of one task go one
 * state at a time, in order.
 */
export function sendHeldEdits(): void {
  unanswered.clear();
  const waiting = held.splice(0);
  const busy = new Set<string>();
  for (const edit of waiting) {
    const card = heldEntry(edit);
    if (!card) {
      continue;
    }
    if (busy.has(edit.written) || unanswered.has(String(card.dataset.taskId))) {
      busy.add(edit.written);
      held.push(edit);
      continue;
    }
    edit.send(card);
    busy.add(edit.written);
  }
}

/** Lets a task's next edit go: the host refused the last one, so the id it was sent with is still the task's. */
export function settleRefusedEdit(taskId: string): void {
  unanswered.delete(taskId);
}

/**
 * Sends a card's or a row's edit now, or, while its task's last edit is
 * unanswered, shows it now with `showNow` and holds it until a state gives
 * the task its new id. Two quick keys on a card used to send the second
 * with the id the first had just made stale, and the host refused it.
 */
function whenAnswered(entry: HTMLElement, send: (entry: HTMLElement) => void, showNow?: () => void): void {
  if (!unanswered.has(String(entry.dataset.taskId))) {
    send(entry);
    return;
  }
  const column = entry.classList.contains('board-card') ? String(entry.dataset.cardColumn) : undefined;
  showNow?.();
  held.push({ written: writtenAt(entry), column, ...(entry.dataset.cardLane === undefined ? {} : { lane: entry.dataset.cardLane }), send });
}

/**
 * Sends a list or table row's edit now, or holds it while its task's last
 * edit is unanswered, as a card's is: two quick edits on one row sent the
 * second with the id the first had just made stale. `edit` makes the
 * message for the row drawn when it goes, or nothing when there is nothing
 * left to send. A completion or a move rewrites the task's line, so its
 * task's next edit waits for the host's answer.
 */
export function editRow(row: HTMLElement, edit: (row: HTMLElement) => TaskBoardMessage | undefined, post: Post): void {
  whenAnswered(row, (drawn) => {
    const message = edit(drawn);
    if (!message) {
      return;
    }
    if (message.type === 'toggleTask' || message.type === 'moveTask') {
      unanswered.add(message.taskId);
    }
    post(message);
  });
}

/**
 * What a card's menu says when the task already has the move `value`
 * makes, "Draft spec: Priority is already High.", or undefined when it
 * does not.
 */
function alreadyHas(card: HTMLElement, groups: readonly ActionMenuGroup[], value: string): string | undefined {
  const group = groups.find((candidate) => candidate.items.some((item) => item.value === value));
  const chosen = group ? group.items.find((item) => item.value === value) : undefined;
  return chosen && chosen.checked ? `${taskTitleOf(card)}: ${(group && group.label) || 'It'} is already ${chosen.label}.` : undefined;
}

/**
 * Marks a card completed or open at once, with its checkbox, as a move
 * shows at once; a completed card lingers a moment before the next draw.
 */
function markCompleted(card: HTMLElement, completed: boolean): void {
  const title = taskTitleOf(card);
  listsChanged();
  card.classList.toggle('completed', completed);
  const box = card.querySelector<HTMLInputElement>('[data-action="board-toggle-task"]');
  if (box) {
    box.checked = completed;
    box.setAttribute('aria-label', `${completed ? 'Reopen ' : 'Complete '}${title}`);
    box.setAttribute('data-tip', `${completed ? 'Reopen' : 'Complete'} this task`);
  }
  if (!completed) {
    card.classList.remove('is-completing');
    return;
  }
  if (reducedMotion()) {
    return;
  }
  card.classList.add('is-completing');
  board.lingerUntil = Date.now() + 800;
}

/** The board's moves, wired once by `installBoardMoves`. */
class BoardMoves {
  public constructor(private readonly options: BoardMovesOptions) {}

  private post(message: TaskBoardMessage): void {
    this.options.post(message);
  }

  private openCard(card: HTMLElement, event?: MouseEvent | KeyboardEvent): void {
    this.post(openSourceMessage(card, event));
  }

  /**
   * Completes or reopens a card's task. The card says so at once, as a move
   * does, so a second x before the host answers reopens it rather than
   * completing it again.
   */
  private completeCard(card: HTMLElement, completed: boolean): void {
    announce(`${completed ? 'Completed ' : 'Reopened '}${taskTitleOf(card)}.`);
    whenAnswered(card, (drawn) => {
      // Held, the task may be so already by the time it is sent.
      if (drawn.classList.contains('completed') === completed) {
        return;
      }
      markCompleted(drawn, completed);
      this.sendRewrite({ type: 'toggleTask', taskId: String(drawn.dataset.taskId), completed });
    }, () => markCompleted(card, completed));
  }

  /** Sends an edit that rewrites its task's line, whose id is then unanswered. */
  private sendRewrite(message: TaskBoardMessage & { taskId: string }): void {
    unanswered.add(message.taskId);
    this.post(message);
  }

  /**
   * Moves a card to `column`, or on a board with lanes to the cell of
   * `column` in `lane`, now, or once its task's last edit is answered; by
   * then the task may already be there, and nothing is sent. A move the
   * board draws no cell for is `elsewhere`, written from the column or lane
   * the card left (`from`), and marks the card where it is.
   */
  private move(card: HTMLElement, column: string, lane?: string, elsewhere?: { from: string }): void {
    const target = elsewhere ? undefined : { column, ...(lane === undefined ? {} : { lane }) };
    whenAnswered(card, (drawn) => {
      const groups = board.moves[cardKeyOf(drawn)] || [];
      const place = placeOf(drawn);
      const changesLane = lane !== undefined && lane !== place.lane;
      const hasColumn = place.column === column || Boolean(alreadyHas(drawn, groups, column));
      if (hasColumn && (!changesLane || alreadyHas(drawn, groups, lane))) {
        return;
      }
      applyMove(drawn, target, column);
      this.sendRewrite({
        type: 'moveTask',
        taskId: String(drawn.dataset.taskId),
        column,
        from: elsewhere ? elsewhere.from : place.column,
        ...(changesLane && place.lane !== undefined ? { lane, fromLane: place.lane } : {}),
      });
    }, () => applyMove(card, target, column));
  }

  /**
   * Moves a card by a choice that names one value, from its menu or a key:
   * on a board with lanes, a lane's value moves it across lanes in its
   * column, and any other its column in its lane. A cell that will not take
   * it, such as In progress's in the Done lane when a key completes it, is
   * not drawn into: the move is written, and the host's next state puts the
   * card where it now belongs.
   */
  private moveTo(card: HTMLElement, value: string): void {
    const rules = this.options.lanes();
    const place = placeOf(card);
    if (!rules || place.lane === undefined) {
      this.move(card, value);
      return;
    }
    const isLane = rules.lanes.some((lane) => lane.id === value) && !rules.columns.some((column) => column.id === value);
    const to: BoardCell = isLane ? { column: place.column, lane: value } : { column: value, lane: place.lane };
    const drawn = rules.columns.some((column) => column.id === to.column) && rules.lanes.some((lane) => lane.id === to.lane);
    if (drawn && !refuseCellMove({ column: place.column, lane: place.lane }, to, rules)) {
      this.move(card, to.column, to.lane);
      return;
    }
    this.move(card, value, undefined, { from: isLane ? place.lane : place.column });
  }

  /** Asks the host for something about a card's task, with the id the task has once its last edit is answered. */
  private ask(card: HTMLElement, type: 'pickTaskDate' | 'pickTaskAssignee' | 'snoozeTask' | 'moveTaskTo' | 'editTask' | 'breakIntoSteps'): void {
    whenAnswered(card, (drawn) => this.post({ type, taskId: String(drawn.dataset.taskId) }));
  }


  /**
   * Moves a card from a key. A key that asks for what the card's menu says
   * the task already has is answered as the menu answers it, rather than
   * sent to the host to be refused as a move that was not made.
   */
  private moveCard(card: HTMLElement, column: string, said: string): void {
    const already = alreadyHas(card, board.moves[cardKeyOf(card)] || [], column);
    if (already) {
      announce(already);
      return;
    }
    this.moveTo(card, column);
    announce(said);
  }

  /**
   * Puts a card before `before` in its column, or last for null, and ranks
   * the column's cards in the order they now show. The rank is the one the
   * list and the Tasks view keep, so the order holds in any grouping.
   */
  private rankCard(card: HTMLElement, before: HTMLElement | null): void {
    const column = cellOf(card);
    const list = card.parentElement;
    if (!column || !list || before === card || card.nextElementSibling === before) {
      return;
    }
    listsChanged();
    list.insertBefore(card, before);
    this.post({ type: 'reorderTasks', taskIds: visibleCards(column).map((shown) => String(shown.dataset.taskId)) });
    announce(before ? `Moved ${taskTitleOf(card)} above ${taskTitleOf(before)}.` : `Moved ${taskTitleOf(card)} to the bottom of ${columnTitle(column)}.`);
  }

  /** Alt+Up and Alt+Down: a card one place up or down its column, on a ranked board; true when the key was one. */
  private rankByKey(event: KeyboardEvent, card: HTMLElement): boolean {
    const column = cellOf(card);
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !canRankColumn(column, this.options.ranked())) {
      return false;
    }
    const cards = visibleCards(column);
    const at = cards.indexOf(card);
    if (event.key === 'ArrowUp' ? at > 0 : at < cards.length - 1) {
      this.rankCard(card, event.key === 'ArrowUp' ? cards[at - 1] : cards[at + 2] ?? null);
      card.focus();
    }
    return true;
  }

  /**
   * The arrows, Home, and End between cards. On a board with lanes, ← and →
   * go along the card's lane, and ↑ and ↓ go on past a cell's first or last
   * card into the lane above or below, in the same column.
   */
  private walk(key: string, card: HTMLElement, column: HTMLElement, columns: HTMLElement[]): void {
    const cards = visibleCards(column);
    const at = cards.indexOf(card);
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const step = key === 'ArrowDown' ? 1 : -1;
      focusCard(cards[at + step] ?? nextLaneCard(column, step));
      return;
    }
    if (key === 'Home' || key === 'End') {
      focusCard(key === 'Home' ? cards[0] : cards[cards.length - 1]);
      return;
    }
    const step = key === 'ArrowRight' ? 1 : -1;
    for (let index = columns.indexOf(column) + step; index >= 0 && index < columns.length; index += step) {
      const next = visibleCards(columns[index]);
      if (next.length) {
        focusCard(next[Math.min(at, next.length - 1)]);
        break;
      }
    }
  }

  /**
   * Moves a card to the droppable column to its left or right, if there is
   * one; on a board with lanes, to the next cell along its lane that takes
   * it.
   */
  private moveAcross(card: HTMLElement, column: HTMLElement, columns: HTMLElement[], step: number): void {
    const rules = this.options.lanes();
    const lane = cellLane(column);
    if (rules && lane !== undefined) {
      const from = { column: cellColumn(column), lane };
      const taking = columns.filter((cell) => cell === column || !refuseCellMove(from, { column: cellColumn(cell), lane }, rules));
      const target = taking[taking.indexOf(column) + step];
      if (target) {
        this.move(card, cellColumn(target), lane);
        announce(`Moved ${taskTitleOf(card)} to ${columnTitle(target)}.`);
      }
      return;
    }
    const droppable = columns.filter((candidate) => candidate.dataset.droppable === 'true');
    const target = droppable[droppable.indexOf(column) + step];
    if (target && droppable.includes(column)) {
      this.moveCard(card, String(target.dataset.columnId), `Moved ${taskTitleOf(card)} to ${columnTitle(target)}.`);
    }
  }

  /** The single keys that edit a focused card; true when the key was one. */
  private editKey(key: string, card: HTMLElement, column: HTMLElement, columns: HTMLElement[]): boolean {
    const asks: Readonly<Record<string, 'pickTaskDate' | 'pickTaskAssignee' | 'snoozeTask' | 'editTask' | 'breakIntoSteps'>> = { d: 'pickTaskDate', f: 'pickTaskAssignee', z: 'snoozeTask', e: 'editTask', s: 'breakIntoSteps' };
    if (key === 'x') {
      this.completeCard(card, !card.classList.contains('completed'));
    } else if (key === 't' || key === 'm') {
      this.moveCard(card, key === 't' ? 'due:today' : 'due:tomorrow', taskTitleOf(card) + (key === 't' ? ' is due today.' : ' is due tomorrow.'));
    } else if (/^[0-5]$/.test(key)) {
      const priority = ['', 'highest', 'high', 'medium', 'low', 'lowest'][Number(key)];
      this.moveCard(card, `priority:${priority}`, taskTitleOf(card) + (priority ? `: ${priority} priority.` : ': no priority.'));
    } else if (key === '[' || key === ']') {
      this.moveAcross(card, column, columns, key === ']' ? 1 : -1);
    } else if (Object.prototype.hasOwnProperty.call(asks, key)) {
      this.ask(card, asks[key]);
    } else {
      return false;
    }
    return true;
  }

  /** The keys a focused card answers, which the ? sheet lists; true when the key was one. */
  private handleCardKey(event: KeyboardEvent, card: HTMLElement): boolean {
    const column = cellOf(card) as HTMLElement;
    // A board's columns, or a lane's cells, in order.
    const columns = column.classList.contains('lane-cell')
      ? Array.from(column.parentElement?.children ?? []).filter((cell): cell is HTMLElement => cell instanceof HTMLElement && cell.classList.contains('lane-cell'))
      : Array.from(document.querySelectorAll<HTMLElement>('.task-board .board-column'));
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      this.walk(event.key, card, column, columns);
      return true;
    }
    return this.editKey(event.key, card, column, columns);
  }

  /** A choice in a card's menu: a date, a snooze, Move to…, steps, or a move, said as the menu said it. */
  private chooseFor(card: HTMLElement, groups: readonly ActionMenuGroup[], value: string): void {
    const asks: Readonly<Record<string, 'pickTaskDate' | 'pickTaskAssignee' | 'snoozeTask' | 'moveTaskTo' | 'breakIntoSteps'>> = { 'pick-date': 'pickTaskDate', 'pick-assignee': 'pickTaskAssignee', snooze: 'snoozeTask', 'move-to': 'moveTaskTo', 'break-steps': 'breakIntoSteps' };
    if (Object.prototype.hasOwnProperty.call(asks, value)) {
      this.ask(card, asks[value]);
      return;
    }
    const already = alreadyHas(card, groups, value);
    if (already) {
      announce(already);
      return;
    }
    // Said as the menu said it: "Draft spec: Priority, High."
    const group = groups.find((candidate) => candidate.items.some((item) => item.value === value));
    const chosen = group ? group.items.find((item) => item.value === value) : undefined;
    this.moveTo(card, value);
    announce(`${taskTitleOf(card)}: ${group && group.label ? `${group.label}, ` : ''}${chosen ? chosen.label : value}.`);
  }

  /** Opens a card's menu under `opener`; false when the card has none drawn. */
  private openCardMenu(card: HTMLElement, opener: HTMLElement): boolean {
    const groups = board.moves[cardKeyOf(card)];
    if (!groups) {
      return false;
    }
    openActionMenu(opener, groups, (value) => this.chooseFor(card, groups, value));
    return true;
  }

  /**
   * The Tag… menu: the namespaces in use, but the one the board is grouped
   * by; for Lanes, but the one its lanes are by too.
   */
  private pickNamespace(opener: HTMLElement, forLanes = false): void {
    const { offered, current, lanes } = this.options.namespaces();
    const choices = offered.filter((namespace) => namespace.name !== current && !(forLanes && namespace.name === lanes));
    if (!choices.length) {
      return;
    }
    openActionMenu(opener, [{
      label: forLanes ? 'Lanes by tag namespace' : 'Group by tag namespace',
      items: choices.map((namespace) => ({ value: namespace.name, label: `#${namespace.name} · ${namespace.openTasks} open ${namespace.openTasks === 1 ? 'task' : 'tasks'}` })),
    }], (name) => this.post(forLanes ? { type: 'setBoardLanes', lanes: 'tag', namespace: name } : { type: 'setBoardGroup', groupBy: 'tag', namespace: name }));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const closest = (selector: string): HTMLElement | null => (target ? target.closest<HTMLElement>(selector) : null);
    const menuButton = closest('[data-action="board-menu"]');
    if (menuButton) {
      const card = boardCard(menuButton);
      if (card) {
        this.openCardMenu(card, menuButton);
      }
      return;
    }
    const rest = closest('[data-action="show-column-rest"]');
    if (rest) {
      this.post({ type: 'showColumnRest', columnId: String(rest.dataset.columnId) });
      return;
    }
    // A column's +, or on a board with lanes a lane's, which starts the task with the lane's value.
    const add = closest('[data-action="board-add-task"]');
    if (add) {
      this.post({ type: 'addTaskToColumn', column: String(add.dataset.columnId ?? add.dataset.laneColumn ?? add.dataset.laneLane) });
      return;
    }
    if (closest('input, select, button, a')) {
      return;
    }
    const card = boardCard(target);
    if (card) {
      this.openCard(card, event);
    }
  }

  /**
   * A choice in the Group select: a grouping, sent; or Tag…, which puts the
   * select back on the grouping in force and opens the menu of namespaces,
   * whose choice is sent.
   */
  private chooseGroup(select: HTMLSelectElement): void {
    if (select.value === 'pick-namespace') {
      select.value = String(select.dataset.current);
      this.pickNamespace(select);
      return;
    }
    if (select.value !== 'tag') {
      this.post({ type: 'setBoardGroup', groupBy: select.value as never });
    }
  }

  /** A choice in the Lanes select: None or an axis, sent; or Tag…, as Group's. */
  private chooseLanes(select: HTMLSelectElement): void {
    if (select.value === 'pick-namespace') {
      select.value = String(select.dataset.current);
      this.pickNamespace(select, true);
      return;
    }
    if (select.value !== 'tag') {
      this.post({ type: 'setBoardLanes', lanes: select.value as never });
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const card = target && target.matches('.task-board .board-card') ? (target as HTMLElement) : undefined;
    if (!card) {
      return;
    }
    // Enter opens the card as a click does, Ctrl or Cmd beside the board;
    // Alt+Enter is its menu's.
    if (event.key === 'Enter' && !event.altKey) {
      this.openCard(card, event);
      return;
    }
    if (this.rankByKey(event, card)) {
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (this.handleCardKey(event, card)) {
      event.preventDefault();
    }
  }

  /**
   * The drop: the card dragged, not another copy of its task in another
   * column, moves to the column. Any drop ends the drag here, since the
   * dragend the browser sends to the card it began on never arrives when a
   * redraw took that card away.
   */
  private onDrop(event: DragEvent): void {
    const own = rankColumn(event, this.options.ranked());
    if (own) {
      event.preventDefault();
      const card = own.querySelector<HTMLElement>('.board-card.dragging');
      if (card) {
        this.rankCard(card, cardBefore(own, event.clientY, card));
      }
      endDrag();
      return;
    }
    const column = dropColumn(event);
    // A card dropped anywhere but a column is no field's to take.
    if (carriesCard(event)) {
      event.preventDefault();
    }
    if (column) {
      const card = Array.from(document.querySelectorAll<HTMLElement>(`.task-board .board-card[data-task-id="${CSS.escape(String(board.dragId))}"]`))
        .find((candidate) => (board.dragColumn === undefined || candidate.dataset.cardColumn === board.dragColumn) && candidate.dataset.cardLane === board.dragLane);
      if (card && cellOf(card) !== column) {
        this.move(card, cellColumn(column), cellLane(column));
        announce(`Moved ${taskTitleOf(card)} to ${columnTitle(column)}.`);
      }
    }
    endDrag();
  }

  public listen(): void {
    document.addEventListener('click', (event) => this.onClick(event));
    document.addEventListener('keydown', (event) => this.onKeydown(event));
    // A card reached by Tab or a click becomes the board's Tab stop.
    document.addEventListener('focusin', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const card = target && target.matches('.task-board .board-card') ? target : undefined;
      if (!card || card.getAttribute('tabindex') === '0') {
        return;
      }
      document.querySelectorAll('.task-board .board-card[tabindex="0"]').forEach((other) => other.setAttribute('tabindex', '-1'));
      card.setAttribute('tabindex', '0');
      board.tabStop = cardKeyOf(card as HTMLElement);
    });
    document.addEventListener('change', (event) => {
      if (event.target instanceof HTMLSelectElement && event.target.dataset.action === 'set-board-group') {
        this.chooseGroup(event.target);
        return;
      }
      if (event.target instanceof HTMLSelectElement && event.target.dataset.action === 'set-board-lanes') {
        this.chooseLanes(event.target);
        return;
      }
      const card = boardCard(event.target);
      const target = event.target as HTMLInputElement;
      if (card && target.dataset.action === 'board-toggle-task') {
        this.completeCard(card, target.checked);
      }
    });
    // A right-click on a card, or the menu key on a focused one, opens the
    // same menu its ⋯ does, anchored to that button.
    document.addEventListener('contextmenu', (event) => {
      const card = boardCard(event.target);
      const target = event.target as Element;
      if (!card || target.closest('[data-tag-key], a, input')) {
        return;
      }
      const button = card.querySelector<HTMLElement>('[data-action="board-menu"]');
      if (button && this.openCardMenu(card, button)) {
        event.preventDefault();
      }
    });
    listenForDrags(this.options);
    document.addEventListener('drop', (event) => this.onDrop(event));
  }
}

/**
 * The one type a card's drag carries, which tells the columns it is a
 * card: words dragged from a note carry plain text.
 */
const CARD_DRAG_TYPE = 'application/x-deckard-card';

/** Whether a drag is a card's, by the type its card put on it. */
function carriesCard(event: DragEvent): boolean {
  return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes(CARD_DRAG_TYPE));
}

/**
 * The column under a drag that takes the card being dragged, or on a board
 * with lanes the cell: another one than the card's, that does not refuse it.
 */
function dropColumn(event: DragEvent): HTMLElement | undefined {
  const column = cellOf(event.target);
  if (!column || !board.dragId || !carriesCard(event)) {
    return undefined;
  }
  if (column.classList.contains('lane-cell')) {
    const own = cellColumn(column) === board.dragColumn && cellLane(column) === board.dragLane;
    return own || column.classList.contains('is-refused') ? undefined : column;
  }
  return column.dataset.droppable === 'true' ? column : undefined;
}

function clearDropTargets(): void {
  document.querySelectorAll('.board-column.drop-target, .task-board .lane-cell.drop-target').forEach((column) => column.classList.remove('drop-target'));
}

/** Lets go of the card being dragged, if any: its marks, the columns', the cells' refusals, and which card it was. */
function endDrag(): void {
  document.querySelectorAll('.task-board .board-card.dragging').forEach((card) => card.classList.remove('dragging'));
  document.querySelectorAll('.task-board.is-dragging-card').forEach((element) => element.classList.remove('is-dragging-card'));
  document.querySelectorAll<HTMLElement>('.task-board .lane-cell.is-refused').forEach((cell) => {
    cell.classList.remove('is-refused');
    delete cell.dataset.refuses;
  });
  clearDropTargets();
  clearRankLine();
  board.dragId = undefined;
  board.dragColumn = undefined;
  board.dragLane = undefined;
}

/** On a board with lanes, each cell that will not take the card picked up says why, while it is held. */
function markRefusedCells(card: HTMLElement, rules: LaneBoardRules | undefined): void {
  const grid = card.closest('.lane-grid');
  const lane = card.dataset.cardLane;
  if (!grid || !rules || lane === undefined) {
    return;
  }
  const from = { column: String(card.dataset.cardColumn), lane };
  grid.querySelectorAll<HTMLElement>('.lane-cell').forEach((cell) => {
    const to = cellLane(cell);
    const reason = to === undefined ? undefined : refuseCellMove(from, { column: cellColumn(cell), lane: to }, rules);
    if (!reason) {
      return;
    }
    cell.classList.add('is-refused');
    cell.dataset.refuses = reason;
  });
}

/**
 * The first or last shown card of the cell above or below `cell`, in the
 * same column, past cells with none and folded lanes; undefined at the end.
 */
function nextLaneCard(cell: HTMLElement, step: number): HTMLElement | undefined {
  if (!cell.classList.contains('lane-cell')) {
    return undefined;
  }
  const column = boardCells().filter((candidate) => cellColumn(candidate) === cellColumn(cell) && !isFolded(candidate));
  for (let index = column.indexOf(cell) + step; index >= 0 && index < column.length; index += step) {
    const cards = visibleCards(column[index]);
    if (cards.length) {
      return step > 0 ? cards[0] : cards[cards.length - 1];
    }
  }
  return undefined;
}

/**
 * A card picked up, carried over the columns, and put down; the drop itself
 * is the board's. Over its own column on a ranked board, a line shows where
 * it will land instead of the column lighting up.
 */
function listenForDrags(options: Pick<BoardMovesOptions, 'ranked' | 'lanes'>): void {
  const ranked = options.ranked;
  document.addEventListener('dragstart', (event) => {
    const card = boardCard(event.target);
    // A drag of anything else lets go of a card a cut-short drag left held.
    endDrag();
    if (!card) {
      return;
    }
    listsChanged();
    board.dragId = card.dataset.taskId;
    board.dragColumn = card.dataset.cardColumn;
    board.dragLane = card.dataset.cardLane;
    card.classList.add('dragging');
    // The columns, or cells, that will not take the card say so while it is held.
    card.closest('.task-board')?.classList.add('is-dragging-card');
    markRefusedCells(card, options.lanes());
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    // The card's own type alone: plain text would be typed into a field it
    // was dropped on, the search box's included, as its task's id.
    event.dataTransfer.setData(CARD_DRAG_TYPE, String(board.dragId));
  });
  document.addEventListener('dragend', (event) => {
    boardCard(event.target)?.classList.remove('dragging');
    endDrag();
  });
  document.addEventListener('dragover', (event) => {
    const own = rankColumn(event, ranked());
    if (own) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      clearDropTargets();
      showRankLine(own, cardBefore(own, event.clientY, own.querySelector<HTMLElement>('.board-card.dragging') ?? undefined));
      return;
    }
    clearRankLine();
    const column = dropColumn(event);
    if (!column) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (column.classList.contains('drop-target')) {
      return;
    }

    clearDropTargets();
    column.classList.add('drop-target');
  });
  document.addEventListener('dragleave', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const column = target ? target.closest(CELL_SELECTOR) : null;
    if (column && !column.contains(event.relatedTarget as Node | null)) {
      column.classList.remove('drop-target');
    }
  });
}

/**
 * Wires every task board on the page, once: openSource, toggleTask,
 * moveTask, setBoardGroup, and the rest go through `options.post`.
 */
export function installBoardMoves(options: BoardMovesOptions): void {
  new BoardMoves(options).listen();
}
