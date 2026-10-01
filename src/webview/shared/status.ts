/**
 * What a page says about itself rather than about the notes: that it is
 * busy, how far the first scan has got, and one short thing for a screen
 * reader at a time.
 */

/**
 * Says one short thing to a screen reader, in the `#live-status` node every
 * page carries outside `#app`.
 *
 * The page body is not a live region: a page redraws on every snapshot, and
 * a live body would read the whole page out on each index update and each
 * keystroke. A page says what changed here instead.
 */
export function announce(message: unknown): void {
  const status = document.getElementById('live-status');
  if (!status) {
    return;
  }
  const text = String(message || '');
  // The same words twice are not read again, so the node is emptied first.
  if (status.textContent === text) {
    status.textContent = '';
  }
  status.textContent = text;
}

/**
 * How far the first scan has got, in the words the sidebar and every page
 * use: "Indexing this workspace: 412 of 3,760 notes read…".
 */
export function describeIndexing(progress: { completed: number; total: number } | null | undefined): string {
  return progress && progress.total
    ? `Indexing this workspace: ${Number(progress.completed).toLocaleString('en-US')} of ${Number(progress.total).toLocaleString('en-US')} notes read…`
    : 'Indexing this workspace…';
}

/**
 * A page waiting on the first scan says how far it has got in its loading
 * line, as the host sends it; the page's first state replaces the line. The
 * line is the shell's, outside anything the page draws, so it is written
 * here directly.
 */
export function followIndexing(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; progress?: { completed: number; total: number } | null } | undefined;
    if (!data || data.type !== 'indexing') {
      return;
    }
    const line = document.querySelector('#app .loading');
    if (!line) {
      return;
    }
    line.classList.add('is-immediate');
    const words = line.querySelector('span') ?? line;
    words.textContent = describeIndexing(data.progress);
  });
}

/** Whether a search the page ran is still out, which keeps `#app` busy. */
let searchInFlight = false;

/** Marks `#app` busy exactly while it holds a `.loading` or a search is out. */
function syncBusy(): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  if (searchInFlight || app.querySelector('.loading')) {
    app.setAttribute('aria-busy', 'true');
  } else {
    app.removeAttribute('aria-busy');
  }
}

/**
 * Keeps `#app`'s `aria-busy` true exactly while it holds a `.loading` line,
 * or while a search it ran is still out; no page does anything about it.
 * `#live-status` sits outside `#app`, so what a page announces still goes
 * through.
 */
export function watchBusy(): void {
  const app = document.getElementById('app');
  if (typeof MutationObserver === 'function' && app) {
    new MutationObserver(syncBusy).observe(app, { childList: true, subtree: true });
  }
}

/** Says whether a search the page ran is still out, and marks `#app` busy while it is. */
export function setSearchInFlight(inFlight: boolean): void {
  searchInFlight = inFlight;
  syncBusy();
}
