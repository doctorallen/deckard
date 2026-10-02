import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * A search page's shell: its bundle, `dist/webview/searchPage.js`, draws
 * the search box every search page shares, the tag or entity a one-tag
 * search is about with its hub note, and the notes and tasks the search
 * finds (src/webview/searchPage). The page shows its loading line until the
 * host posts its results.
 */
export function getSearchPageHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'searchPage',
    title: 'Deckard Search',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    bundle: true,
    body: `
${loadingHtml('Loading search…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
