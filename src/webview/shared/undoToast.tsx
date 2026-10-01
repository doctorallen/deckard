/**
 * Undo, briefly: what a removal that can be put back offers instead of
 * asking first.
 */
import { render } from 'preact';

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

/**
 * One offer of Undo at a time, withdrawn after 8 seconds or by the next
 * removal. The offer is drawn in its own toast outside `#app`, so a page's
 * redraw does not take it away, and it is seen wherever the removal was
 * made. `redraw` draws the page again after a change.
 */
export function createUndoNotice<P>(redraw: () => void): UndoOffer<P> {
  let current: { message: string; action: string; payload: P } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const draw = (): void => {
    render(current ? <UndoNotice message={current.message} action={current.action} /> : null, toastElement());
  };
  return {
    show(message, action, payload) {
      clearTimeout(timer);
      current = { message, action, payload };
      timer = setTimeout(() => {
        current = undefined;
        draw();
      }, UNDO_MS);
      redraw();
      draw();
      // Enter takes it back: focus moves to Undo.
      document.querySelector<HTMLElement>(`.undo-notice [data-action="${action}"]`)?.focus();
    },
    take() {
      clearTimeout(timer);
      const payload = current?.payload;
      current = undefined;
      draw();
      return payload;
    },
    clear() {
      clearTimeout(timer);
      current = undefined;
      draw();
    },
  };
}
