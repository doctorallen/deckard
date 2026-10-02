/**
 * Moving cards: a card's keys, its menu, its checkbox, opening it, and
 * dragging it between columns. A move shows at once, and the host's next
 * state confirms it or puts the card back. Listeners sit on the document,
 * installed once, so the page may draw its board freely.
 */
import type { TaskBoardMessage } from '../../ui/protocol/taskBoard';
import { type ActionMenuGroup, openActionMenu } from '../shared/actionMenu';
import { openSourceMessage } from '../shared/openSource';
import { announce } from '../shared/status';
import { taskTitleOf } from '../shared/taskRow';
import { describeBoardColumn } from './board';
import { board, cardKeyOf, listsChanged } from './model';

/** Sends the host one of the board's messages. */
type Post = (message: TaskBoardMessage) => void;

/** What the board's moves read of the page: how it posts, and the namespaces its Tag… menu offers. */
export interface BoardMovesOptions {
  readonly post: Post;
  /** The namespaces open tasks carry, and the one the board is grouped by, if any. */
  readonly namespaces: () => { readonly offered: ReadonlyArray<{ name: string; openTasks: number }>; readonly current: string | undefined };
}

/** The card an element is in, on the board. */
function boardCard(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.task-board .board-card') : null;
}

/** Whether the reader asked for less motion. */
function reducedMotion(): boolean {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** The cards of a column that the words being typed have not hidden. */
function visibleCards(column: Element): HTMLElement[] {
  return Array.from(column.querySelectorAll<HTMLElement>('.board-card')).filter((card) => !card.hidden);
}

/** A column's name, from its title. */
function columnTitle(column: Element | null | undefined): string {
  const title = column && column.querySelector('.board-column-title span');
  return title ? String(title.textContent) : 'the column';
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
  const title = column.querySelector('.board-column-title span');
  const cards = visibleCards(column);
  const count = cards.length + Number(column.dataset.hiddenCount || 0);
  const id = column.dataset.columnId;
  const overdue = id === 'done' || id === 'due:overdue'
    ? 0
    : cards.filter((card) => card.querySelector('.board-details .overdue') && !card.classList.contains('completed')).length;
  const limit = column.dataset.limit === undefined ? undefined : Number(column.dataset.limit);
  const described = describeBoardColumn(title ? String(title.textContent) : '', count, limit, overdue);
  const counter = column.querySelector('.board-count');
  // Written only when it changed, so the text the draw made stays the one
  // the next draw updates.
  if (counter && counter.textContent !== described.count) {
    counter.textContent = described.count;
  }
  column.setAttribute('aria-label', described.name);
  column.classList.toggle('over-limit', limit !== undefined && count > limit);
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
  const stop = document.querySelector<HTMLElement>('.task-board .board-card[tabindex="0"]');
  const first = document.querySelector<HTMLElement>('.task-board .board-card:not([hidden])');
  if ((stop && !stop.hidden) || !first) {
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
 * A move shows at once: the card goes to the top of its new column, both
 * counts change, and it is marked pending until the host's next state
 * replaces the board. A move to a column this grouping does not draw, such
 * as a priority on a status board, marks the card where it is. Its menu
 * goes with it, under the card's new key, so its ⋯ opens before the host
 * answers.
 */
function applyMove(card: HTMLElement, columnId: string): void {
  listsChanged();
  const groups = board.moves[cardKeyOf(card)];
  const from = card.closest<HTMLElement>('.board-column');
  const to = Array.from(document.querySelectorAll<HTMLElement>('.task-board .board-column')).find((column) => column.dataset.columnId === columnId);
  if (to && to !== from) {
    const cards = to.querySelector('.board-cards');
    cards?.querySelector('.board-empty')?.remove();
    cards?.prepend(card);
    // It is this column's card now, for its key and its focus.
    card.setAttribute('data-card-column', columnId);
    board.tabStop = cardKeyOf(card);
    recountColumn(from);
    recountColumn(to);
  }
  if (groups) {
    board.moves[cardKeyOf(card)] = movedMenu(groups, columnId);
  }
  card.classList.add('is-pending');
  card.setAttribute('aria-busy', 'true');
  focusCard(card);
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

/** The board's moves, wired once by `installBoardMoves`. */
class BoardMoves {
  public constructor(private readonly options: BoardMovesOptions) {}

  private post(message: TaskBoardMessage): void {
    this.options.post(message);
  }

  private openCard(card: HTMLElement, event?: MouseEvent): void {
    this.post(openSourceMessage(card, event));
  }

  /**
   * Completes or reopens a card's task. The card says so at once, as a move
   * does, so a second x before the host answers reopens it rather than
   * completing it again.
   */
  private completeCard(card: HTMLElement, completed: boolean): void {
    this.post({ type: 'toggleTask', taskId: String(card.dataset.taskId), completed });
    const title = taskTitleOf(card);
    announce(`${completed ? 'Completed ' : 'Reopened '}${title}.`);
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
    const from = String(card.dataset.cardColumn);
    applyMove(card, column);
    this.post({ type: 'moveTask', taskId: String(card.dataset.taskId), column, from });
    announce(said);
  }

  /** The arrows, Home, and End between cards. */
  private walk(key: string, card: HTMLElement, column: HTMLElement, columns: HTMLElement[]): void {
    const cards = visibleCards(column);
    const at = cards.indexOf(card);
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      focusCard(cards[at + (key === 'ArrowDown' ? 1 : -1)]);
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

  /** Moves a card to the droppable column to its left or right, if there is one. */
  private moveAcross(card: HTMLElement, column: HTMLElement, columns: HTMLElement[], step: number): void {
    const droppable = columns.filter((candidate) => candidate.dataset.droppable === 'true');
    const target = droppable[droppable.indexOf(column) + step];
    if (target && droppable.includes(column)) {
      this.moveCard(card, String(target.dataset.columnId), `Moved ${taskTitleOf(card)} to ${columnTitle(target)}.`);
    }
  }

  /** The single keys that edit a focused card; true when the key was one. */
  private editKey(key: string, card: HTMLElement, column: HTMLElement, columns: HTMLElement[]): boolean {
    const taskId = String(card.dataset.taskId);
    const asks: Readonly<Record<string, TaskBoardMessage>> = {
      d: { type: 'pickTaskDate', taskId },
      e: { type: 'editTask', taskId },
      s: { type: 'breakIntoSteps', taskId },
    };
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
      this.post(asks[key]);
    } else {
      return false;
    }
    return true;
  }

  /** The keys a focused card answers, which the ? sheet lists; true when the key was one. */
  private handleCardKey(event: KeyboardEvent, card: HTMLElement): boolean {
    const column = card.closest<HTMLElement>('.board-column') as HTMLElement;
    const columns = Array.from(document.querySelectorAll<HTMLElement>('.task-board .board-column'));
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      this.walk(event.key, card, column, columns);
      return true;
    }
    return this.editKey(event.key, card, column, columns);
  }

  /** A choice in a card's menu: a date, Move to…, steps, or a move, said as the menu said it. */
  private chooseFor(card: HTMLElement, groups: readonly ActionMenuGroup[], value: string): void {
    const taskId = String(card.dataset.taskId);
    if (value === 'pick-date') {
      this.post({ type: 'pickTaskDate', taskId });
      return;
    }
    if (value === 'move-to') {
      this.post({ type: 'moveTaskTo', taskId });
      return;
    }
    if (value === 'break-steps') {
      this.post({ type: 'breakIntoSteps', taskId });
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
    const from = String(card.dataset.cardColumn);
    applyMove(card, value);
    this.post({ type: 'moveTask', taskId, column: value, from });
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

  /** The Tag… menu: the namespaces in use, but the one the board is grouped by. */
  private pickNamespace(button: HTMLElement): void {
    const { offered, current } = this.options.namespaces();
    const choices = offered.filter((namespace) => namespace.name !== current);
    if (!choices.length) {
      return;
    }
    openActionMenu(button, [{
      label: 'Group by tag namespace',
      items: choices.map((namespace) => ({ value: namespace.name, label: `#${namespace.name} · ${namespace.openTasks} open ${namespace.openTasks === 1 ? 'task' : 'tasks'}` })),
    }], (name) => this.post({ type: 'setBoardGroup', groupBy: 'tag', namespace: name }));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const closest = (selector: string): HTMLElement | null => (target ? target.closest<HTMLElement>(selector) : null);
    const group = closest('[data-action="set-board-group"]');
    if (group) {
      this.post({ type: 'setBoardGroup', groupBy: group.dataset.group as never });
      return;
    }
    const namespaceButton = closest('[data-action="pick-board-namespace"]');
    if (namespaceButton) {
      this.pickNamespace(namespaceButton);
      return;
    }
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
    const add = closest('[data-action="board-add-task"]');
    if (add) {
      this.post({ type: 'addTaskToColumn', column: String(add.dataset.columnId) });
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

  private onKeydown(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const card = target && target.matches('.task-board .board-card') ? (target as HTMLElement) : undefined;
    if (!card || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (event.key === 'Enter') {
      this.openCard(card);
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
    const column = dropColumn(event);
    if (column) {
      event.preventDefault();
      const card = Array.from(document.querySelectorAll<HTMLElement>(`.task-board .board-card[data-task-id="${CSS.escape(String(board.dragId))}"]`))
        .find((candidate) => board.dragColumn === undefined || candidate.dataset.cardColumn === board.dragColumn);
      if (card && card.closest('.board-column') !== column) {
        const from = String(card.dataset.cardColumn);
        applyMove(card, String(column.dataset.columnId));
        this.post({ type: 'moveTask', taskId: String(board.dragId), column: String(column.dataset.columnId), from });
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
    listenForDrags();
    document.addEventListener('drop', (event) => this.onDrop(event));
  }
}

/**
 * The type a card's drag carries, besides its plain text, which tells the
 * columns it is a card: words dragged from a note carry plain text too.
 */
const CARD_DRAG_TYPE = 'application/x-deckard-card';

/** Whether a drag is a card's, by the type its card put on it. */
function carriesCard(event: DragEvent): boolean {
  return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes(CARD_DRAG_TYPE));
}

/** The column under a drag that takes the card being dragged. */
function dropColumn(event: DragEvent): HTMLElement | undefined {
  const target = event.target instanceof Element ? event.target : null;
  const column = target ? target.closest<HTMLElement>('.task-board .board-column') : null;
  return column && board.dragId && carriesCard(event) && column.dataset.droppable === 'true' ? column : undefined;
}

function clearDropTargets(): void {
  document.querySelectorAll('.board-column.drop-target').forEach((column) => column.classList.remove('drop-target'));
}

/** Lets go of the card being dragged, if any: its marks, the columns', and which card it was. */
function endDrag(): void {
  document.querySelectorAll('.task-board .board-card.dragging').forEach((card) => card.classList.remove('dragging'));
  document.querySelectorAll('.task-board.is-dragging-card').forEach((element) => element.classList.remove('is-dragging-card'));
  clearDropTargets();
  board.dragId = undefined;
  board.dragColumn = undefined;
}

/** A card picked up, carried over the columns, and put down; the drop itself is the board's. */
function listenForDrags(): void {
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
    card.classList.add('dragging');
    // The columns that will not take the card say so while it is held.
    card.closest('.task-board')?.classList.add('is-dragging-card');
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(CARD_DRAG_TYPE, String(board.dragId));
    event.dataTransfer.setData('text/plain', String(board.dragId));
  });
  document.addEventListener('dragend', (event) => {
    boardCard(event.target)?.classList.remove('dragging');
    endDrag();
  });
  document.addEventListener('dragover', (event) => {
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
    const column = target ? target.closest('.board-column') : null;
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
