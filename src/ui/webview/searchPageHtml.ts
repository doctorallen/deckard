import * as vscode from 'vscode';

import { createNonce, loadingHtml } from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { type DeckardTheme, getDeckardTheme } from './themes';

/**
 * A search page's shell: its bundle, `dist/webview/searchPage.js`, draws
 * the search box every search page shares, the tag or entity a one-tag
 * search is about with its hub note, and the notes and tasks the search
 * finds (src/webview/searchPage). The page shows its loading line until the
 * host posts its results.
 */
export function getSearchPageHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: vscode.Uri,
  /** The theme its host read, preview and all; the configured one without. */
  theme?: DeckardTheme,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'searchPage',
    title: 'Deckard Search',
    nonce: createNonce(),
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    bundle: true,
    body: `
${loadingHtml('Loading search…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
