/**
 * Rows a reader ranks by dragging them, or from their context menu: Move
 * up, Move down, and to either end, so any place in the order is reachable
 * without dragging (WCAG 2.5.7). The Task Board's ranked list and its
 * status columns use them, and Home's widgets will.
 *
 * Listeners sit on the document, so a page may draw its rows freely. A
 * drag moves a copy of the row, the ghost, a layer of the body outside
 * `#app`, and holds the row's place with a placeholder in its list; the
 * rank menu is a layer of the body too, its contents a render root.
 */
import { render } from 'preact';

import { announce } from './status';
import { isMenuKey, returnFocusFromMenu } from './menuKeys';

/** One kind of ranked row: its selector, the dataset key that names a row, and the menu's two edge labels. */
export interface RankedRowKind {
  readonly selector: string;
  readonly key: string;
  /** The menu's labels for the two ends, first then last; Move to top and Move to bottom unless given. */
  readonly edgeLabels?: readonly [string, string];
  /**
   * The part of the page a row moves within one place at a time, such as
   * the Tags tab's favorites or the rest; the whole page unless given.
   */
  readonly group?: string;
}

/** One more row of a rank menu, which `onMenuAction` runs. */
export interface ContextMenuAction {
  readonly action: string;
  readonly label: string;
}

/** A row ranked next to another: its kind and key, the row it goes beside, and on which side. */
export interface RowMove {
  readonly kind: string;
  readonly key: string;
  readonly targetKey: string;
  readonly before: boolean;
  /** The element that says where the row landed: the drag's placeholder, or the row itself for one step. */
  readonly placeholder?: Element;
}

/** What a page tells its ranked rows. */
export interface RankedRowsOptions {
  readonly kinds: Readonly<Record<string, RankedRowKind>>;
  /** Whether rows of this kind can be ranked now. */
  readonly canRank: (kind: string) => boolean;
  /** Ranks a row next to another, before or after it; true when it did. */
  readonly reorder: (move: RowMove) => boolean;
  /** Ranks `key` first or last. */
  readonly move: (kind: string, key: string, toTop: boolean) => void;
  /** More rows for the menu, before the moves. */
  readonly menuActions?: (kind: string, key: string) => ContextMenuAction[];
  /** Runs one of those. */
  readonly onMenuAction?: (action: string, kind: string, key: string) => void;
  /**
   * Told when a drag starts changing the rows' list outside a draw, with its
   * placeholder and, once dropped, the row where the placeholder was, so the
   * page draws that list afresh the next time rather than patching it.
   */
  readonly onListChanged?: () => void;
}

/** One row of a context menu, as every menu draws it. */
export function ContextMenuItem({ action, label }: ContextMenuAction) {
  return (
    <button type="button" class="menu-item" role="menuitem" data-context-action={action}>
      <span class="menu-label">{label}</span>
    </button>
  );
}

/** The rank menu's element, made the first time it opens. */
let rankMenu: HTMLElement | undefined;
let rankMenuKind: string | undefined;
let rankMenuKey: string | undefined;

/** Closes the rank menu, giving focus back to where a keyboard opened it. */
export function closeRankMenu(): void {
  const wasOpen = Boolean(rankMenu && !rankMenu.hidden);
  if (rankMenu) {
    rankMenu.hidden = true;
  }
  rankMenuKind = undefined;
  rankMenuKey = undefined;
  if (wasOpen) {
    returnFocusFromMenu();
  }
}

/** Where a menu opens: where the pointer was, or under the row the keyboard opened it from. */
interface MenuPlace {
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

/** A row being pressed, and once it moves, dragged. */
interface Drag {
  readonly row: HTMLElement;
  readonly kind: string;
  readonly key: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  active: boolean;
}

/**
 * Moves `key` before or after `targetKey` in `keys`, for a drag that ranked
 * it. Returns the new order, or undefined when either is missing.
 */
export function rankKeys(keys: readonly string[], key: string, targetKey: string, before: boolean): string[] | undefined {
  const from = keys.indexOf(key);
  const to = keys.indexOf(targetKey);
  if (from < 0 || to < 0) {
    return undefined;
  }
  const next = keys.slice();
  const insertion = to + (before ? 0 : 1);
  next.splice(from, 1);
  next.splice(insertion > from ? insertion - 1 : insertion, 0, key);
  return next;
}

/** Moves `key` to the start or end of `keys`, or undefined when it is not there. */
export function moveKeyToEdge(keys: readonly string[], key: string, toTop: boolean): string[] | undefined {
  if (!keys.includes(key)) {
    return undefined;
  }
  const next = keys.filter((candidate) => candidate !== key);
  if (toTop) {
    next.unshift(key);
  } else {
    next.push(key);
  }
  return next;
}

/** The ranked rows of a page, wired once by `installRankedRows`. */
class RankedRows {
  private readonly names: string[];
  private readonly rowSelector: string;
  private readonly keyAttributes: string[];
  private drag: Drag | undefined;
  private ghost: HTMLElement | undefined;
  private placeholder: HTMLElement | undefined;
  private dropTarget: HTMLElement | undefined;
  private dropBefore = true;
  private suppressClick = false;

