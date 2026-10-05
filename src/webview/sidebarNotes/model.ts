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
 * the template's script kept it, and, since the view is not kept running
 * while hidden (Q1), kept with setState too, so a view VS Code loads again
 * when it is shown, or after a reload, comes back as the reader left it.
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
  linksOpen: { linked: boolean; mentions: boolean; sections: boolean };
  /** Whether every heading of a long note shows in Sections, past its first dozen. */
  showAllSections: boolean;
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

/** The strings of a kept list, or none when what was kept is not a list. */
function keptStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** A kept flag, or `fallback` when what was kept is not one. */
function keptFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * What the reader chose, read back from what the view kept with setState
 * the last time it was drawn: a value of the wrong kind reads as the
 * choice a new view starts with.
 */
export function readChoices(kept: Readonly<Record<string, unknown>>): SidebarChoices {
  const limit = kept.noteLimit;
  const links = kept.linksOpen && typeof kept.linksOpen === 'object' ? (kept.linksOpen as Record<string, unknown>) : {};
  return {
    noteLimit: typeof limit === 'number' && Number.isFinite(limit) && limit > NOTE_PAGE_SIZE ? limit : NOTE_PAGE_SIZE,
    noteListKey: typeof kept.noteListKey === 'string' ? kept.noteListKey : '',
    showEveryActiveTag: kept.showEveryActiveTag === true,
    contextOpen: kept.contextOpen === true,
    linksOpen: { linked: keptFlag(links.linked, true), mentions: keptFlag(links.mentions, false), sections: keptFlag(links.sections, true) },
    showAllSections: kept.showAllSections === true,
    openLinkSections: new Set(keptStrings(kept.openLinkSections)),
    expandedRefine: new Set(keptStrings(kept.expandedRefine)),
    shownGroups: keptStrings(kept.shownGroups),
  };
}

/** The reader's choices as the view keeps them with setState: the sets as lists. */
export function choicesToKeep(choices: SidebarChoices): Record<string, unknown> {
  return {
    noteLimit: choices.noteLimit,
    noteListKey: choices.noteListKey,
    showEveryActiveTag: choices.showEveryActiveTag,
    contextOpen: choices.contextOpen,
    linksOpen: { ...choices.linksOpen },
    showAllSections: choices.showAllSections,
    openLinkSections: [...choices.openLinkSections],
    expandedRefine: [...choices.expandedRefine],
    shownGroups: [...choices.shownGroups],
  };
}
