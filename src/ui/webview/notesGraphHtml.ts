import * as vscode from 'vscode';

import { createNonce } from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { type DeckardTheme, getDeckardTheme } from './themes';

/**
 * The Notes Graph's shell: its bundle, `dist/webview/notesGraph.js`, draws
 * a full-viewport Canvas 2D force-directed graph with Focus, Filters,
 * Display, Forces, and Relationships panels over it (src/webview/notesGraph).
 *
 * The page receives whole snapshots by message and does every render and
 * filter itself, so the shell carries none: a graph takes far longer than
 * 50 ms to build on a large workspace (Q3 of docs/implementation/
 * 20-webviews.md), and the page has no loading line to show meanwhile.
 * Its body is empty; the page draws everything in it.
 */
export function getNotesGraphHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: vscode.Uri,
  /** The theme its host read, preview and all; the configured one without. */
  theme?: DeckardTheme,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'notesGraph',
    title: 'Deckard Notes Graph',
    nonce: createNonce(),
    theme: theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    bundle: true,
    body: '',
  });
}