  public constructor(private readonly options: RankedRowsOptions) {
    this.names = Object.keys(options.kinds);
    this.rowSelector = this.names.map((name) => options.kinds[name].selector).join(', ');
    this.keyAttributes = [
      ...this.names.map((name) => `data-${options.kinds[name].key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`),
      'data-file-path',
      'data-line',
    ];
  }

  private kindOf(row: Element): string | undefined {
    return this.names.find((name) => row.matches(this.options.kinds[name].selector));
  }

  private keyOf(row: HTMLElement, kind: string): string | undefined {
    return row.dataset[this.options.kinds[kind].key];
  }

  /** A copy of a row with nothing that names it, which nothing can act on. */
  private strip(element: HTMLElement): void {
    element.classList.remove('is-dragging');
    element.removeAttribute('draggable');
    this.keyAttributes.forEach((attribute) => element.removeAttribute(attribute));
    element.setAttribute('aria-hidden', 'true');
  }

  private clearPreview(): void {
    this.ghost?.remove();
    this.placeholder?.remove();
    this.ghost = undefined;
    this.placeholder = undefined;
    this.dropTarget = undefined;
    document.querySelectorAll('.is-dragging').forEach((row) => row.classList.remove('is-dragging'));
  }

  /** The drag starts: the ghost follows the pointer, and a placeholder holds the row's place. */
  private begin(event: PointerEvent, drag: Drag): void {
    this.clearPreview();
    const row = drag.row;
    const ghost = row.cloneNode(true) as HTMLElement;
    this.strip(ghost);
    ghost.classList.add('drag-ghost');
    const bounds = row.getBoundingClientRect();
    ghost.style.width = `${bounds.width}px`;
    ghost.style.height = `${bounds.height}px`;
    document.body.appendChild(ghost);
    this.ghost = ghost;
    const placeholder = row.cloneNode(true) as HTMLElement;
    this.strip(placeholder);
    placeholder.removeAttribute('tabindex');
    placeholder.classList.add('drag-placeholder');
    placeholder.querySelectorAll('[data-action], button, input, [tabindex]').forEach((element) => {
      element.removeAttribute('data-action');
      this.keyAttributes.forEach((attribute) => element.removeAttribute(attribute));
      element.setAttribute('tabindex', '-1');
    });
    this.placeholder = placeholder;
    if (row.parentElement) {
      row.parentElement.insertBefore(placeholder, row);
    }
    this.options.onListChanged?.();
    row.classList.add('is-dragging');
    drag.active = true;
    this.follow(event.clientX, event.clientY, drag);
  }

  /** The ghost follows the pointer, and the placeholder moves before or after the row under it. */
  private follow(clientX: number, clientY: number, drag: Drag): void {
    if (this.ghost) {
      this.ghost.style.left = `${clientX + 12}px`;
      this.ghost.style.top = `${clientY + 12}px`;
    }
    const element = document.elementFromPoint(clientX, clientY);
    const row = element ? element.closest<HTMLElement>(this.options.kinds[drag.kind].selector) : null;
    if (!row || row === drag.row || this.keyOf(row, drag.kind) === drag.key) {
      return;
    }
    const bounds = row.getBoundingClientRect();
    const before = clientY < bounds.top + bounds.height / 2;
    if (this.dropTarget === row && this.dropBefore === before) {
      return;
    }
    this.dropTarget = row;
    this.dropBefore = before;
    const insertionPoint = before ? row : row.nextSibling;
    if (this.placeholder && row.parentElement && insertionPoint !== this.placeholder) {
      row.parentElement.insertBefore(this.placeholder, insertionPoint);
    }
  }

