import type { NotePageSnapshot } from '../protocol/notePage';
import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * The note page's shell: its bundle, `dist/webview/notePage.js`, draws one
 * note from the snapshot its host builds (src/webview/notePage). With a
 * snapshot, the shell carries it as inert JSON and the page draws it on its
 * first frame; without one, the page shows its loading line until the host
 * posts one.
 */
export function getNotePageHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
  /** The snapshot to draw at once, if the shell is to carry one. */
  snapshot?: NotePageSnapshot,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'notePage',
    title: snapshot?.title ?? 'Note',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    bundle: true,
    state: snapshot,
    body: `
${snapshot === undefined ? loadingHtml('Loading the note…') : '<main id="app"></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
