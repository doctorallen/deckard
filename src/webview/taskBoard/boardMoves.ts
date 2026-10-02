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
  if (counter) {
    counter.textContent = described.count;
  }
  column.setAttribute('aria-label', described.name);
  column.classList.toggle('over-limit', limit !== undefined && count > limit);
}

/**
 * A move shows at once: the card goes to the top of its new column, both
 * counts change, and it is marked pending until the host's next state
 * replaces the board. A move to a column this grouping does not draw, such
 * as a priority on a status board, marks the card where it is.
 */
function applyMove(card: HTMLElement, columnId: string): void {
  listsChanged();
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
  card.classList.add('is-pending');
  card.setAttribute('aria-busy', 'true');
  focusCard(card);
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

  private completeCard(card: HTMLElement, completed: boolean): void {
    this.post({ type: 'toggleTask', taskId: String(card.dataset.taskId), completed });
    announce(`${completed ? 'Completed ' : 'Reopened '}${taskTitleOf(card)}.`);
    if (!(completed && !reducedMotion())) {
      return;
    }

    listsChanged();
    card.classList.add('is-completing');
    board.lingerUntil = Date.now() + 800;
  }

  private moveCard(card: HTMLElement, column: string, said: string): void {
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
    // Said as the menu said it: "Draft spec: Priority, High."
    const group = groups.find((candidate) => candidate.items.some((item) => item.value === value));
    const chosen = group ? group.items.find((item) => item.value === value) : undefined;
    if (chosen && chosen.checked) {
      announce(`${taskTitleOf(card)}: ${(group && group.label) || 'It'} is already ${chosen.label}.`);
      return;
    }
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

  /** The drop: the card dragged, not another copy of its task in another column, moves to the column. */
  private onDrop(event: DragEvent): void {
    const column = dropColumn(event);
    if (!column) {
      return;
    }
    event.preventDefault();
    const card = Array.from(document.querySelectorAll<HTMLElement>(`.task-board .board-card[data-task-id="${CSS.escape(String(board.dragId))}"]`))
      .find((candidate) => board.dragColumn === undefined || candidate.dataset.cardColumn === board.dragColumn);
    if (card && card.closest('.board-column') !== column) {
      const from = String(card.dataset.cardColumn);
      applyMove(card, String(column.dataset.columnId));
      this.post({ type: 'moveTask', taskId: String(board.dragId), column: String(column.dataset.columnId), from });
      announce(`Moved ${taskTitleOf(card)} to ${columnTitle(column)}.`);
    }
    clearDropTargets();
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

/** The column under a drag that takes the card being dragged. */
function dropColumn(event: DragEvent): HTMLElement | undefined {
  const target = event.target instanceof Element ? event.target : null;
  const column = target ? target.closest<HTMLElement>('.task-board .board-column') : null;
  return column && board.dragId && column.dataset.droppable === 'true' ? column : undefined;
}

function clearDropTargets(): void {
  document.querySelectorAll('.board-column.drop-target').forEach((column) => column.classList.remove('drop-target'));
}

/** A card picked up, carried over the columns, and put down; the drop itself is the board's. */
function listenForDrags(): void {
  document.addEventListener('dragstart', (event) => {
    const card = boardCard(event.target);
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
    event.dataTransfer.setData('text/plain', String(board.dragId));
  });
  document.addEventListener('dragend', (event) => {
    boardCard(event.target)?.classList.remove('dragging');
    document.querySelectorAll('.task-board.is-dragging-card').forEach((element) => element.classList.remove('is-dragging-card'));
    clearDropTargets();
    board.dragId = undefined;
    board.dragColumn = undefined;
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
