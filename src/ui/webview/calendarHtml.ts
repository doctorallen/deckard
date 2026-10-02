import type { CalendarSnapshot } from '../protocol/calendar';
import { createNonce, loadingHtml, type PageChrome } from './components';
import { buildPageShell, type ShellUri, type ShellWebview } from './host/pageShell';

/**
 * A calendar's shell: the sidebar Calendar, whose bundle,
 * `dist/webview/calendar.js`, draws a month of weeks (src/webview/calendar),
 * or the calendar page, whose bundle, `dist/webview/calendarPage.js`, draws
 * a month or a week of days large enough to list their tasks, with the day
 * panel beside it (src/webview/calendarPage). Every day, every week, and the
 * month title is a button that asks the host to open its note; the host
 * decides what exists and what to create. With a snapshot, the shell
 * carries it as inert JSON and the calendar draws it on its first frame;
 * without one, it shows its loading line until the host posts one.
 */
export function getCalendarHtml(
  webview: ShellWebview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: ShellUri,
  options: {
    /** The calendar page, rather than the sidebar's. */
    page?: boolean;
    /** The look its host read: the theme, preview and all, and zen. */
    chrome: PageChrome;
    /** The snapshot to draw at once, if the shell is to carry one. */
    state?: CalendarSnapshot;
  },
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: options.page ? 'calendarPage' : 'calendar',
    title: 'Deckard Calendar',
    nonce: createNonce(),
    theme: options.chrome.theme,
    zen: options.chrome.zen,
    bundle: true,
    state: options.state,
    body: `
${options.state === undefined ? loadingHtml('Loading calendar…') : '<main id="app"></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