  /** The pointer is let go: a drag that moved ranks the row where it was dropped, unless canceled. */
  private finish(event: PointerEvent, canceled: boolean): void {
    const current = this.drag;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }
    if (current.row.hasPointerCapture && current.row.hasPointerCapture(event.pointerId)) {
      current.row.releasePointerCapture(event.pointerId);
    }
    if (!current.active) {
      this.drag = undefined;
      return;
    }
    let dropped = false;
    if (!canceled) {
      this.follow(event.clientX, event.clientY, current);
      const targetKey = this.dropTarget ? this.keyOf(this.dropTarget, current.kind) : undefined;
      dropped = Boolean(targetKey) && targetKey !== current.key && this.options.canRank(current.kind)
        && this.options.reorder({ kind: current.kind, key: current.key, targetKey: String(targetKey), before: this.dropBefore, placeholder: this.placeholder }) === true;
      this.suppressClick = true;
    }
    if (dropped) {
      this.placeDropped(current.row);
    }
    this.clearPreview();
    this.drag = undefined;
  }

  /**
   * A dropped row takes the placeholder's place until the host answers. A
   * draw that came in mid-drag made the list afresh without the row, and the
   * placeholder may have followed the pointer into the new list: the row
   * put there would be a second copy of one the new list already draws, so
   * the page is told its list changed and draws it afresh instead.
   */
  private placeDropped(row: HTMLElement): void {
    const placeholder = this.placeholder;
    if (!placeholder || !placeholder.parentElement) {
      return;
    }
    if (row.isConnected && placeholder.isConnected) {
      placeholder.parentElement.insertBefore(row, placeholder);
      row.classList.remove('is-dragging');
    } else {
      this.options.onListChanged?.();
    }
  }

  /**
   * Moves a row one place, past the row of its kind above or below it in
   * its group. A row at the edge of its group stays: past the edge is a row
   * the page keeps apart, such as a favorite, and the page would put it
   * back where it was while saying it moved.
   */
  private step(kind: string, key: string, up: boolean): void {
    if (!this.options.canRank(kind)) {
      return;
    }
    const { selector, group } = this.options.kinds[kind];
    const all = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((candidate) =>
      !candidate.classList.contains('drag-placeholder') && !candidate.classList.contains('drag-ghost'));
    const row = all.find((candidate) => this.keyOf(candidate, kind) === key);
    const within = row && group ? row.closest(group) : null;
    const rows = within ? all.filter((candidate) => within.contains(candidate)) : all;
    const target = row ? rows[rows.indexOf(row) + (up ? -1 : 1)] : undefined;
    if (!row || !target) {
      return;
    }
    // The row stands in for the drop placeholder, which says which group a
    // row lands in; one step never leaves its group.
    if (this.options.reorder({ kind, key, targetKey: String(this.keyOf(target, kind)), before: up, placeholder: row }) === true) {
      announce(`Moved ${up ? 'up' : 'down'}.`);
    }
  }

  /** The rows of a row's menu: the page's own, then the moves while it can be ranked. */
  private menuActions(kind: string, key: string): ContextMenuAction[] {
    const actions = this.options.menuActions ? this.options.menuActions(kind, key) : [];
    if (this.options.canRank(kind)) {
      const labels = this.options.kinds[kind].edgeLabels || ['Move to top', 'Move to bottom'];
      // One step at a time as well as to either end, so any place in the
      // order is reachable without dragging (WCAG 2.5.7).
      actions.push({ action: 'up', label: 'Move up' }, { action: 'down', label: 'Move down' }, { action: 'top', label: labels[0] }, { action: 'bottom', label: labels[1] });
    }
    return actions;
  }

  /** Opens a row's menu where the pointer was, or under the row. */
  private openMenu(event: MenuPlace, row: HTMLElement): void {
    const kind = this.kindOf(row);
    const key = kind ? this.keyOf(row, kind) : undefined;
    if (!kind || !key) {
      return;
    }
    const actions = this.menuActions(kind, key);
    if (!actions.length) {
      return;
    }
    event.preventDefault();
    closeRankMenu();
    if (!rankMenu) {
      rankMenu = document.createElement('div');
      rankMenu.setAttribute('id', 'rank-context-menu');
      rankMenu.setAttribute('class', 'rank-context-menu popover');
      rankMenu.setAttribute('role', 'menu');
      document.body.appendChild(rankMenu);
    }
    rankMenuKind = kind;
    rankMenuKey = key;
    render(<>{actions.map((item) => <ContextMenuItem action={item.action} label={item.label} />)}</>, rankMenu);
    rankMenu.hidden = false;
    const bounds = rankMenu.getBoundingClientRect();
    rankMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
    rankMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
    rankMenu.querySelector('button')?.focus();
  }

