/**
 * The reader's place across a redraw.
 *
 * A redraw that removes the element holding keyboard focus drops focus to
 * the page itself: tick a card's checkbox, or move it from its menu, and the
 * next Tab started again from the top. What had focus is found again by
 * what it is about (a task, a tag, a widget) and what it does; failing
 * that, the entry it was in; failing that, the entry that took its place in
 * the list, so completing a task leaves focus on the next. An element the
 * redraw kept keeps its focus, and is left alone.
 */

/** The data attributes that say what a focused element is about and does, in the order a selector names them. */
const PLACE_KEYS = ['taskId', 'cardColumn', 'tagKey', 'widgetId', 'columnId', 'status', 'filePath', 'line', 'action', 'value', 'kind', 'section', 'date'];

/** The kinds of entry a focused element may sit in, by the data attribute that names each. */
const PLACE_ITEMS: ReadonlyArray<readonly [string, string]> = [['taskId', '[data-task-id]'], ['tagKey', '[data-tag-key]'], ['filePath', '[data-file-path]']];

/** Where focus was before a redraw, as `readPlace` found it. */
export interface Place {
  readonly tag: string;
  /** The focused element's place keys, as a selector; empty when it has none. */
  readonly selector: string;
  /** Whether that selector named only the focused element. */
  readonly unique: boolean;
  /** The selector of the kind of entry it sat in, if it sat in one. */
  itemKind?: string;
  /** The entry's own place keys, as a selector. */
  item?: string;
  /** Whether the focused element was inside the entry rather than the entry itself. */
  inItem?: boolean;
  /** The entry's position among the entries of its kind. */
  index?: number;
  /** A text field's selection, to put back with its focus. */
  selectionStart?: number | null;
  selectionEnd?: number | null;
}

/** An element's place keys as an attribute selector, values escaped. */
function placeSelector(element: HTMLElement): string {
  return PLACE_KEYS.filter((key) => element.dataset[key] !== undefined).map((key) => {
    const attribute = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return `[data-${attribute}="${String(element.dataset[key]).replace(/["\\]/g, '\\$&')}"]`;
  }).join('');
}

/** What in an entry takes focus: the entry itself when it can, or its first control. */
function focusTarget(element: Element | null): HTMLElement | null {
  if (!element) {
    return null;
  }
  if (element.matches('button, input, select, textarea, a[href], [tabindex]')) {
    return element as HTMLElement;
  }
  return element.querySelector<HTMLElement>('[tabindex="0"], button, input, a[href]');
}

/** The entry around the focused element, as `readPlace` keeps it. */
function readItem(active: HTMLElement): Pick<Place, 'itemKind' | 'item' | 'inItem' | 'index'> {
  const itemKind = PLACE_ITEMS.find((kind) => active.closest(kind[1]));
  if (!itemKind) {
    return {};
  }
  const item = active.closest<HTMLElement>(itemKind[1]) as HTMLElement;
  return {
    itemKind: itemKind[1],
    item: placeSelector(item),
    inItem: item !== active,
    index: Array.prototype.indexOf.call(document.querySelectorAll(itemKind[1]), item),
  };
}

/**
 * Where keyboard focus is now, to find again after a redraw, or null when
 * focus is on the page itself or in an open menu, which keeps its own focus
 * and closes on a redraw.
 */
export function readPlace(): Place | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || !active.matches || !active.dataset) {
    return null;
  }
  if (active.closest('[role="menu"]')) {
    return null;
  }
  const tag = active.tagName.toLowerCase();
  const selector = placeSelector(active);
  const place: Place = {
    tag,
    selector,
    unique: Boolean(selector) && document.querySelectorAll(tag + selector).length === 1,
    ...readItem(active),
  };
  if (active.matches('input[type="text"], input[type="search"], textarea')) {
    const field = active as HTMLInputElement;
    place.selectionStart = field.selectionStart;
    place.selectionEnd = field.selectionEnd;
  }
  return place;
}

/** Whether an element is still in the page, and not only still in a removed subtree. */
function isOnPage(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node === document.body) {
      return true;
    }
    if (node.parentElement && Array.prototype.indexOf.call(node.parentElement.children, node) < 0) {
      return false;
    }
  }
  return false;
}

/** The element a place names after a redraw, by what it was or the entry it was in. */
function findByWhat(place: Place, item: Element | null): HTMLElement | null {
  let target: HTMLElement | null = null;
  if (item && place.inItem && place.selector) {
    target = item.querySelector<HTMLElement>(place.tag + place.selector);
  }
  if (!target && item && !place.inItem) {
    target = item as HTMLElement;
  }
  if (!target && place.unique) {
    target = document.querySelector<HTMLElement>(place.tag + place.selector);
  }
  if (!target && item) {
    target = focusTarget(item);
  }
  return target;
}

/**
 * The element a place names after a redraw: by what it was, the entry it
 * was in, or, failing both, the entry now at its index.
 */
function findPlace(place: Place): HTMLElement | null {
  const item = place.item ? document.querySelector(String(place.itemKind) + place.item) : null;
  const target = findByWhat(place, item);
  if (target || !place.itemKind || place.index === undefined || place.index < 0) {
    return target;
  }
  const items = document.querySelectorAll(place.itemKind);
  return items.length ? focusTarget(items[Math.min(place.index, items.length - 1)]) : null;
}

/**
 * Puts focus back where `readPlace` found it, unless the redraw left focus
 * somewhere on the page already, such as on an element it kept or a field
 * the page restored itself; focus on what the redraw removed is focus lost.
 */
export function restorePlace(place: Place | null): void {
  if (!place) {
    return;
  }
  const active = document.activeElement;
  if (active && active !== document.body && isOnPage(active)) {
    return;
  }
  const target = findPlace(place);
  if (!target) {
    return;
  }
  target.focus({ preventScroll: true });
  const field = target as HTMLInputElement;
  if (place.selectionStart !== undefined && field.setSelectionRange && place.selectionStart !== null) {
    field.setSelectionRange(place.selectionStart, place.selectionEnd ?? null);
  }
}
