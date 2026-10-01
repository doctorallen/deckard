/**
 * Where the page was scrolled to, kept in the webview's own state and put
 * back when the page is drawn again, so coming back to a page, after VS Code
 * reopens it or its tab is shown again, lands where the reader left it
 * rather than at the top. Up to 40% of searches are re-finding (Teevan et
 * al., 2007), and position is how a list is re-found.
 */

/** What a page kept: `scrollY` among whatever else it keeps. */
type Kept = Readonly<Record<string, unknown>> | undefined | null;

/**
 * Keeps the window's scroll position as `scrollY` among what the page keeps,
 * at most every 200 ms while it scrolls. `getSaved` reads what the page kept
 * and `setSaved` keeps a new value.
 */
export function rememberScroll(getSaved: () => Kept, setSaved: (value: Record<string, unknown>) => void): void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('scroll', () => {
    if (pending) {
      return;
    }
    pending = setTimeout(() => {
      pending = undefined;
      setSaved({ ...(getSaved() || {}), scrollY: Math.round(window.scrollY) });
    }, 200);
  }, { passive: true });
}

/** Scrolls back to where `saved` says the page was, if it says. */
export function restoreScroll(saved: Kept): void {
  if (!saved || typeof saved.scrollY !== 'number' || !window.scrollTo) {
    return;
  }
  window.scrollTo(0, saved.scrollY);
}
