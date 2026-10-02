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

/** Whether a key asks for the menu of what has focus: the menu key, Shift+F10, or Alt+Enter. */
export function isMenuKey(event: KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey) || (event.key === 'Enter' && event.altKey);
}

/**
 * Each menu here opens on a contextmenu event, so the menu key, Shift+F10,
 * and Alt+Enter on a focused tag, card, or row, a table's row too, raise
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
    const target = event.target.closest<HTMLElement>('[data-tag-key], .card, .task-row, .task, .row, .result-row');
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
