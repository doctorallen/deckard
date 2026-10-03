/**
 * Tips: the longer explanation a control carries, shown on keyboard focus
 * as well as under the pointer. A native title never shows on focus, so a
 * keyboard reader never saw one, and it could not be dismissed or hovered.
 *
 *   data-tip           what the control does
 *   data-tip-key       the key that does the same, drawn as <kbd>
 *   data-tip-disabled  why it cannot act, used while aria-disabled="true"
 *   data-tip-overflow  the whole of a tag or chip, shown only when cut short
 *   data-tip-around    on a card or row that shows more of itself under the
 *                      pointer or the focus: where it is written, folded
 *                      under it, or a panel such as a relevance breakdown
 *
 * A keyboard focus shows the tip at once; the pointer after 400 ms, or at
 * once within 300 ms of another tip closing, so a run along a toolbar does
 * not wait at every button. Touch never shows one. Escape hides it, and is
 * taken only while a tip shows, so it does not also close a menu behind it.
 *
 * The tip is one element, `#deckard-tip`, appended to the body the first
 * time a tip shows, outside `#app`, so a page's redraw never takes it away;
 * what it says is drawn into it as a render root of its own.
 *
 * A tip goes under its control, or above it where there is no room below.
 * Inside a card marked data-tip-around, it never covers what the card shows
 * on hover: a button's tip stays by the button while that covers none of
 * it, and otherwise, as the card's own tip always does, it goes under the
 * card and all it shows, or above, or beside, whichever fits the window.
 */
import { render } from 'preact';

const TIP_SELECTOR = '[data-tip], [data-tip-overflow], [data-tip-disabled]';

/** The tip's state: its element, what it is shown for, and its timers. */
const tip: {
  element?: HTMLElement;
  target?: HTMLElement;
  showTimer?: ReturnType<typeof setTimeout>;
  hideTimer?: ReturnType<typeof setTimeout>;
  lastHidden: number;
  keyboardModality: boolean;
} = { lastHidden: 0, keyboardModality: false };

/** Whether a tag's or a chip's text is cut short where it is drawn. */
function isTruncated(element: Element): boolean {
  return Array.prototype.some.call(
    element.querySelectorAll('.tag-namespace-text, .tag-value, .query-chip-label'),
    (part: Element) => part.scrollWidth > part.clientWidth,
  );
}

/** What a tip says for an element now, or nothing. */
function tipTextFor(element: Element | null | undefined): string {
  if (!element || !element.getAttribute) {
    return '';
  }
  const disabled = element.getAttribute('aria-disabled') === 'true' ? element.getAttribute('data-tip-disabled') : null;
  if (disabled) {
    return disabled;
  }
  const text = element.getAttribute('data-tip') || '';
  const overflow = element.getAttribute('data-tip-overflow');
  // A chip's own tip already names its whole term; a tag's tip is the tag.
  if (overflow && isTruncated(element)) {
    return text || overflow;
  }
  return text;
}

/** What a screen reader calls the element. */
function accessibleNameOf(element: Element): string {
  return String(element.getAttribute('aria-label') || element.textContent || '').trim();
}

/** Clears both of the tip's timers. */
function clearTimers(): void {
  clearTimeout(tip.showTimer);
  clearTimeout(tip.hideTimer);
  tip.showTimer = undefined;
  tip.hideTimer = undefined;
}

/** Hides the tip, and takes it out of what its control is described by. */
export function hideTip(): void {
  clearTimers();
  const target = tip.target;
  if (!target) {
    return;
  }
  const described = String(target.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== 'deckard-tip');
  if (described.length) {
    target.setAttribute('aria-describedby', described.join(' '));
  } else {
    target.removeAttribute('aria-describedby');
  }
  tip.target = undefined;
  if (tip.element) {
    tip.element.hidden = true;
  }
  tip.lastHidden = Date.now();
}

/** The tip's element, made and appended to the body the first time a tip shows. */
function tipElement(): HTMLElement {
  if (!tip.element) {
    const element = document.createElement('div');
    element.id = 'deckard-tip';
    element.className = 'popover is-tip';
    element.setAttribute('role', 'tooltip');
    element.hidden = true;
    document.body.appendChild(element);
    tip.element = element;
  }
  return tip.element;
}

/** What the tip says: its words, and the key that does the same, if any. */
function TipText({ text, keyName }: { readonly text: string; readonly keyName: string | null }) {
  return (
    <>
      {text}
      {keyName ? ' ' : null}
      {keyName ? <kbd>{keyName}</kbd> : null}
    </>
  );
}

