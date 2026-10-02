import * as vscode from 'vscode';

import { createNonce, loadingHtml } from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { type DeckardTheme, getDeckardTheme } from './themes';

/**
 * The Dashboard's shell: its bundle, `dist/webview/dashboard.js`, draws Home
 * with the widgets the reader arranges, and the Tags tab with every tag
 * (src/webview/dashboard). The page shows its loading line until the host
 * posts its state; the favorite heart is an image from `resources/`.
 */
export function getDashboardHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: vscode.Uri,
  /** The theme its host read, preview and all; the configured one without. */
  theme?: DeckardTheme,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'dashboard',
    title: 'Deckard Dashboard',
    nonce: createNonce(),
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    csp: { images: [] },
    bundle: true,
    body: `
${loadingHtml('Loading index…')}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
