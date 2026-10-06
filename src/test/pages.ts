import type { CalendarSnapshot } from '../ui/protocol/calendar';
import type { SidebarNotesPageState } from '../ui/protocol/sidebarNotes';
import type { DeckardStatsSnapshot } from '../ui/protocol/stats';
import type { NotePageSnapshot } from '../ui/protocol/notePage';
import { getNotePageHtml } from '../ui/webview/notePageHtml';
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
import { getPagesViewHtml } from '../ui/webview/pagesViewHtml';
import type { PagesViewSnapshot } from '../ui/protocol/pagesView';
import type { ShellUri, ShellWebview } from '../ui/webview/host/pageShell';
import { pageExtensionUri, pageWebview } from './pageWebview';
import type { EntryRelatedNotesDiagnostic } from '../ui/state/relatedNotesRanking';
import type { PageChrome } from '../ui/webview/components';

/**
 * What a page is rendered with besides the stand-in webview: what Help reads
 * from the manifest and the changelog, and the entry the Related Notes debug
 * page diagnoses.
 */
export interface PageOptions {
  /**
   * The look the page is written in, which a host reads from the settings
   * and the theme preview; Corpo with zen off, the settings' defaults, when
   * omitted.
   */
  chrome?: PageChrome;
  help?: { manifest?: HelpManifest; options?: Omit<HelpOptions, 'chrome'> };
  diagnostic?: EntryRelatedNotesDiagnostic;
  /**
   * The snapshot the shell carries as inert JSON, for a page that reads
   * one (`readsInertState`); a page drawn without it waits for a post.
   */
  state?: unknown;
}

/**
 * What a page is rendered against: the stand-in webview of `pageWebview.ts`,
 * the repository as the extension's folder, the look, and the page's own
 * options.
 */
export interface PageContext extends PageOptions {
  webview: ShellWebview;
  extensionUri: ShellUri;
  chrome: PageChrome;
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
  | 'relatedNotesDebug'
  | 'notePage'
  | 'pagesView';

/** One Deckard webview page, and how to render it. */
export interface CatalogPage {
  /** A stable name, used by the Node harnesses and the visual baselines. */
  id: PageId;
  /** The page's name in a test's failure message. */
  title: string;
  render(context: PageContext): string;
  /**
   * Whether the page draws a snapshot its shell carries as inert JSON, so
   * test:dom draws its surfaces both ways, embedded and posted, and holds
   * the two to the same DOM (docs/implementation/20-webviews.md §2.3).
   */
  readsInertState?: true;
}

/** The look a page is written in when a test names none: the settings' defaults. */
const DEFAULT_CHROME: PageChrome = { theme: 'corpo', zen: false };

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
  { id: 'dashboard', title: 'Dashboard', render: (context) => getDashboardHtml(context.webview, context.extensionUri, context.chrome) },
  { id: 'searchPage', title: 'search page', render: (context) => getSearchPageHtml(context.webview, context.extensionUri, context.chrome) },
  {
    id: 'sidebarNotes',
    title: 'Related Notes',
    render: (context) => getSidebarNotesHtml(context.webview, context.extensionUri, '1.0.0', { chrome: context.chrome, snapshot: context.state as SidebarNotesPageState | undefined }),
    readsInertState: true,
  },
  { id: 'notesGraph', title: 'Notes Graph', render: (context) => getNotesGraphHtml(context.webview, context.extensionUri, context.chrome) },
  {
    id: 'help',
    title: 'Help',
    // The shortcuts are drawn for one platform, so the DOM goldens match on every OS.
    render: (context) => getHelpHtml(context.webview, context.extensionUri, context.help?.manifest, { platform: 'darwin', ...context.help?.options, chrome: context.chrome }),
  },
  {
    id: 'stats',
    title: 'Stats',
    render: (context) => getStatsHtml(context.webview, context.extensionUri, context.chrome, context.state as DeckardStatsSnapshot | undefined),
    readsInertState: true,
  },
  { id: 'taskBoard', title: 'Task Board', render: (context) => getTaskBoardHtml(context.webview, context.extensionUri, context.chrome) },
  {
    id: 'notePage',
    title: 'Note page',
    render: (context) => getNotePageHtml(context.webview, context.extensionUri, context.chrome, context.state as NotePageSnapshot | undefined),
    readsInertState: true,
  },
  {
    id: 'calendar',
    title: 'Calendar',
    render: (context) => getCalendarHtml(context.webview, context.extensionUri, { chrome: context.chrome, state: context.state as CalendarSnapshot | undefined }),
    readsInertState: true,
  },
  {
    id: 'calendarPage',
    title: 'Calendar page',
    render: (context) => getCalendarHtml(context.webview, context.extensionUri, { page: true, chrome: context.chrome, state: context.state as CalendarSnapshot | undefined }),
    readsInertState: true,
  },
  {
    id: 'relatedNotesDebug',
    title: 'Related Notes debug',
    render: (context) => getRelatedNotesDebugHtml(context.webview, context.extensionUri, context.diagnostic ?? EMPTY_DIAGNOSTIC, context.chrome),
  },
  {
    id: 'pagesView',
    title: 'Pages',
    render: (context) => getPagesViewHtml(context.webview, context.extensionUri, context.chrome, context.state as PagesViewSnapshot | undefined),
    readsInertState: true,
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
  return page.render({ webview: pageWebview, extensionUri: pageExtensionUri(), ...options, chrome: options.chrome ?? DEFAULT_CHROME });
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
