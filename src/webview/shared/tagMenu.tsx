/**
 * The menu a right-click opens where the pointer is: on a tag, Rename tag
 * and Park tag or Unpark tag; elsewhere, whatever a page offers there, such
 * as a search card's Pin and Park. One element, `#tag-context-menu`, serves
 * every opening; it is a layer of the body, outside `#app`, and its rows
 * are a render root of their own.
 */
import { render } from 'preact';

import { type ContextMenuAction, ContextMenuItem } from './rankedRows';
import { returnFocusFromMenu } from './menuKeys';

/** The menu's element, made the first time it opens. */
let menu: HTMLElement | undefined;

/** The tag the open menu is about, while it is open on one. */
let menuTagKey: string | undefined;

/** The tags `deckard.parked.tags` lists, lower-cased, which the menu offers to unpark. */
let parkedTagKeys = new Set<string>();

/** Takes the host's list of parked tags, from each state it sends. */
export function setParkedTags(keys: readonly string[] | undefined): void {
  parkedTagKeys = new Set((keys || []).map((key) => String(key).toLowerCase()));
}

/** Whether a tag is one `deckard.parked.tags` lists, whatever its case. */
export function isParkedTag(tagKey: string): boolean {
  return parkedTagKeys.has(String(tagKey).toLowerCase());
}

/** The tag menu's park row: Park tag, or Unpark tag on a listed one. */
export function parkTagMenuItem(tagKey: string): ContextMenuAction {
  return isParkedTag(tagKey)
    ? { action: 'unpark-tag', label: 'Unpark tag' }
    : { action: 'park-tag', label: 'Park tag' };
}

/** Whether the menu has been made, open or not. */
export function hasTagContextMenu(): boolean {
  return Boolean(menu);
}

/** Whether the menu is showing. */
export function isTagContextMenuOpen(): boolean {
  return Boolean(menu && !menu.hidden);
}

/** The tag the open menu is about, if it was opened on one. */
export function tagContextKey(): string | undefined {
  return menuTagKey;
}

/**
 * Closes the menu and lets go of its tag, giving focus back to where a
 * keyboard opened it, if it was open.
 */
export function closeTagContextMenu(): void {
  const wasOpen = isTagContextMenuOpen();
  if (menu) {
    menu.hidden = true;
  }
  menuTagKey = undefined;
  if (wasOpen) {
    returnFocusFromMenu();
  }
}

/** The menu's element, appended to the body the first time it is asked for. */
function menuElement(): HTMLElement {
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'tag-context-menu';
    menu.className = 'tag-context-menu popover';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
  }
  return menu;
}

/**
 * Opens the menu where the pointer is, kept inside the window, with one row
 * per item, each naming its action in `data-context-action`; focus goes to
 * the first. Nothing opens for no items.
 */
export function openContextMenu(event: MouseEvent, items: readonly ContextMenuAction[]): void {
  if (!items.length) {
    return;
  }
  event.preventDefault();
  closeTagContextMenu();
  const element = menuElement();
  render(<>{items.map((item) => <ContextMenuItem action={item.action} label={item.label} />)}</>, element);
  element.hidden = false;
  const bounds = element.getBoundingClientRect();
  element.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
  element.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
  element.querySelector('button')?.focus();
}

/**
 * Opens a tag's menu, Rename tag and its park row, for the element that
 * carries the tag in `data-tag-key`. Opening closes whatever was open,
 * which lets go of the tag it was about, so this menu's tag is kept after
 * that and not before.
 */
export function openTagContextMenu(event: MouseEvent, target: HTMLElement): void {
  const tagKey = target.dataset.tagKey;
  if (!tagKey) {
    return;
  }
  openContextMenu(event, [{ action: 'rename-tag', label: 'Rename tag' }, parkTagMenuItem(tagKey)]);
  menuTagKey = tagKey;
}
