import type { PagesViewSnapshot } from '../protocol/pagesView';
import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * The Pages view's shell: its bundle, `dist/webview/pagesView.js`, draws
 * every Deckard page the reader keeps there, as labeled rows or a row of
 * icons (src/webview/pagesView). With a snapshot, the shell carries it as
 * inert JSON and the view draws it on its first frame.
 */
export function getPagesViewHtml(
  webview: ShellWebview,
  /** The extension's folder, which the view's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
  /** The snapshot to draw at once, if the shell is to carry one. */
  snapshot?: PagesViewSnapshot,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'pagesView',
    title: 'Deckard Pages',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    display: chrome.display,
    bundle: true,
    state: snapshot,
    body: `
${snapshot === undefined ? loadingHtml('Loading pages…') : '<main id="app"></main>'}
`,
  });
}
