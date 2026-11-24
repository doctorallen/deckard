/**
 * Page maps: what Help's This page lists for a page (plan 48, section 2).
 *
 * A map holds pointers, never prose. Each entry names the element it rings
 * on the page (`data-help-id`), the guide section that explains it, and,
 * where a control is the same on every page, the section of this page's
 * guide that names it; and the settings and choices that change it. Help
 * draws an entry's name from its section's heading and its words from the
 * section, so This page and the guide cannot say different things.
 */

/** A choice the page keeps for itself, which Help can change: the board's own preferences and its Can start now. */
export type PageHelpChoice = 'group' | 'lanes' | 'sort' | 'layout' | 'available';

/** One thing on a page. */
export interface PageHelpEntry {
  /** Its id in the map, and the `data-help-id` it rings unless `ring` says another. */
  id: string;
  /** What you can do on the page, or a control on it. */
  kind: 'feature' | 'control';
  /** The guide section that explains it, as `page#anchor`. */
  guide: string;
  /**
   * For a control documented once for every page, such as the search box:
   * the section of this page's guide, and the words, that say how it is
   * here, such as the board's "Refine counts only tasks".
   */
  onThisPage?: { guide: string; mentions: string };
  /** The `data-help-id` Show me rings, when not `id`. */
  ring?: string;
  /** Other `data-help-id`s that pick this entry in Point at something. */
  picks?: readonly string[];
  /** The settings that change it, by key without `deckard.`. */
  settings?: readonly string[];
  /** The page's own choice it is, which Help can change. */
  choice?: PageHelpChoice;
}

/** What This page knows of one page. */
export interface PageHelpMap {
  /** The page, by its host's name, as the open-pages registry knows it. */
  page: string;
  /** The page's title, as This page heads it. */
  title: string;
  /** The guide page about it; Open in the guide without a section goes there. */
  guidePage: string;
  entries: readonly PageHelpEntry[];
  /** The settings that change the page, in the order This page lists them. */
  settings: readonly string[];
}

/** The Task board's map, the first page Help knows (plan 48). */
export const TASK_BOARD_HELP: PageHelpMap = {
  page: 'Task board',
  title: 'Task board',
  guidePage: 'task-board',
  entries: [
    { id: 'move', kind: 'feature', guide: 'task-board#moving-a-card', ring: 'card-menu', settings: ['tasks.statuses'] },
    { id: 'keep', kind: 'feature', guide: 'task-board#keeping-a-search', ring: 'page-menu' },
    { id: 'limits', kind: 'feature', guide: 'task-board#work-in-progress-limits', settings: ['board.limits'] },
    { id: 'top-strip', kind: 'feature', guide: 'task-board#top-three', settings: ['tasks.topCount'] },
    { id: 'keyboard', kind: 'feature', guide: 'task-board#keyboard', ring: 'card-menu' },
    {
      id: 'search',
      kind: 'control',
      guide: 'search#the-search-box',
      onThisPage: { guide: 'task-board#searching-and-filtering', mentions: 'search box' },
    },
    { id: 'group', kind: 'control', guide: 'task-board#groupings', choice: 'group', settings: ['tasks.statuses'] },
    { id: 'lanes', kind: 'control', guide: 'task-board#lanes', choice: 'lanes' },
    { id: 'sort', kind: 'control', guide: 'task-board#sorting-and-ranking', choice: 'sort' },
    { id: 'view', kind: 'control', guide: 'task-board#table', choice: 'layout' },
    { id: 'canstart', kind: 'control', guide: 'task-board#can-start-now', choice: 'available' },
    {
      id: 'refine',
      kind: 'control',
      guide: 'search#refine',
      onThisPage: { guide: 'task-board#searching-and-filtering', mentions: 'Refine' },
    },
    { id: 'add', kind: 'control', guide: 'task-board#adding-a-task', picks: ['column-add'] },
    {
      id: 'card-menu',
      kind: 'control',
      guide: 'task-board#a-cards-menu',
      settings: ['display.cardDetails', 'me', 'tasks.checkboxClick'],
    },
    { id: 'page-menu', kind: 'control', guide: 'task-board#the-boards-menu', settings: ['theme', 'display.zen'] },
  ],
  settings: [
    'board.limits',
    'display.cardDetails',
    'me',
    'tasks.checkboxClick',
    'tasks.statuses',
    'tasks.needsNewDateAfterDays',
    'tasks.topCount',
    'display.zen',
    'theme',
  ],
};

/** Every page Help has a map of. */
export const PAGE_HELP_MAPS: readonly PageHelpMap[] = [TASK_BOARD_HELP];

/** The map of a page, by its host's name, or undefined when Help has none. */
export function pageHelpFor(page: string | undefined): PageHelpMap | undefined {
  return page ? PAGE_HELP_MAPS.find((map) => map.page === page) : undefined;
}

/** An entry by its id. */
export function findHelpEntry(map: PageHelpMap, id: string): PageHelpEntry | undefined {
  return map.entries.find((entry) => entry.id === id);
}

/** The entry a `data-help-id` picked in Point at something stands for, or undefined. */
export function entryForPick(map: PageHelpMap, helpId: string): PageHelpEntry | undefined {
  return (
    map.entries.find((entry) => entry.id === helpId && entry.kind === 'control') ??
    map.entries.find((entry) => entry.picks?.includes(helpId)) ??
    map.entries.find((entry) => entry.id === helpId) ??
    map.entries.find((entry) => entry.ring === helpId && entry.kind === 'control')
  );
}

/** The `data-help-id` Show me rings for an entry. */
export function ringOf(entry: PageHelpEntry): string {
  return entry.ring ?? entry.id;
}

/** A guide reference, `page#anchor`, as its parts. */
export function splitGuideRef(ref: string): { page: string; anchor?: string } {
  const at = ref.indexOf('#');
  return at < 0 ? { page: ref } : { page: ref.slice(0, at), anchor: ref.slice(at + 1) };
}
