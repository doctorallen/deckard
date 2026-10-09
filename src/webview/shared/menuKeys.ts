/**
 * The keyboard's way to every context menu, and focus given back when one
 * closes.
 */

/**
 * The element a keyboard opened a context menu from, so closing the menu
 * gives focus back to it. A pointer leaves this unset. Opening a menu
 * closes whatever was open first, so a close consumes it only when a menu
 * was showing.
 */
let contextMenuOpener: HTMLElement | undefined;

/** Gives focus back to where a keyboard opened the menu that just closed. */
export function returnFocusFromMenu(): void {
  const opener = contextMenuOpener;
  contextMenuOpener = undefined;
  if (opener && document.contains(opener) && opener.focus) {
    opener.focus();
  }
}

/** The keys that walk an open menu. */
const WALK_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/**
 * Walks an open menu from the keyboard: Down and Up to the next or previous
 * of its items, round the ends, and Home and End to the first or last.
 * `items` selects its items. Returns whether the key was one of these.
 * Every menu walks the same way: a board card's, and the one a right-click
 * opens on a tag or a card, which ignored the arrows before.
 */
export function walkMenu(menu: HTMLElement, event: KeyboardEvent, items: string): boolean {
  if (!WALK_KEYS.includes(event.key)) {
    return false;
  }
  const choices = Array.from(menu.querySelectorAll<HTMLElement>(items));
  if (!choices.length) {
    return false;
  }
  const index = choices.indexOf(document.activeElement as HTMLElement);
  let next = (index - 1 + choices.length) % choices.length;
  if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = choices.length - 1;
  } else if (event.key === 'ArrowDown') {
    next = (index + 1) % choices.length;
  }
  event.preventDefault();
  choices[next].focus();
  return true;
}

/** Whether a key asks for the menu of what has focus: the menu key, Shift+F10, or Alt+Enter. */
export function isMenuKey(event: KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey) || (event.key === 'Enter' && event.altKey);
}

/**
 * Each menu here opens on a contextmenu event, so the menu key, Shift+F10,
 * and Alt+Enter on a focused tag, card, or row, a table's row or a
 * heading with a menu of its own (`data-context-menu`) too, raise
 * that event at the element, and whatever menu a pointer would get there
 * opens for the keyboard too. Install once, ahead of the page's own listeners, so a
 * handler that opens on the same keys can see the key was taken.
 */
export function installMenuKeys(): void {
  document.addEventListener('keydown', (event) => {
    if (!isMenuKey(event) || event.defaultPrevented) {
      return;
    }
    if (!(event.target instanceof Element)) {
      return;
    }
    // A field keeps the browser's own menu.
    if (event.target.closest('input, textarea, select')) {
      return;
    }
    const target = event.target.closest<HTMLElement>('[data-tag-key], [data-context-menu], .card, .task-row, .task, .row, .result-row');
    if (!target) {
      return;
    }
    const bounds = target.getBoundingClientRect();
    contextMenuOpener = target;
    const raised = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + 12,
      clientY: bounds.top + bounds.height,
    });
    target.dispatchEvent(raised);
    if (raised.defaultPrevented) {
      event.preventDefault();
    } else {
      contextMenuOpener = undefined;
    }
  });
}
