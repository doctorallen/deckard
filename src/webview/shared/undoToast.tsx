/**
 * Undo, briefly: what a removal that can be put back offers instead of
 * asking first.
 */
import { render } from 'preact';

import { type Place, readPlace, restorePlace } from './place';

/** A removal's offer of Undo: what was removed, and the action Undo runs. */
export interface UndoNoticeProps {
  readonly message: string;
  /** The `data-action` of its Undo button, which is the page's to handle. */
  readonly action: string;
  readonly buttonClass?: string;
}

/**
 * "Removed Tasks view. Undo": a status line with its Undo button, which
 * posts nothing itself.
 */
export function UndoNotice({ message, action, buttonClass }: UndoNoticeProps) {
  return (
    <span class="undo-notice" role="status">
      {`${message} `}
      <button type="button" class={buttonClass || undefined} data-action={action}>Undo</button>
    </span>
  );
}

/** One offer of Undo at a time, as `createUndoNotice` makes it. */
export interface UndoOffer<P> {
  /** Offers Undo for `payload`, withdrawn after 8 seconds or by the next offer, and focuses its button. */
  show(message: string, action: string, payload: P): void;
  /** Hands back the offer's payload and withdraws it. */
  take(): P | undefined;
  /** Withdraws the offer. */
  clear(): void;
}

/** How long an offer of Undo stands. */
const UNDO_MS = 8000;

/** The toast's element, `#undo-toast`, made and appended to the body the first time it is drawn. */
function toastElement(): HTMLElement {
  let host = document.getElementById('undo-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'undo-toast';
    host.className = 'undo-toast';
    document.body.appendChild(host);
  }
  return host;
}

/** Whether focus has fallen to the page itself, as it does when what held it is taken away. */
function focusIsLost(): boolean {
  return !document.activeElement || document.activeElement === document.body;
}

/**
 * One offer of Undo at a time, withdrawn after 8 seconds or by the next
 * removal. The offer is drawn in its own toast outside `#app`, so a page's
 * redraw does not take it away, and it is seen wherever the removal was
 * made. `redraw` draws the page again after a change.
 *
 * Showing it moves focus to Undo. When it is taken or withdrawn with focus
 * still on it, focus goes back to where the removal was made, found as a
 * redraw finds it; when that is gone, to what `returnFocus` names for the
 * removal, such as the row beside the one removed. Focus that fell to the
 * page itself made the next Tab start again from the top.
 */
export function createUndoNotice<P>(redraw: () => void, returnFocus?: (payload: P) => HTMLElement | null | undefined): UndoOffer<P> {
  let current: { message: string; action: string; payload: P; place: Place | null } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const draw = (): void => {
    render(current ? <UndoNotice message={current.message} action={current.action} /> : null, toastElement());
  };
  // Puts focus where the removal was made, or where `returnFocus` says.
  const giveFocusBack = (offer: { payload: P; place: Place | null }): void => {
    restorePlace(offer.place);
    if (focusIsLost()) {
      returnFocus?.(offer.payload)?.focus();
    }
  };
  // Withdraws the offer, and gives focus back if it was on Undo: at once,
  // and again once the page has drawn what Undo put back, since a page
  // that undoes a removal on its own draws it after taking the offer.
  const withdraw = (): P | undefined => {
    clearTimeout(timer);
    const offer = current;
    current = undefined;
    const focused = toastElement().contains(document.activeElement);
    draw();
    if (offer && focused) {
      giveFocusBack(offer);
      if (focusIsLost()) {
        queueMicrotask(() => {
          if (focusIsLost()) {
            giveFocusBack(offer);
          }
        });
      }
    }
    return offer?.payload;
  };
  return {
    show(message, action, payload) {
      clearTimeout(timer);
      // Where the removal was made, unless that was an Undo before this one.
      const place = toastElement().contains(document.activeElement) ? current?.place ?? null : readPlace();
      current = { message, action, payload, place };
      timer = setTimeout(withdraw, UNDO_MS);
      redraw();
      draw();
      // Enter takes it back: focus moves to Undo.
      document.querySelector<HTMLElement>(`.undo-notice [data-action="${action}"]`)?.focus();
    },
    take() {
      return withdraw();
    },
    clear() {
      withdraw();
    },
  };
}
