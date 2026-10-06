import type { TaskStatusesSnapshot } from '../protocol/taskStatuses';
import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * Edit Task Statuses' shell: its bundle, `dist/webview/taskStatuses.js`,
 * draws the statuses as rows to edit (src/webview/taskStatuses). With a
 * snapshot, the shell carries it as inert JSON and the page draws it on its
 * first frame.
 */
export function getTaskStatusesHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome,
  /** The snapshot to draw at once, if the shell is to carry one. */
  snapshot?: TaskStatusesSnapshot,
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: 'taskStatuses',
    title: 'Task Statuses',
    nonce: createNonce(),
    theme: chrome.theme,
    zen: chrome.zen,
    display: chrome.display,
    bundle: true,
    state: snapshot,
    body: `
${snapshot === undefined ? loadingHtml('Loading statuses…') : '<main id="app"></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
