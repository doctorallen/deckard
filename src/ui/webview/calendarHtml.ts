import * as vscode from 'vscode';

import type { CalendarSnapshot } from '../protocol/calendar';
import { createNonce, loadingHtml } from './components';
import { buildPageShell } from './host/pageShell';
import { isZenModeEnabled } from './zenMode';
import { type DeckardTheme, getDeckardTheme } from './themes';

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
  webview: vscode.Webview,
  /** The extension's folder, which the page's style sheets and script are under. */
  extensionUri: vscode.Uri,
  options: {
    /** The calendar page, rather than the sidebar's. */
    page?: boolean;
    /** The theme its host read, preview and all; the configured one without. */
    theme?: DeckardTheme;
    /** The snapshot to draw at once, if the shell is to carry one. */
    state?: CalendarSnapshot;
  } = {},
): string {
  return buildPageShell({
    webview,
    extensionUri,
    page: options.page ? 'calendarPage' : 'calendar',
    title: 'Deckard Calendar',
    nonce: createNonce(),
    theme: options.theme ?? getDeckardTheme(),
    zen: isZenModeEnabled(),
    bundle: true,
    state: options.state,
    body: `
${options.state === undefined ? loadingHtml('Loading calendar…') : '<main id="app"></main>'}
<div id="live-status" class="visually-hidden" role="status" aria-live="polite"></div>
`,
  });
}
