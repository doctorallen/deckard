import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * The Dashboard's shell: its bundle, `dist/webview/dashboard.js`, draws Home
 * with the widgets the reader arranges, and the Tags tab with every tag
 * (src/webview/dashboard). The page shows its loading line until the host
 * posts its state; the favorite heart is an image from `resources/`.
 */
export function getDashboardHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'dashboard',
    title: 'Deckard Dashboard',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    csp: { images: [] },
    bundle: true,
    body: `
${loadingHtml('Loading index…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
