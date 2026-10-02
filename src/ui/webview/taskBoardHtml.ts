import * as vscode from 'vscode';

import { createNonce, loadingHtml } from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { getDeckardTheme } from './themes';
import { type DeckardTheme } from './themeNames';

/**
 * The Task Board page's shell: its bundle, `dist/webview/taskBoard.js`,
 * draws the search box every search page shares, the gear that holds the
 * board's view options and column settings, and the searched tasks as
 * columns, a list, or a table (src/webview/taskBoard). The page shows its
 * loading line until the host posts the board, which it asks for when it
 * is ready.
 */
export function getTaskBoardHtml(
  webview: vscode.Webview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: vscode.Uri,
  /** The theme its host read, preview and all; the configured one without. */
  theme?: DeckardTheme,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'taskBoard',
    title: 'Deckard Task Board',
    nonce: createNonce(),
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    bundle: true,
    body: `
${loadingHtml('Loading tasks…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
