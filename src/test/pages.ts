import type * as vscode from 'vscode';

import type { EntryRelatedNotesDiagnostic } from '../ui/webview/sidebarNotes';
import { getCalendarHtml } from '../ui/webview/calendarHtml';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getHelpHtml, HelpOptions } from '../ui/webview/helpHtml';
import type { HelpManifest } from '../ui/webview/pages/help/helpManifest';
import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { getRelatedNotesDebugHtml } from '../ui/webview/relatedNotesDebugHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { getStatsHtml } from '../ui/webview/statsHtml';
import { getTaskBoardHtml } from '../ui/webview/taskBoardHtml';
import { pageExtensionUri, pageWebview } from './pageWebview';

/**
 * What a page is rendered with besides the stand-in webview: what Help reads
 * from the manifest and the changelog, and the entry the Related Notes debug
 * page diagnoses.
 */
export interface PageOptions {
  help?: { manifest?: HelpManifest; options?: HelpOptions };
  diagnostic?: EntryRelatedNotesDiagnostic;
}

/**
 * What a page is rendered against: the stand-in webview of `pageWebview.ts`,
 * the repository as the extension's folder, and the page's own options.
 */
export interface PageContext extends PageOptions {
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>;
  extensionUri: vscode.Uri;
}

/** The name of every page in the catalog. */
export type PageId =
  | 'dashboard'
  | 'searchPage'
  | 'sidebarNotes'
  | 'notesGraph'
  | 'help'
  | 'stats'
  | 'taskBoard'
  | 'calendar'
  | 'calendarPage'
  | 'relatedNotesDebug';

/** One Deckard webview page, and how to render it. */
export interface CatalogPage {
  /** A stable name, used by the Node harnesses and the visual baselines. */
  id: PageId;
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
  { id: 'searchPage', title: 'search page', render: (context) => getSearchPageHtml(context.webview, context.extensionUri) },
  { id: 'sidebarNotes', title: 'Related Notes', render: (context) => getSidebarNotesHtml(context.webview, context.extensionUri, '1.0.0') },
  { id: 'notesGraph', title: 'Notes Graph', render: (context) => getNotesGraphHtml(context.webview, context.extensionUri) },
  {
    id: 'help',
    title: 'Help',
    render: (context) => getHelpHtml(context.webview, context.extensionUri, context.help?.manifest, context.help?.options),
  },
  { id: 'stats', title: 'Stats', render: (context) => getStatsHtml(context.webview as vscode.Webview, context.extensionUri) },
  { id: 'taskBoard', title: 'Task Board', render: (context) => getTaskBoardHtml(context.webview as vscode.Webview, context.extensionUri) },
  { id: 'calendar', title: 'Calendar', render: (context) => getCalendarHtml(context.webview as vscode.Webview, context.extensionUri) },
  {
    id: 'calendarPage',
    title: 'Calendar page',
    render: (context) => getCalendarHtml(context.webview as vscode.Webview, context.extensionUri, { page: true }),
  },
  {
    id: 'relatedNotesDebug',
    title: 'Related Notes debug',
    render: (context) => getRelatedNotesDebugHtml(context.webview, context.extensionUri, context.diagnostic ?? EMPTY_DIAGNOSTIC),
  },
];

/**
 * Renders one page as its host would, against the one stand-in webview, so a
 * builder's signature changes in this file alone.
 * @param id The catalog name of the page to render.
 * @param options What the page renders with besides the webview.
 */
export function renderPage(id: PageId, options: PageOptions = {}): string {
  const page = PAGES.find((entry) => entry.id === id);
  if (!page) {
    throw new Error(`The page catalog has no page ${id}.`);
  }
  return page.render({ webview: pageWebview, extensionUri: pageExtensionUri(), ...options });
}

/**
 * The pages a suite walks, as `[title, render]` pairs.
 * @param ids The pages to include, in catalog order; every page when omitted.
 * @param options What each page renders with besides the webview.
 */
export function renderablePages(ids?: readonly PageId[], options: PageOptions = {}): Array<[string, () => string]> {
  return PAGES
    .filter((page) => !ids || ids.includes(page.id))
    .map((page) => [page.title, () => renderPage(page.id, options)]);
}
