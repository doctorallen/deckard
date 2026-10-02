import type { DeckardStatsSnapshot } from '../protocol/stats';
import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * The Stats page's shell: its bundle, `dist/webview/stats.js`, draws the
 * host-projected index and access data (src/webview/stats). With a
 * snapshot, the shell carries it as inert JSON and the page draws it on its
 * first frame; without one, the page shows its loading line until the host
 * posts one. Each row posts the message the host projected for it, which
 * opens the tag overview or note entry that row counts.
 */
export function getStatsHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
  /** The snapshot to draw at once, if the shell is to carry one. */
  snapshot?: DeckardStatsSnapshot,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'stats',
    title: 'Deckard Stats',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    bundle: true,
    state: snapshot,
    body: `
${snapshot === undefined ? loadingHtml('Loading statistics…') : '<main id="app"></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
