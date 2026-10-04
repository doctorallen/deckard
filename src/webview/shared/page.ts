/**
 * How every page runs: one store, drawn synchronously into `#app`, with
 * one delegated listener for the controls it draws.
 *
 * - **One store and a synchronous render.** A page's state is the snapshot
 *   its host sent and its own UI state. A host message or a reader's action
 *   changes the store, which calls Preact's top-level `render` at once, so
 *   a test that clicks and then reads the page in the same tick sees the
 *   new page (decision 0014). Components keep no state of their own that a
 *   test or the first frame observes; hooks are limited to refs and
 *   `useLayoutEffect`.
 * - **Delegated actions.** One listener on `#app` reads the `data-action`
 *   of the control clicked and runs its handler, so the attributes the
 *   style sheets and the tests key on stay in the page.
 * - **The reader's place.** After each draw, focus goes back where it was
 *   only when the draw took away the element that held it (`place.ts`).
 * - **First draw.** The shell's loading line is cleared before the first
 *   draw, so Preact never adopts it.
 */
import { type ComponentChild, render } from 'preact';

import { readPlace, restorePlace } from './place';
import { followIndexing, watchBusy } from './status';
import { installTip } from './tip';
import { post } from './vscode';

/** A page's state, and the one way to change it. */
export interface PageStore<S> {
  /** The state the page was last drawn from. */
  readonly state: S;
  /** Takes `change` into the state and draws the page again before returning. */
  update(change: Partial<S>): void;
}

/** What a page is, to `startPage`. */
export interface PageDefinition<S> {
  /** The state the page starts from: with the snapshot its shell carried, when it carried one. */
  readonly initial: S;
  /** Whether the state holds anything to draw; until it does, the shell's loading line stays. */
  readonly ready: (state: S) => boolean;
  /** The whole page, drawn from the state. */
  readonly view: (state: S) => ComponentChild;
  /**
   * Runs after each draw, before the reader's place is put back, for what
   * the page keeps in the DOM outside its components' props, such as which
   * cell of a grid is its tab stop.
   */
  readonly afterDraw?: () => void;
}

/**
 * Starts a page: the behavior every page shares (the busy mark, the
 * indexing line, tips, and the guards below), then its store, drawn at once
 * when it starts with something to draw. Call once, when the page's script
 * runs, which the shell puts last in the body.
 */
export function startPage<S>(definition: PageDefinition<S>): PageStore<S> {
  installSharedBehavior();
  const app = document.getElementById('app') as HTMLElement;
  let state = definition.initial;
  let started = false;
  const draw = (): void => {
    if (!definition.ready(state)) {
      return;
    }
    if (!started) {
      app.textContent = '';
      started = true;
    }
    const place = readPlace();
    render(definition.view(state), app);
    definition.afterDraw?.();
    restorePlace(place);
  };
  const store: PageStore<S> = {
    get state() {
      return state;
    },
    update(change) {
      state = { ...state, ...change };
      draw();
    },
  };
  draw();
  return store;
}

/**
 * The snapshot the shell carried as inert JSON in `#state`, or undefined
 * when it carried none (decision 0005). The host escapes every `<` in it,
 * which JSON reads back as itself.
 */
export function readEmbeddedState<T>(): T | undefined {
  const block = document.getElementById('state');
  if (!block || block.getAttribute('type') !== 'application/json' || !block.textContent) {
    return undefined;
  }
  return JSON.parse(block.textContent) as T;
}

/** Runs a reader's action on the control that asked for it. */
export type ActionHandler = (element: HTMLElement, event: MouseEvent) => void;

/**
 * Listens to clicks inside `root` for the page's actions: the nearest
 * `data-action` above what was clicked names its handler. A click that
 * names no handler of the page's goes to `otherwise`, such as a row that
 * opens what it lists.
 */
export function listenForActions(
  root: HTMLElement,
  actions: Readonly<Record<string, ActionHandler>>,
  otherwise?: (event: MouseEvent) => void,
): void {
  root.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const element = target?.closest ? target.closest<HTMLElement>('[data-action]') : null;
    if (element && dispatchAction(actions, element, event)) {
      return;
    }
    otherwise?.(event);
  });
}

/**
 * Runs the handler `actions` holds for an element's `data-action`, and says
 * whether there was one; a page runs it this way from a key as a click would.
 */
export function dispatchAction(
  actions: Readonly<Record<string, ActionHandler>>,
  element: HTMLElement,
  event: MouseEvent,
): boolean {
  const action = element.dataset.action ?? '';
  if (!Object.prototype.hasOwnProperty.call(actions, action)) {
    return false;
  }
  actions[action](element, event);
  return true;
}

/** Listens for one kind of host message by its `type`, handing over the whole message. */
export function onHostMessage<M extends { type: string }>(type: M['type'], handler: (message: M) => void): void {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as M | undefined;
    if (data && data.type === type) {
      handler(data);
    }
  });
}

/**
 * What every page has done since its script was a template the host wrote:
 * the indexing line and the busy mark, a control held with `aria-disabled`
 * that ignores clicks, Escape putting away the file-and-line line under the
 * pointer, and tips. Installed before any listener of the page's own.
 */
function installSharedBehavior(): void {
  followIndexing();
  watchBusy();
  guardDisabledControls();
  dismissProvenanceOnEscape();
  installTip();
  openGoToFromEyebrow();
}

/** DECKARD in a page's eyebrow opens Go to…, on every page alike. */
function openGoToFromEyebrow(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target?.closest?.('[data-go-to]')) {
      post({ type: 'openGoTo' });
    }
  });
}

/**
 * A control that holds its place with `aria-disabled` stays focusable, so
 * its click is stopped here, once, before any page listener hears it; no
 * handler has to remember. Enter and Space on it raise the same click.
 */
function guardDisabledControls(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const disabled = target?.closest ? target.closest('[aria-disabled="true"]') : null;
    if (!disabled) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

/**
 * Escape puts away the file-and-line line an entry carries down under the
 * pointer, which could not be dismissed before (WCAG 1.4.13); it comes
 * back once the pointer or the focus moves on.
 */
function dismissProvenanceOnEscape(): void {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body) {
      document.body.classList.add('provenance-dismissed');
    }
  });
  for (const type of ['pointermove', 'focusin']) {
    document.addEventListener(type, () => {
      if (document.body && document.body.classList.contains('provenance-dismissed')) {
        document.body.classList.remove('provenance-dismissed');
      }
    });
  }
}
