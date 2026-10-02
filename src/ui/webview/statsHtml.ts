import * as vscode from 'vscode';

import type { DeckardStatsSnapshot } from '../protocol/stats';
import { createNonce, loadingHtml } from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { getDeckardTheme } from './themes';
import { type DeckardTheme } from './themeNames';

/**
 * The Stats page's shell: its bundle, `dist/webview/stats.js`, draws the
 * host-projected index and access data (src/webview/stats). With a
 * snapshot, the shell carries it as inert JSON and the page draws it on its
 * first frame; without one, the page shows its loading line until the host
 * posts one. Each row posts the message the host projected for it, which
 * opens the tag overview or note entry that row counts.
 */
export function getStatsHtml(
  webview: vscode.Webview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: vscode.Uri,
  /** The theme its host read, preview and all; the configured one without. */
  theme?: DeckardTheme,
  /** The snapshot to draw at once, if the shell is to carry one. */
  snapshot?: DeckardStatsSnapshot,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'stats',
    title: 'Deckard Stats',
    nonce: createNonce(),
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    bundle: true,
    state: snapshot,
    body: `
${snapshot === undefined ? loadingHtml('Loading statistics…') : '<main id="app"></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
