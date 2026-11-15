/**
 * Help and the Tour pointing at a page (plan 48, section 3).
 *
 * - `spotlight` rings one element: the one whose `data-help-id` it names,
 *   or the smallest whose text holds the words it names, as a Tour scene
 *   points at a card by its title. Every visible page is sent it, and only
 *   a page that has the target rings it.
 * - `explore` turns Point at something on or off: while on, each element
 *   with a `data-help-id` shows it can be picked, and a click on one is
 *   told to the host as `helpPicked` instead of doing what it does.
 *
 * The marks are classes, not attributes, and are put back after each
 * redraw while explore mode lasts, so a page's own drawing need not know.
 */
import type { ExploreMessage, HelpPickedMessage, SpotlightMessage } from '../../ui/protocol/shared';

/** The ring's class. */
export const SPOTLIGHT_CLASS = 'help-spotlight';
/** The body's class while Point at something is on. */
export const EXPLORING_CLASS = 'help-exploring';
/** An element that can be picked, while Point at something is on. */
export const PICKABLE_CLASS = 'help-pickable';
/** How long a ring that is not held stays, in milliseconds. */
const RING_TIME = 4000;

/**
 * What a ring by words may land on: elements a reader would call one thing,
 * a card, a row, a button, a heading, or a line of text. The smallest that
 * holds the words is the one ringed.
 */
const TEXT_TARGETS = [
  '[data-help-id]',
  '[data-task-id]',
  'button',
  'a',
  'summary',
  'li',
  'tr',
  'td',
  'label',
  '[role="button"]',
  '[role="option"]',
  '[role="row"]',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'span',
].join(', ');

/** A page's way of telling its host what was picked. */
export type SendPicked = (message: HelpPickedMessage) => void;

/** The element a spotlight names on this page, or undefined when it has none. */
export function findSpotlightTarget(root: ParentNode, message: Pick<SpotlightMessage, 'id' | 'text'>): Element | undefined {
  if (message.id) {
    return root.querySelector(`[data-help-id="${message.id.replace(/[^\w-]/g, '')}"]`) ?? undefined;
  }
  const words = message.text?.trim().toLowerCase();
  if (!words) {
    return undefined;
  }
  let best: Element | undefined;
  let bestLength = Number.POSITIVE_INFINITY;
  root.querySelectorAll(TEXT_TARGETS).forEach((element) => {
    if (element.closest('[hidden], template')) {
      return;
    }
    const text = (element.textContent ?? '').toLowerCase();
    if (!text.includes(words) || text.length >= bestLength) {
      return;
    }
    best = element;
    bestLength = text.length;
  });
  return best;
}

/** Marks each element with a `data-help-id` as pickable, as a redraw makes new ones. */
function markEveryPickable(root: Document): void {
  root.querySelectorAll('[data-help-id]').forEach((element) => {
    if (!element.classList.contains(PICKABLE_CLASS)) {
      element.classList.add(PICKABLE_CLASS);
    }
  });
}

/**
 * Listens for `spotlight` and `explore` from the host, and tells it what a
 * click picks in explore mode. Installed once per page, by `startPage` for
 * every page on it, and by the pages that draw themselves.
 */
export function installSpotlight(send: SendPicked, root: Document = document, win: Window = window): void {
  let ringTimer: ReturnType<typeof setTimeout> | undefined;
  let exploring = false;
  let observer: MutationObserver | undefined;

  const clearRing = (): void => {
    clearTimeout(ringTimer);
    root.querySelectorAll(`.${SPOTLIGHT_CLASS}`).forEach((element) => element.classList.remove(SPOTLIGHT_CLASS));
  };

  const ring = (message: SpotlightMessage): void => {
    clearRing();
    const target = findSpotlightTarget(root, message);
    if (!target) {
      return;
    }
    target.classList.add(SPOTLIGHT_CLASS);
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (!message.hold) {
      ringTimer = setTimeout(() => target.classList.remove(SPOTLIGHT_CLASS), RING_TIME);
    }
  };

  const markPickable = (): void => markEveryPickable(root);

  const setExploring = (on: boolean): void => {
    exploring = on;
    root.body.classList.toggle(EXPLORING_CLASS, on);
    observer?.disconnect();
    observer = undefined;
    if (on) {
      markPickable();
      const Observer = (win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver;
      if (typeof Observer === 'function') {
        observer = new Observer(markPickable);
        observer.observe(root.body, { childList: true, subtree: true });
      }
    } else {
      root.querySelectorAll(`.${PICKABLE_CLASS}`).forEach((element) => element.classList.remove(PICKABLE_CLASS));
    }
  };

  const picked = (event: Event): Element | undefined => {
    if (!exploring) {
      return undefined;
    }
    const node = event.target as Element | null;
    const target = node && typeof node.closest === 'function' ? node.closest('[data-help-id]') : null;
    return target ?? undefined;
  };

  // A press on a select would open it before its click; held here so a
  // pick never changes what the page shows.
  root.addEventListener('mousedown', (event) => {
    if (picked(event)) {
      event.preventDefault();
    }
  }, true);
  root.addEventListener('click', (event) => {
    const target = picked(event);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: 'helpPicked', id: target.getAttribute('data-help-id') ?? '' });
  }, true);
  root.addEventListener('keydown', (event) => {
    if (!exploring || event.key !== 'Escape') {
      return;
    }
    setExploring(false);
    send({ type: 'helpPicked' });
  }, true);
  win.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as SpotlightMessage | ExploreMessage | undefined;
    if (data?.type === 'spotlight') {
      ring(data);
    } else if (data?.type === 'explore') {
      setExploring(data.on === true);
    }
  });
}
