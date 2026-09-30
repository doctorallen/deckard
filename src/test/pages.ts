import type * as vscode from 'vscode';

import type { EntryRelatedNotesDiagnostic } from '../ui/webview/sidebarNotes';
import { getCalendarHtml } from '../ui/webview/calendarHtml';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getHelpHtml, HelpManifest, HelpOptions } from '../ui/webview/helpHtml';
import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { getRelatedNotesDebugHtml } from '../ui/webview/relatedNotesDebugHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { getStatsHtml } from '../ui/webview/statsHtml';
import { getTaskBoardHtml } from '../ui/webview/taskBoardHtml';

/**
 * What a page is rendered against: the stand-in webview, the extension's
 * folder, and what Help reads from the manifest and the changelog.
 *
 * The mocha suites and the Node harnesses (test/ui/pages.js) each pass their
 * own, since each already renders against its own stand-in and a change to
 * it would change what the page links to.
 */
export interface PageContext {
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>;
  extensionUri: vscode.Uri;
  help?: { manifest?: HelpManifest; options?: HelpOptions };
}

/** One Deckard webview page, and how to render it. */
export interface CatalogPage {
  /** A stable name, used by the Node harnesses and the visual baselines. */
  id: string;
  /** The page's name in a test's failure message. */
  title: string;
  render(context: PageContext): string;
}

/** The Related Notes debug page needs an entry to diagnose; this is an empty one. */
const EMPTY_DIAGNOSTIC = {
  filePath: 'notes/a.md',
  sourceLine: 1,
  title: 'Entry',
  tags: [],
  snapshot: { activeTags: [], notes: [], tagTitleDisplayMode: 'inline', state: 'ready' },
} as unknown as EntryRelatedNotesDiagnostic;

/**
 * Every Deckard webview page, rendered once each, so a new page is added here
 * and every check that walks the pages covers it.
 */
export const PAGES: readonly CatalogPage[] = [
  { id: 'dashboard', title: 'Dashboard', render: (context) => getDashboardHtml(context.webview, context.extensionUri) },
  { id: 'searchPage', title: 'search page', render: (context) => getSearchPageHtml(context.webview) },
  { id: 'sidebarNotes', title: 'Related Notes', render: (context) => getSidebarNotesHtml(context.webview, '1.0.0') },
  { id: 'notesGraph', title: 'Notes Graph', render: (context) => getNotesGraphHtml(context.webview) },
  {
    id: 'help',
    title: 'Help',
    render: (context) => getHelpHtml(context.webview, context.extensionUri, context.help?.manifest, context.help?.options),
  },
  { id: 'stats', title: 'Stats', render: (context) => getStatsHtml(context.webview as vscode.Webview) },
  { id: 'taskBoard', title: 'Task Board', render: (context) => getTaskBoardHtml(context.webview as vscode.Webview) },
  { id: 'calendar', title: 'Calendar', render: (context) => getCalendarHtml(context.webview as vscode.Webview) },
  {
    id: 'calendarPage',
    title: 'Calendar page',
    render: (context) => getCalendarHtml(context.webview as vscode.Webview, { page: true }),
  },
  {
    id: 'relatedNotesDebug',
    title: 'Related Notes debug',
    render: (context) => getRelatedNotesDebugHtml(context.webview, EMPTY_DIAGNOSTIC),
  },
];

/**
 * The pages a suite walks, as `[title, render]` pairs bound to one context.
 * @param context What each page renders against.
 * @param ids The pages to include, in catalog order; every page when omitted.
 */
export function renderablePages(context: PageContext, ids?: readonly string[]): Array<[string, () => string]> {
  return PAGES
    .filter((page) => !ids || ids.includes(page.id))
    .map((page) => [page.title, () => page.render(context)]);
}
