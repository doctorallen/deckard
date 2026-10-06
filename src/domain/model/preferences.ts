/**
 * The persisted preferences: what Deckard keeps between sessions, and the
 * choices it is made of.
 *
 * Several of these are a page's view state (the Dashboard's tab, a search
 * page's sort and layout, the Task Board's layout and table columns). They
 * live here rather than in `ui/protocol` because the persisted format owns
 * them: a change to one is a change to what is stored.
 */

/**
 * How a list of tags or entities is ordered: by name, by how many entries
 * carry each, by how often each was opened, or in the order the reader
 * dragged them into.
 */
export type TagSortMode = 'alphabetical' | 'count' | 'access' | 'custom';

/**
 * How a list of tasks is ordered: in the reader's own ranked order, or by
 * when each was created or last updated.
 */
export type TaskSortMode = 'rank' | 'created' | 'updated';

/** How many columns a Dashboard or search page lays a list out in. */
export type DashboardColumnCount = 1 | 2 | 3 | 4;

/** How a search page orders the notes it found. */
export type TagOverviewSortMode =
  | 'alphabetical'
  | 'created'
  | 'updated'
  | 'access';

/** Whether a search page shows its notes and tasks as tabs or side by side. */
export type TagOverviewLayout = 'tabs' | 'split';

/**
 * The page sizes a search page offers.
 *
 * Thirty is a screenful or two, which is what a reader looks through before
 * narrowing the search instead. The larger sizes are for reading a whole
 * result through, and cost more to send and draw the larger they are.
 */
export const SEARCH_PAGE_SIZES = [10, 30, 50, 100, 200] as const;

/** One of the page sizes a search page offers. */
export type SearchPageSize = (typeof SEARCH_PAGE_SIZES)[number];

/** The page size a search page uses until the reader chooses another. */
export const DEFAULT_SEARCH_PAGE_SIZE: SearchPageSize = 30;

/** How Related Notes orders its list. */
export type RelatedNotesSortMode = 'newest' | 'oldest' | 'tags' | 'access';

/**
 * The Dashboard's tabs: Home, and Tags. Searches open search pages, and tasks
 * have the Task Board.
 */
export type DashboardMode = 'home' | 'browse';

/** The Dashboard lists a search box can filter: only the Tags tab has one. */
export type DashboardSearchField = 'tags';

/** Which Dashboard tab was shown, and what its tag filter held. */
export interface DashboardViewState {
  mode: DashboardMode;
  tagSearchQuery: string;
}

/** The widgets Home can show. */
export type DashboardWidgetKind =
  | 'search'
  | 'tasks'
  | 'agenda'
  | 'favoriteTags'
  | 'topTags'
  | 'savedSearches'
  | 'recentSearches'
  | 'recentNotes'
  | 'stats'
  | 'savedQuery'
  | 'todayNote'
  | 'quickAdd'
  | 'staleTasks'
  | 'relatedNotes'
  | 'tagPairs'
  | 'unhubbedTags'
  | 'newTags'
  | 'quietPeople'
  | 'progress'
  | 'pinnedNotes'
  | 'tryNext';

/** Whether a widget takes one of Home's two columns or both. */
export type DashboardWidgetWidth = 'half' | 'full';

/** One widget on Home, as the reader arranged it. */
export interface DashboardWidgetConfig {
  /** Unique on the page, so a kind that can repeat is told apart. */
  id: string;
  kind: DashboardWidgetKind;
  width: DashboardWidgetWidth;
  /** How many entries a list widget shows, or holds on a page when paged. */
  count?: number;
  /**
   * Whether the widget pages through everything it found rather than showing
   * the first few and leaving the rest to the view it links to.
   */
  paged?: boolean;
  /** Which page it is showing, 1-based and clamped to the pages it has. */
  page?: number;
  /** The search a tasks widget lists. */
  query?: string;
  /** The saved search a saved-search widget shows. */
  filterId?: string;
  /**
   * How many days a widget looks back: how long a stale task's note has gone
   * unchanged, or how recently a new tag was first seen.
   */
  days?: number;
  /**
   * The namespace Gone quiet watches, `person` by default, or whose tags
   * Progress lists, `project` by default.
   */
  namespace?: string;
  /** Whether Gone quiet lists only the tags with no open task. */
  noOpenTasks?: boolean;
}

/** Whether a search page shows note bodies as Markdown source or rendered. */
export type RenderMode = 'markdown' | 'html';

/** How much of each result a search page shows: none, three lines, or all. */
export type SearchPreview = 'none' | 'lines' | 'full';

/**
 * Whether a search page lists its results as they come, groups them under
 * the tags Refine offers, or nests them the way their headings nest.
 */
export type SearchHierarchy = 'off' | 'tags' | 'headings';

