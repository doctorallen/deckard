import { createNonce, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

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
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'notesGraph',
    title: 'Deckard Notes Graph',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    display: chrome.display,
    bundle: true,
    body: '',
  });
}