/** A box in the window, as `getBoundingClientRect` gives one. */
interface Box {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Where the tip may go: its top left corner, and whether it was kept inside the window across already. */
interface Spot {
  readonly left: number;
  readonly top: number;
  readonly across: boolean;
}

/** How far the tip keeps from what it is placed by, and from the window's edges. */
const GAP = 6;
const MARGIN = 8;

/** What a card shows over its neighbors when it opens one: a popover, a breakdown, a menu. */
const SHOWN_SELECTOR = '.popover, [role="tooltip"], [role="dialog"], [role="menu"], [role="listbox"]';

/** Where an element is drawn. */
function boxOf(element: Element): Box {
  const { top, right, bottom, left } = element.getBoundingClientRect();
  return { top, right, bottom, left };
}

/** Whether a box is drawn at all: a folded line is a pixel, a hidden panel nothing. */
function isDrawn(box: Box): boolean {
  return box.right - box.left > 1 && box.bottom - box.top > 1;
}

/** The smallest box around all of the boxes given. */
function boxAround(boxes: readonly Box[]): Box {
  return {
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
    left: Math.min(...boxes.map((box) => box.left)),
  };
}

/** Whether two boxes share any of the window. */
function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** A length a card's style gives in pixels, or 0. */
function pixelsOf(style: CSSStyleDeclaration, name: string): number {
  const value = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * How far a card's frame reaches down under it while it is under the
 * pointer or holds the focus, to hold where its entry is written: the
 * `--reach` of provenance.css, past its own frame. Nothing at rest.
 */
function reachOf(card: Element): number {
  let open = false;
  try {
    open = card.matches(':hover') || card.matches(':focus-within');
  } catch {
    open = false;
  }
  if (!open) {
    return 0;
  }
  const style = getComputedStyle(card);
  const reach = pixelsOf(style, '--reach');
  return reach ? reach + pixelsOf(style, '--frame') : 0;
}

/** What an open control in a card has opened outside it, as a menu it names in aria-controls. */
function openedBy(control: Element, card: Element): Box[] {
  const boxes: Box[] = [];
  for (const id of String(control.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean)) {
    const panel = document.getElementById(id);
    const box = panel && !card.contains(panel) ? boxOf(panel) : null;
    if (box && isDrawn(box)) {
      boxes.push(box);
    }
  }
  return boxes;
}

/**
 * What a card shows now beyond what it is at rest: its frame carried down
 * under it, what hangs past its top or foot, any popover or panel it holds,
 * and what an open control in it has opened elsewhere.
 */
function shownBy(card: Element, cardBox: Box): Box[] {
  const shown: Box[] = [];
  const reach = reachOf(card);
  if (reach) {
    shown.push({ top: cardBox.bottom - 1, right: cardBox.right, bottom: cardBox.bottom + reach, left: cardBox.left });
  }
  for (const part of [card, ...Array.from(card.querySelectorAll('*'))]) {
    if (part.getAttribute('aria-expanded') === 'true') {
      shown.push(...openedBy(part, card));
    }
    if (part === card) {
      continue;
    }
    const box = boxOf(part);
    if (isDrawn(box) && (part.matches(SHOWN_SELECTOR) || box.bottom > cardBox.bottom + 1 || box.top < cardBox.top - 1)) {
      shown.push(box);
    }
  }
  return shown;
}

/** A width and a height. */
interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The spots the tip, of `size`, may take in the window, of `view`, best
 * first: by the control itself, while its card shows something the tip must
 * keep off; then under, above, right of, and left of `around`. The spot
 * above `around` is also where it goes when none fits.
 */
function spotsFor(at: Box, around: Box, byControl: boolean, { size, view }: { readonly size: Size; readonly view: Size }): { spots: Spot[]; above: Spot } {
  const centered = (at.left + at.right) / 2 - size.width / 2;
  const across = Math.max(MARGIN, view.width ? Math.min(centered, view.width - size.width - MARGIN) : centered);
  const middle = (at.top + at.bottom) / 2 - size.height / 2;
  const down = Math.max(MARGIN, view.height ? Math.min(middle, view.height - size.height - MARGIN) : middle);
  /** Under and above a box, centered on the control, and kept inside the window across. */
  const vertical = (box: Box): Spot[] => [
    { left: across, top: box.bottom + GAP, across: true },
    { left: across, top: box.top - GAP - size.height, across: true },
  ];
  const [under, above] = vertical(around);
  return {
    spots: [
      ...(byControl ? vertical(at) : []),
      under,
      above,
      { left: around.right + GAP, top: down, across: false },
      { left: around.left - GAP - size.width, top: down, across: false },
    ],
    above,
  };
}

/**
 * Places the tip by its control, inside the window.
 *
 * A control in no card, or in one that shows nothing more, has its tip
 * under it, or above it where there is no room below. A button in a card
 * that shows more keeps its tip under or above itself while that covers
 * none of what the card shows. Otherwise the tip goes by the card and
 * everything it shows: under, then above, then right, then left, the first
 * that fits the window; and above when none does.
 */
function placeTip(element: HTMLElement, target: Element): void {
  // Measured where it cannot be squeezed by the window's right edge.
  element.style.left = '0px';
  element.style.top = '0px';
  const { width, height } = element.getBoundingClientRect();
  const view = {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  };
  const at = boxOf(target);
  const card = target.closest('[data-tip-around]');
  const cardBox = card ? boxOf(card) : null;
  const shown = card && cardBox ? shownBy(card, cardBox) : [];
  const around = cardBox && (card === target || shown.length) ? boxAround([cardBox, at, ...shown]) : at;
  const { spots, above } = spotsFor(at, around, card !== target && shown.length > 0, { size: { width, height }, view });
  const fits = (spot: Spot): boolean => {
    const box = { left: spot.left, top: spot.top, right: spot.left + width, bottom: spot.top + height };
    return box.top >= MARGIN && (!view.height || box.bottom <= view.height - MARGIN)
      && (spot.across || (box.left >= MARGIN && (!view.width || box.right <= view.width - MARGIN)))
      && !shown.some((part) => overlaps(box, part));
  };
  const spot = spots.find(fits) ?? above;
  element.style.left = `${spot.left}px`;
  element.style.top = `${Math.max(MARGIN, spot.top)}px`;
}

/** Places the tip again once the page has drawn what the pointer's move showed, as a card's breakdown. */
function placeTipAgain(): void {
  const again = (): void => {
    if (tip.element && tip.target && !tip.element.hidden) {
      placeTip(tip.element, tip.target);
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(again);
  } else {
    setTimeout(again, 0);
  }
}

/** Shows the tip for a control, or hides it when the control has nothing to say or is gone. */
export function showTip(target: HTMLElement): void {
  clearTimeout(tip.showTimer);
  clearTimeout(tip.hideTimer);
  tip.showTimer = undefined;
  const text = tipTextFor(target);
  if (!text || !document.contains(target)) {
    if (tip.target === target) {
      hideTip();
    }
    return;
  }
  if (tip.target && tip.target !== target) {
    hideTip();
  }
  const element = tipElement();
  const keyName = target.getAttribute('aria-disabled') === 'true' ? '' : target.getAttribute('data-tip-key');
  render(<TipText text={text} keyName={keyName} />, element);
  element.hidden = false;
  tip.target = target;
  // The tip is the name already on an icon button; said twice, it is noise.
  if (text !== accessibleNameOf(target)) {
    const described = String(target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!described.includes('deckard-tip')) {
      described.push('deckard-tip');
    }
    target.setAttribute('aria-describedby', described.join(' '));
  }
  placeTip(element, target);
}

/** The control a pointer or focus event is about, if it has a tip to show. */
function tipOwner(target: EventTarget | null): HTMLElement | null {
  const element = target && (target as Element).closest ? (target as Element).closest<HTMLElement>(TIP_SELECTOR) : null;
  return element && tipTextFor(element) ? element : null;
}

/** Shows a tip under the pointer after its pause, or at once while tips are warm. */
function onPointerOver(event: PointerEvent): void {
  if (event.pointerType === 'touch') {
    return;
  }
  if (tip.element && tip.element.contains(event.target as Node)) {
    clearTimeout(tip.hideTimer);
    return;
  }
  const owner = tipOwner(event.target);
  if (!owner || owner === tip.target) {
    if (owner) {
      clearTimeout(tip.hideTimer);
      // A move within the control can open more of its card under the tip.
      placeTipAgain();
    }
    return;
  }
  clearTimeout(tip.showTimer);
  const warm = Boolean(tip.target) || Date.now() - tip.lastHidden < 300;
  tip.showTimer = setTimeout(() => showTip(owner), warm ? 0 : 400);
}

/** Hides the tip shortly after the pointer leaves its control, unless it moved onto the tip. */
function onPointerOut(event: PointerEvent): void {
  const next = event.relatedTarget as Node | null;
  const fromTip = Boolean(tip.element && tip.element.contains(event.target as Node));
  const owner = fromTip ? tip.target : tipOwner(event.target);
  if (!owner || (next && (owner.contains(next) || (tip.element && tip.element.contains(next))))) {
    return;
  }
  if (owner !== tip.target) {
    clearTimeout(tip.showTimer);
    return;
  }
  clearTimeout(tip.hideTimer);
  tip.hideTimer = setTimeout(hideTip, 100);
}

/** Tells a keyboard from a pointer, and hides the tip on Escape, before anything else hears the key. */
function listenForModality(): void {
  document.addEventListener('keydown', () => {
    tip.keyboardModality = true;
  }, true);
  document.addEventListener('pointerdown', () => {
    tip.keyboardModality = false;
    hideTip();
  }, true);
  document.addEventListener('mousedown', () => {
    tip.keyboardModality = false;
  }, true);
  // Escape puts the tip away first, and only the tip.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !tip.target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    hideTip();
  }, true);
}

/** Wires the tip's listeners. Called once, by `startPage`, before any listener of the page's own. */
export function installTip(): void {
  listenForModality();
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement | null;
    if (!tip.keyboardModality || !target || !target.matches || !target.matches(TIP_SELECTOR)) {
      return;
    }
    showTip(target);
  });
  document.addEventListener('focusout', (event) => {
    if (tip.target && event.target === tip.target) {
      hideTip();
    }
  });
  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);
  window.addEventListener('scroll', () => {
    if (tip.target) {
      hideTip();
    }
  }, true);
  // A redraw that took the control away takes its tip with it.
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      if (tip.target && !document.contains(tip.target)) {
        hideTip();
      }
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
}