/** Everything Deckard keeps between sessions, in the shape it is stored in. */
export interface PersistedPreferences {
  version: 1;
  favoriteTags: string[];
  favoriteEntities: string[];
  tagSortMode: TagSortMode;
  entitySortMode: TagSortMode;
  tagAccessOrder: string[];
  tagAccessCounts: Record<string, number>;
  entityAccessOrder: string[];
  entityAccessCounts: Record<string, number>;
  taskOrder: string[];
  taskSortMode: TaskSortMode;
  dashboardTaskColumns: DashboardColumnCount;
  dashboardNoteColumns: DashboardColumnCount;
  dashboardTagColumns: DashboardColumnCount;
  dashboardViewState: DashboardViewState;
  renderMode: RenderMode;
  /** Set once Format is chosen; a stored Source without it reads as Rendered. */
  renderModeChosen?: true;
  tagOverviewSortMode: TagOverviewSortMode;
  tagOverviewLayout: TagOverviewLayout;
  /** How many notes, and how many tasks, a search page shows at a time. */
  searchPageSize: SearchPageSize;
  /** How much of each result a search page shows. */
  searchPreview: SearchPreview;
  /** A search page groups its results by tag or by heading, in either layout; stored only when on. */
  searchHierarchy?: 'tags' | 'headings';
  relatedNotesSortMode: RelatedNotesSortMode;
  /** Related Notes and Linked from leave out daily, weekly, and monthly notes. */
  hideDailyNotes?: true;
  /** Lines of excerpt on a Related Notes card, when not the default 1. */
  relatedNotesPreviewLines?: 0 | 2;
  /** The results chosen in Find for what was typed, which it offers first. */
  findChoices?: FindChoice[];
  /** The headings Capture and Move to… went under last, newest first. */
  recentHeadings?: PinnedNote[];
  sectionAccessCounts: Record<string, number>;
  savedFilters: SavedFilter[];
  /** When each tag was last opened, in epoch milliseconds, for frecency. */
  tagAccessTimes?: Record<string, number>;
  /** When each note section was last opened, in epoch milliseconds. */
  sectionAccessTimes?: Record<string, number>;
  /** Searches run recently, newest first. */
  recentQueries?: string[];
  /** How the Task Board shows its tasks. */
  taskBoardLayout: TaskLayout;
  /** The table layout's columns, in order; the defaults when unset. */
  taskTableColumns?: TaskColumnId[];
  /** What the table layout is sorted by; unset is the rank order. */
  taskTableSort?: TableSort;
  /** What the Task Board's columns group tasks by. */
  taskBoardGroup: TaskBoardGroupBy;
  /** The namespace whose tags are the board's columns when grouped by tag. */
  taskBoardGroupNamespace?: string;

  /** The widgets on the Dashboard's Home, in order. */
  dashboardWidgets: DashboardWidgetConfig[];
  /**
   * When Deckard first indexed each tag, in epoch milliseconds. Tags already
   * in use when this began to be kept are 0, so none of them count as new.
   */
  tagFirstSeen?: Record<string, number>;
  /** Notes pinned to Home, by path, in the order they were pinned. */
  pinnedNotes?: PinnedNote[];
}

/**
 * A named, reusable view: either an intersection of at least two canonical tag
 * keys, or a Deckard query when the view needs more than an intersection.
 */
export interface SavedFilter {
  id: string;
  name: string;
  tagKeys: string[];
  /** Present when the saved view was created from an advanced query. */
  query?: string;
  /** Set when the search was saved on the Task Board, which reopens it. */
  page?: 'taskBoard';
}

/** What Find learned: the result chosen after typing a search. */
export interface FindChoice {
  /** What was typed, trimmed, lowercased, spaces collapsed. */
  input: string;
  /** The result, by what it is rather than where it sits. */
  key: string;
  count: number;
  /** When it was last chosen. */
  at: number;
}

/**
 * A note pinned to Home: an entry of a file, or the file itself.
 *
 * A note in Deckard is a heading and what is written under it, so a pin
 * names one. It is kept as what a reader would use to find that heading
 * again rather than as the section's id, which is a hash of the heading's
 * line and text and changes whenever anything above it is written.
 */
export interface PinnedNote {
  filePath: string;
  /** The heading it pins, as written; absent when it pins the whole note. */
  heading?: string;
  headingLevel?: number;
  /** Which heading of that text and level it is, counted from zero. */
  occurrence?: number;
}

/** How the task board arranges its columns. */
export type TaskBoardGroupBy = 'status' | 'priority' | 'due' | 'assignee' | 'tag';

/** Whether the Task Board shows its tasks as a list or as columns. */
export type TaskLayout = 'list' | 'board' | 'table';

/**
 * A table of tasks: the query's results as rows, its fields as columns. The
 * model that makes the cells and sorts the rows is `resultTable.ts`; these
 * are the names a snapshot, a message, and a preference carry.
 */
export type TaskColumnId =
  | 'title'
  | 'due'
  | 'scheduled'
  | 'start'
  | 'done'
  | 'priority'
  | 'assignee'
  | 'status'
  | 'tags'
  | 'note'
  | 'created'
  | 'updated'
  | 'blockedBy'
  | 'id';

/** Which way a table column sorts: ascending or descending. */
export type TableSortDirection = 'asc' | 'desc';

/** The column a task table is ordered by, and which way. */
export interface TableSort {
  column: TaskColumnId;
  direction: TableSortDirection;
}