  /** A choice in the rank menu, for the row it was opened on. */
  private choose(action: string): void {
    const kind = rankMenuKind;
    const key = rankMenuKey;
    closeRankMenu();
    if (!kind || !key) {
      return;
    }
    if (action === 'top' || action === 'bottom') {
      if (this.options.canRank(kind)) {
        this.options.move(kind, key, action === 'top');
      }
    } else if (action === 'up' || action === 'down') {
      this.step(kind, key, action === 'up');
    } else {
      this.options.onMenuAction?.(action, kind, key);
    }
  }

  /** A choice in the rank menu; a click elsewhere closes it; the click a drag ends with is not a click on the row. */
  private onClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const chosen = target ? target.closest<HTMLElement>('#rank-context-menu [data-context-action]') : null;
    if (chosen) {
      this.choose(String(chosen.dataset.contextAction));
      return;
    }
    if (rankMenu && !(target && target.closest('#rank-context-menu'))) {
      closeRankMenu();
    }
    if (!this.suppressClick) {
      return;
    }
    this.suppressClick = false;
    if (!(target && target.closest(this.rowSelector))) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** Escape closes the menu; Alt+Up and Alt+Down move a row; the menu keys open its menu. */
  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && rankMenu && !rankMenu.hidden) {
      closeRankMenu();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    // Alt+Up and Alt+Down move the focused row one place.
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && target && target.matches(this.rowSelector)) {
      const kind = this.kindOf(target);
      if (kind) {
        event.preventDefault();
        this.step(kind, String(this.keyOf(target as HTMLElement, kind)), event.key === 'ArrowUp');
      }
      return;
    }
    // Reordering was a drag or a right-click, so a keyboard could reach
    // neither. The shared listener raises a contextmenu event for these keys
    // first, which this menu's own listener answers; nothing to do twice.
    if (!isMenuKey(event) || event.defaultPrevented) {
      return;
    }
    const row = target ? target.closest<HTMLElement>(this.rowSelector) : null;
    if (!row) {
      return;
    }
    const bounds = row.getBoundingClientRect();
    this.openMenu({ preventDefault: () => event.preventDefault(), clientX: bounds.left + 12, clientY: bounds.top + bounds.height }, row);
  }

  /** A press on a row that can be ranked may start a drag, once it moves five pixels. */
  private onPointerDown(event: PointerEvent): void {
    this.suppressClick = false;
    const target = event.target instanceof Element ? event.target : null;
    const row = target ? target.closest<HTMLElement>(this.rowSelector) : null;
    if (!row || event.button !== 0 || this.drag) {
      return;
    }
    // A control inside a row, such as a widget's gear, keeps its click: a
    // drag would capture the pointer and take the click away from it.
    if (target && target.closest('button, input, select, textarea, a, summary, label, [data-action]')) {
      return;
    }
    const kind = this.kindOf(row);
    if (!kind || !row.classList.contains('is-draggable') || !this.options.canRank(kind)) {
      return;
    }
    this.drag = { row, kind, key: String(this.keyOf(row, kind)), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
    if (row.setPointerCapture) {
      row.setPointerCapture(event.pointerId);
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) {
        return;
      }
      this.begin(event, drag);
    }
    event.preventDefault();
    this.follow(event.clientX, event.clientY, drag);
  }

  public listen(): void {
    document.addEventListener('click', (event) => this.onClick(event), true);
    document.addEventListener('keydown', (event) => this.onKeydown(event));
    document.addEventListener('contextmenu', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target ? target.closest<HTMLElement>(this.rowSelector) : null;
      if (row) {
        this.openMenu(event, row);
      }
    });
    document.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    document.addEventListener('pointerup', (event) => this.finish(event, false));
    document.addEventListener('pointercancel', (event) => this.finish(event, true));
  }
}

/**
 * Wires a page's ranked rows, once. Each kind of row is ranked by dragging
 * it, by Alt+Up and Alt+Down, or from its menu.
 */
export function installRankedRows(options: RankedRowsOptions): void {
  new RankedRows(options).listen();
}
