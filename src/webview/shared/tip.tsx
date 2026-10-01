/**
 * Tips: the longer explanation a control carries, shown on keyboard focus
 * as well as under the pointer. A native title never shows on focus, so a
 * keyboard reader never saw one, and it could not be dismissed or hovered.
 *
 *   data-tip           what the control does
 *   data-tip-key       the key that does the same, drawn as <kbd>
 *   data-tip-disabled  why it cannot act, used while aria-disabled="true"
 *   data-tip-overflow  the whole of a tag or chip, shown only when cut short
 *
 * A keyboard focus shows the tip at once; the pointer after 400 ms, or at
 * once within 300 ms of another tip closing, so a run along a toolbar does
 * not wait at every button. Touch never shows one. Escape hides it, and is
 * taken only while a tip shows, so it does not also close a menu behind it.
 *
 * The tip is one element, `#deckard-tip`, appended to the body the first
 * time a tip shows, outside `#app`, so a page's redraw never takes it away;
 * what it says is drawn into it as a render root of its own.
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

/** Places the tip under its control, or above it where there is no room below, inside the window. */
function placeTip(element: HTMLElement, target: Element): void {
  const at = target.getBoundingClientRect();
  const size = element.getBoundingClientRect();
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  let top = at.bottom + 6;
  if (height && top + size.height > height - 8) {
    top = at.top - 6 - size.height;
  }
  const left = at.left + at.width / 2 - size.width / 2;
  element.style.left = `${Math.max(8, width ? Math.min(left, width - size.width - 8) : left)}px`;
  element.style.top = `${Math.max(8, top)}px`;
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
