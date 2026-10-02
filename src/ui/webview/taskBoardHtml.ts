import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * The Task Board page's shell: its bundle, `dist/webview/taskBoard.js`,
 * draws the search box every search page shares, the gear that holds the
 * board's view options and column settings, and the searched tasks as
 * columns, a list, or a table (src/webview/taskBoard). The page shows its
 * loading line until the host posts the board, which it asks for when it
 * is ready.
 */
export function getTaskBoardHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'taskBoard',
    title: 'Deckard Task Board',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    bundle: true,
    body: `
${loadingHtml('Loading tasks…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
