/**
 * What Related Notes draws from: the host's last state, and what the reader
 * chose in the sidebar since, which the host never hears of.
 */
import type { SidebarNotesPageState, SidebarNotesSnapshot } from '../../ui/protocol/sidebarNotes';

/** The page's store: the state the host sent last, once it has sent one. */
export interface SidebarStore {
  readonly snapshot: SidebarNotesPageState | undefined;
}

/**
 * What the reader chose in the sidebar, kept across the host's states as
 * the template's script kept it.
 */
export interface SidebarChoices {
  /** How many results the list draws; Show more adds a page. */
  noteLimit: number;
  /** The list the limit counts for; a different list starts over. */
  noteListKey: string;
  /** Whether every one of the note's tags is listed, not only the first few. */
  showEveryActiveTag: boolean;
  /** Whether the entry being ranked from, and its tags, are unfolded. */
  contextOpen: boolean;
  /** Which of the Links groups are open. */
  linksOpen: { linked: boolean; mentions: boolean };
  /** The link rows unfolded onto their section, by `filePath:line`. */
  openLinkSections: Set<string>;
  /** The Refine facets opened past their first five, by id. */
  expandedRefine: Set<string>;
  /** The calendar day's groups the reader asked to see whole. */
  shownGroups: string[];
}

/** A long list is drawn a page at a time; Show more adds the next page. */
export const NOTE_PAGE_SIZE = 50;

/** How many of the note's own tags are listed before the rest are folded. */
export const ACTIVE_TAG_PAGE_SIZE = 4;

/**
 * The states drawn for another page in front, which show neither the note's
 * context, its sort and gear, nor what links to it.
 */
export function isPageInFront(snapshot: SidebarNotesSnapshot): boolean {
  return snapshot.state === 'graph' || snapshot.state === 'refine' || snapshot.state === 'calendarDay' || snapshot.state === 'customizeHome';
}

/** Which list the sidebar shows: a different one starts its Show more count over. */
export function noteListKey(snapshot: SidebarNotesSnapshot): string {
  return JSON.stringify([
    snapshot.state,
    snapshot.activeFileName,
    snapshot.activeEntryTitle,
    snapshot.relatedNotesSortMode,
    snapshot.hideDailyNotes,
    Boolean(snapshot.similar),
  ]);
}

/** How many lines of each excerpt to show: 0, 1, or 2. */
export function previewLines(snapshot: SidebarNotesSnapshot): 0 | 1 | 2 {
  return snapshot.previewLines === 0 || snapshot.previewLines === 2 ? snapshot.previewLines : 1;
}
