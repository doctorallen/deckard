/**
 * DECKARD's menu at the top of every page: selecting DECKARD ▾ in a page's
 * eyebrow drops a menu under it of every other page, each with the hint
 * the Pages view gives it, and Go to… with its key at the foot. The host
 * is asked for the pages each time, so the hints are as the notes are now.
 *
 * The menu is drawn outside the page's own tree, on the body, so a page
 * drawing itself again leaves it open, and it works the same on Help,
 * whose script is its own. Arrows walk it, Enter chooses, and Escape
 * closes it and gives focus back to DECKARD; focus leaving it for anywhere
 * else, the webview included, closes it.
 */
import { walkMenu } from './menuKeys';
import { createPageIcon } from './pageIcons';

/** One page in the menu, as the host sends it. */
interface GoToMenuPage {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** The host's answer to `listGoTo`. */
interface GoToPagesMessage {
  readonly type: 'goToPages';
  readonly pages: readonly GoToMenuPage[];
  readonly key: string;
}

/** What the menu sends its host. */
export type GoToMenuMessage = { readonly type: 'listGoTo' } | { readonly type: 'openGoTo' } | { readonly type: 'goToPage'; readonly page: string };

let send: ((message: GoToMenuMessage) => void) | undefined;
/** The DECKARD button the menu is open from, or is waiting on the host for. */
let opener: HTMLElement | undefined;
let menu: HTMLElement | undefined;

/**
 * Listens for DECKARD ▾ on the page and for the host's list, once per
 * page. `post` is the page's way to its host.
 */
export function installGoToMenu(post: (message: GoToMenuMessage) => void): void {
  send = post;
  document.addEventListener('click', onClick);
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as GoToPagesMessage | undefined;
    if (data && data.type === 'goToPages' && Array.isArray(data.pages) && opener && document.contains(opener)) {
      show(opener, data);
    }
  });
  // A press anywhere else or a resize closes it; so does focus leaving it.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Node ? event.target : null;
    if (menu && target && !menu.contains(target) && !(opener && opener.contains(target))) {
      close(false);
    }
  }, true);
  window.addEventListener('resize', () => close(false));
}

/** DECKARD opens or closes the menu; a row in it goes where it says. */
function onClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const item = target ? target.closest<HTMLElement>('.go-to-item') : null;
  if (item && menu && menu.contains(item)) {
    choose(item);
    return;
  }
  const button = target ? target.closest<HTMLElement>('[data-go-to]') : null;
  if (!button) {
    return;
  }
  if (menu && opener === button) {
    close(true);
    return;
  }
  close(false);
  opener = button;
  send?.({ type: 'listGoTo' });
}

/** Draws the menu under `anchor` and puts focus on its first row. */
function show(anchor: HTMLElement, list: GoToPagesMessage): void {
  const previous = menu;
  menu = undefined;
  previous?.remove();
  const drawn = document.createElement('div');
  drawn.className = 'popover is-dropdown go-to-menu';
  drawn.setAttribute('role', 'menu');
  drawn.setAttribute('aria-label', 'Go to a page');
  for (const page of list.pages) {
    drawn.append(createItem(page.label, page.description, page.id, page.id === 'find'));
  }
  const rule = document.createElement('div');
  rule.className = 'go-to-separator';
  rule.setAttribute('role', 'separator');
  drawn.append(rule, createItem('Go to…', list.key, undefined, true));
  drawn.addEventListener('keydown', (event) => {
    if (walkMenu(drawn, event, '.go-to-item')) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  });
  drawn.addEventListener('focusout', (event) => {
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    // Moving between its rows, or to DECKARD, whose click closes it, keeps it.
    if (menu !== drawn || (next && (drawn.contains(next) || (opener && opener.contains(next))))) {
      return;
    }
    close(false);
  });
  document.body.append(drawn);
  const at = anchor.getBoundingClientRect();
  drawn.style.top = `${Math.round(at.bottom + 4)}px`;
  drawn.style.left = `${Math.round(Math.max(8, Math.min(at.left, window.innerWidth - drawn.offsetWidth - 8)))}px`;
  menu = drawn;
  anchor.setAttribute('aria-expanded', 'true');
  drawn.querySelector<HTMLElement>('.go-to-item')?.focus();
}

/**
 * One row: a page's glyph and name, by its id, or, with none, Go to…
 * itself; then its hint, a key to press drawn as a key (`shortcut`), or
 * what the page holds now.
 */
function createItem(label: string, hint: string, page?: string, shortcut = false): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item go-to-item';
  item.setAttribute('role', 'menuitem');
  item.tabIndex = -1;
  if (page !== undefined) {
    item.dataset.goToPage = page;
  }
  const name = document.createElement('span');
  name.className = 'go-to-label';
  name.textContent = label;
  item.append(createPageIcon(page), name);
  if (hint) {
    const detail = document.createElement(shortcut ? 'kbd' : 'span');
    detail.className = shortcut ? 'menu-key is-shortcut' : 'menu-key';
    detail.textContent = hint;
    item.append(detail);
  }
  return item;
}

/** Goes to the row's page, or opens Go to… for the row at the foot. */
function choose(item: HTMLElement): void {
  const page = item.dataset.goToPage;
  send?.(page === undefined ? { type: 'openGoTo' } : { type: 'goToPage', page });
  close(false);
}

/** Closes the menu, giving focus back to DECKARD when `returnFocus`. */
function close(returnFocus: boolean): void {
  const from = opener;
  menu?.remove();
  menu = undefined;
  opener = undefined;
  if (!from) {
    return;
  }
  from.setAttribute('aria-expanded', 'false');
  if (returnFocus && document.contains(from)) {
    from.focus();
  }
}
