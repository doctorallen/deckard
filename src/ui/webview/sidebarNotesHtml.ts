import type { SidebarNotesPageState } from '../protocol/sidebarNotes';
import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

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
 * The page no longer shows the extension's version, so the parameter that
 * carries it is unused; it is kept so the hosts that pass it are unchanged.
 */
export function getSidebarNotesHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  _extensionVersion: string,
  options: {
    /** The look its host read: the theme, preview and all, and zen. */
    chrome: PageChrome;
    /** The snapshot to draw at once, if the shell is to carry one. */
    snapshot?: SidebarNotesPageState;
  },
): string {
  const { chrome, snapshot } = options;
  return buildPageShell({
    webview,
    extensionUri,
    page: 'sidebarNotes',
    title: 'Deckard Context',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    display: chrome.display,
    bundle: true,
    state: snapshot,
    body: `
${snapshot === undefined ? loadingHtml('Loading related notes…', 'data-sidebar') : '<main id="app" data-sidebar></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
