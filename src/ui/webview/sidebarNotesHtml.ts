import * as vscode from 'vscode';

import type { SidebarNotesPageState } from '../protocol/sidebarNotes';
import { createNonce, loadingHtml } from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { getDeckardTheme } from './themes';
import { type DeckardTheme } from './themeNames';

/**
 * The Related Notes sidebar's shell: its bundle, `dist/webview/sidebarNotes.js`,
 * draws the host-provided snapshots (src/webview/sidebarNotes). With a
 * snapshot, the shell carries it as inert JSON and the view draws it on its
 * first frame; without one, the view shows its loading line until the host
 * posts one.
 *
 * Keeping the view state-driven lets the host choose between active-note and
 * active-tag contexts while this document remains a simple navigation surface.
 *
 * The page no longer shows the extension's version. The parameter stays until
 * the view takes an options object (19-refactor.md, Phase 5), so its callers
 * and the harnesses that pin them do not change before then.
 */
export function getSidebarNotesHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: vscode.Uri,
  _extensionVersion: string,
  options: {
    /** The theme its host read, preview and all; the configured one without. */
    theme?: DeckardTheme;
    /** The snapshot to draw at once, if the shell is to carry one. */
    snapshot?: SidebarNotesPageState;
  } = {},
): string {
  const { theme, snapshot } = options;
  return buildPageShell({
    webview,
    extensionUri,
    page: 'sidebarNotes',
    title: 'Deckard Context',
    nonce: createNonce(),
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    bundle: true,
    state: snapshot,
    body: `
${snapshot === undefined ? loadingHtml('Loading related notes…', 'data-sidebar') : '<main id="app" data-sidebar></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
