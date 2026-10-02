/**
 * A menu of choices under a control, as a board card's ⋯ opens: one menu
 * for every opener, a layer of the body outside `#app` whose contents are
 * a render root of their own. It closes on a choice, Escape, or a click
 * elsewhere, the arrow keys walk it, a choice's key works inside it, and
 * focus goes back to the control that opened it.
 */
import { render } from 'preact';

import { CheckIcon } from './strokeIcons';

/** One choice: its value, its words, whether it is the entry's own (a single choice), and its key. */
export interface ActionMenuItem {
  readonly value: string;
  readonly label: string;
  /** Set for the choices of a single choice: whether this one is what the entry is now. */
  readonly checked?: boolean;
  /** The key that makes the same choice, shown beside it and taken in the open menu. */
  readonly key?: string;
}

/** A named group of choices, or, with no label, choices of their own. */
export interface ActionMenuGroup {
  readonly label?: string;
  readonly items: readonly ActionMenuItem[];
}

/** The menu's element, made the first time a menu opens. */
let menu: HTMLElement | undefined;
/** What the open menu does with a choice. */
let choose: ((value: string) => void) | undefined;
/** The control the open menu belongs to. */
let opener: HTMLElement | undefined;

/** One choice, as a menu item or, for a single choice, a radio item with its check. */
function MenuChoice({ item, checks }: { readonly item: ActionMenuItem; readonly checks: boolean }) {
  const radio = item.checked !== undefined;
  return (
    <button
      type="button"
      class="menu-item"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? Boolean(item.checked) : undefined}
      aria-keyshortcuts={item.key || undefined}
      data-menu-key={item.key || undefined}
      data-menu-value={item.value}
    >
      {checks ? <span key="check" class="menu-check" aria-hidden="true">{item.checked ? <CheckIcon /> : null}</span> : null}
      <span key="label" class="menu-label">{item.label}</span>
      {item.key ? <kbd key="key" class="menu-key" aria-hidden="true">{item.key}</kbd> : null}
    </button>
  );
}

/**
 * The menu's groups. A named group is a group to a screen reader too, so
 * "Due today" is heard as one of the Due choices rather than as a bare
 * item. A group whose items say whether they are checked is a single
 * choice: its items are radios, and every row keeps a check's width so the
 * labels align.
 */
function MenuGroups({ groups, checks }: { readonly groups: readonly ActionMenuGroup[]; readonly checks: boolean }) {
  return (
    <>
      {groups.map((group, groupIndex) => {
        const items = group.items.map((item) => <MenuChoice item={item} checks={checks} />);
        if (!group.label) {
          return items;
        }
        const headingId = `action-menu-group-${groupIndex}`;
        return (
          <div class="menu-group" role="group" aria-labelledby={headingId}>
            <div class="menu-heading" id={headingId} role="presentation">{group.label}</div>
            {items}
          </div>
        );
      })}
    </>
  );
}

/** Closes the menu, if it is open, and gives focus back to its control. */
export function closeActionMenu(): void {
  if (!menu || menu.hidden) {
    return;
  }
  menu.hidden = true;
  choose = undefined;
  const was = opener;
  opener = undefined;
  if (!(was && document.contains(was))) {
    return;
  }

  was.setAttribute('aria-expanded', 'false');
  if (was.focus) {
    was.focus();
  }
}

/** A click on a choice takes it; a click anywhere but the menu and its control closes it. */
function onClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const chosen = target ? target.closest<HTMLElement>('#action-menu [data-menu-value]') : null;
  if (chosen) {
    const take = choose;
    closeActionMenu();
    take?.(String(chosen.dataset.menuValue));
    return;
  }
  if (!menu || menu.hidden || (target && target.closest('#action-menu'))) {
    return;
  }
  if (opener && target && opener.contains(target)) {
    return;
  }
  closeActionMenu();
}

/** The open menu's keys: Escape, a choice's own key, and the arrows, Home, and End. */
function onKeydown(event: KeyboardEvent): void {
  if (!menu || menu.hidden) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeActionMenu();
    return;
  }
  // The key a row shows works in the open menu too, so the hint is true in
  // both places: 2 in the menu chooses High.
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const keyed = Array.prototype.find.call(menu.querySelectorAll<HTMLElement>('[data-menu-key]'), (item: HTMLElement) => item.dataset.menuKey === event.key) as HTMLElement | undefined;
    if (keyed) {
      event.preventDefault();
      keyed.click();
      return;
    }
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[data-menu-value]'));
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next = (index - 1 + items.length) % items.length;
  if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = items.length - 1;
  } else if (event.key === 'ArrowDown') {
    next = (index + 1) % items.length;
  }
  event.preventDefault();
  items[next].focus();
}

/** The menu's element, `#action-menu`, appended to the body, with its listeners, made once. */
function menuElement(): HTMLElement {
  if (menu) {
    return menu;
  }
  const element = document.createElement('div');
  element.id = 'action-menu';
  element.className = 'tag-context-menu action-menu popover';
  element.setAttribute('role', 'menu');
  element.hidden = true;
  document.body.appendChild(element);
  menu = element;
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  return element;
}

/**
 * Opens the menu under `at` with `groups`, a group with no items left out;
 * `onChoose` is called with the value chosen. Focus opens on what the entry
 * is now, so the arrows start from it.
 */
export function openActionMenu(at: HTMLElement, groups: readonly ActionMenuGroup[], onChoose: (value: string) => void): void {
  closeActionMenu();
  const element = menuElement();
  const shown = groups.filter((group) => group.items.length);
  const checks = shown.some((group) => group.items.some((item) => item.checked !== undefined));
  render(<MenuGroups groups={shown} checks={checks} />, element);
  const first = element.querySelector<HTMLElement>('[aria-checked="true"]') || element.querySelector<HTMLElement>('[data-menu-value]');
  if (!first) {
    return;
  }
  choose = onChoose;
  opener = at;
  at.setAttribute('aria-expanded', 'true');
  element.hidden = false;
  const anchor = at.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  element.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
  element.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - bounds.height - 8))}px`;
  first.focus();
}
