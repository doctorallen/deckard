/**
 * A search page's protocol: the notes and tasks one search finds, a tag's
 * page when the search is one tag, and the messages the page sends.
 */
import type { FrontmatterProperty } from '../../domain/model/notes';
import type {
  DashboardColumnCount,
  RenderMode,
  SearchPageSize,
  SearchPreview,
  TagOverviewLayout,
  TagOverviewSortMode,
} from '../../domain/model/preferences';
import type { QueryViewState } from '../../domain/model/query';
import type { EntityKind } from '../../domain/model/tags';
import type { IndexingMessage, MessageAs, MessageOf, StateMessage } from './messaging';
import type {
  ChooseThemeMessage,
  DashboardTask,
  ExportResultsMessage,
  MergeTagsMessage,
  OpenHelpMessage,
  OpenSourceMessage,
  OpenTagMessage,
  ParkTagMessage,
  PinNoteMessage,
  RenameTagMessage,
  ResultPaging,
  SetZenModeMessage,
  TagOverviewCard,
  TagTitleDisplayMode,
  ToggleTaskMessage,
} from './shared';

/** The tag a search page is about, as the page draws it. */
export interface SearchPageTag {
  key: string;
  label: string;
  count: number;
  isFavorite: boolean;
  hubFilePaths?: string[];
}

/** The entity a search page is about, as the page draws it. */
export interface SearchPageEntity {
  key: string;
  label: string;
  kind: EntityKind;
  name: string;
  count: number;
}

/**
 * A search page: the notes and tasks one search finds.
 *
 * When the search is exactly one tag, the page is that tag's overview and also
 * carries the tag, its entity, and its hub note. Any other search is described
 * by its search box alone.
 */
export interface SearchPageSnapshot {
  /** Whether the page has a search to go back to, and one to go forward to. */
  history?: { back: boolean; forward: boolean };
  /** The tag the page is about, when the search is that one tag. */
  tag?: SearchPageTag;
  entity?: SearchPageEntity;
  /** The note that describes the tag. */
  hub?: TagOverviewHub;
  /** What a tag's page says under its hub: how else it is reached. */
  tagPage?: SearchPageTagNotes;
  /** The search box's state, and the facets that could narrow it. */
  query: QueryViewState;
  /** The search the page was opened with, which Clear returns to. */
  originQuery: string;
  savedViewName?: string;
  /** The note cards of the page being shown. */
  sections: TagOverviewCard[];
  /** Which page of notes these are, and how many there are in all. */
  notePaging: ResultPaging;
  tasks: DashboardTask[];
  /** Which page of tasks these are, and how many there are in all. */
  taskPaging: ResultPaging;
  /** Counts before the active completion filter is applied. */
  taskCounts: {
    all: number;
    active: number;
    completed: number;
  };
  renderMode: RenderMode;
  /** How much of each result the page shows. */
  preview: SearchPreview;
  sortMode: TagOverviewSortMode;
  layout: TagOverviewLayout;
  /** The page sizes the reader can choose between. */
  pageSizes: readonly SearchPageSize[];
  noteColumns: DashboardColumnCount;
  taskColumns: DashboardColumnCount;
  tagTitleDisplayMode: TagTitleDisplayMode;
  /**
   * Whether the Related Notes sidebar is showing this search's Refine
   * options, so the page shows a line in their place.
   */
  refineInSidebar?: boolean;
  /**
   * A search that finds nothing, written again with each misspelled word
   * replaced by the closest word the notes contain.
   */
  suggestion?: string;
  /**
   * The words being typed into the search box that are narrowing these
   * results, before they are committed to the search itself.
   */
  draftWords?: string[];
}

/** The quiet lines under a tag's page's hub. */
export interface SearchPageTagNotes {
  /** Other spellings of the tag, most confusable first, at most three. */
  lookalikes: Array<{
    key: string;
    label: string;
    count: number;
    /** The merge Stats offers: the rarer spelling into the more used. */
    sourceKey: string;
    targetKey: string;
  }>;
  /** Entries listed because they link to a hub note without the tag. */
  hubLinkCount: number;
  /** The hub note they link to, by title. */
  hubTitle?: string;
  /** Entries that write the tag's name as a plain word, without the tag. */
  mention?: {
    word: string;
    count: number;
    /** The search that lists them. */
    query: string;
  };
}

/** The hub note that describes a tag, as the top of the tag's page shows it. */
export interface TagOverviewHub {
  filePath: string;
  fileName: string;
  /** The note's body after its front matter. */
  rawContent: string;
  renderedHtml: string;
  properties: FrontmatterProperty[];
  /** Other notes that also describe the tag. */
  otherFilePaths: string[];
  /** Whether the hub starts open, from `deckard.tagOverview.hubNoteExpanded`. */
  expanded?: boolean;
}

/** A tag's page asks for a hub note that describes the tag. */
export interface CreateHubNoteMessage {
  type: 'createHubNote';
}

/** A tag's page's Leave them out: stop listing what only links the hub. */
export interface ExcludeHubLinksMessage {
  type: 'excludeHubLinks';
}

/** Sets how many columns a search page lays its notes or tasks out in. */
export interface SetSearchColumnsMessage {
  type: 'setSearchColumns';
  section: 'notes' | 'tasks';
  columns: DashboardColumnCount;
}

/** Park Note or Unpark Note, from a search card's menu. */
export interface ParkNoteMessage {
  type: 'parkNote' | 'unparkNote';
  filePath: string;
}

/** Names a search page's search and keeps it as a saved view. */
export interface SaveTagOverviewFilterMessage {
  type: 'saveTagOverviewFilter';
}

/**
 * Runs a search on a search page.
 *
 * The webview sends query text whether the author typed it in the query bar
 * or assembled it in the builder, so the host only ever has one
 * representation to validate and evaluate.
 */
export interface SetOverviewQueryMessage {
  type: 'setOverviewQuery';
  query: string;
  /**
   * Whether this search is worth keeping in the recent searches. A search
   * typed or built is; one that only follows a facet click or a dropped chip
   * is a step along the way, and would evict the typed ones.
   */
  remember?: boolean;
}

/**
 * Returns a search page to the search it was opened with.
 */
export interface ClearOverviewQueryMessage {
  type: 'clearOverviewQuery';
}

/**
 * Steps a search page back or forward through the searches it has shown,
 * sent by the mouse's back and forward buttons.
 */
export interface NavigateSearchHistoryMessage {
  type: 'navigateSearchHistory';
  direction: 'back' | 'forward';
}

/**
 * Narrow a search page by the words being typed, before they are committed
 * to its search box.
 */
export interface PreviewSearchMessage {
  type: 'previewSearch';
  words: string[];
}

/** Choose how many results a search page shows at a time. */
export interface SetResultsPerPageMessage {
  type: 'setResultsPerPage';
  size: SearchPageSize;
}

/**
 * Edit every result of a search at once: the page asks, and the host offers
 * the edits its results can take.
 */
export interface EditResultsMessage {
  type: 'editResults';
  kind: 'notes' | 'tasks';
}

/** Turn one of a search page's lists to another of its pages. */
export interface SetResultPageMessage {
  type: 'setResultPage';
  kind: 'notes' | 'tasks';
  /** 1-based, and clamped to the pages the search actually has. */
  page: number;
}

/** Chooses how a search page orders its notes. */
export interface SetTagOverviewSortMessage {
  type: 'setTagOverviewSort';
  mode: TagOverviewSortMode;
}

/**
 * Chooses whether a search page shows notes and tasks as tabs or side by
 * side.
 */
export interface SetTagOverviewLayoutMessage {
  type: 'setTagOverviewLayout';
  layout: TagOverviewLayout;
}

/** Chooses how much of each result a search page shows. */
export interface SetSearchPreviewMessage {
  type: 'setSearchPreview';
  preview: SearchPreview;
}

/** Chooses whether a search page shows note bodies rendered or as source. */
export interface SetRenderModeMessage {
  type: 'setRenderMode';
  mode: RenderMode;
}

/**
 * What a search page sends its host, by type. A message that serves two
 * types, such as Park Tag and Unpark Tag, is listed under each.
 */
export interface SearchPagePageToHost {
  exportResults: ExportResultsMessage;
  setZenMode: SetZenModeMessage;
  chooseTheme: ChooseThemeMessage;
  pinNote: MessageAs<PinNoteMessage, 'pinNote'>;
  unpinNote: MessageAs<PinNoteMessage, 'unpinNote'>;
  openHelp: OpenHelpMessage;
  openSource: OpenSourceMessage;
  toggleTask: ToggleTaskMessage;
  setRenderMode: SetRenderModeMessage;
  setSearchPreview: SetSearchPreviewMessage;
  openTag: OpenTagMessage;
  renameTag: RenameTagMessage;
  parkTag: MessageAs<ParkTagMessage, 'parkTag'>;
  unparkTag: MessageAs<ParkTagMessage, 'unparkTag'>;
  parkNote: MessageAs<ParkNoteMessage, 'parkNote'>;
  unparkNote: MessageAs<ParkNoteMessage, 'unparkNote'>;
  setTagOverviewSort: SetTagOverviewSortMessage;
  setTagOverviewLayout: SetTagOverviewLayoutMessage;
  setSearchColumns: SetSearchColumnsMessage;
  saveTagOverviewFilter: SaveTagOverviewFilterMessage;
  setOverviewQuery: SetOverviewQueryMessage;
  clearOverviewQuery: ClearOverviewQueryMessage;
  navigateSearchHistory: NavigateSearchHistoryMessage;
  setResultPage: SetResultPageMessage;
  setResultsPerPage: SetResultsPerPageMessage;
  previewSearch: PreviewSearchMessage;
  editResults: EditResultsMessage;
  createHubNote: CreateHubNoteMessage;
  excludeHubLinks: ExcludeHubLinksMessage;
  mergeTags: MergeTagsMessage;
}

/**
 * What a search page is sent as its state: its snapshot, with the tags
 * parked from search. In the Markdown view each card is sent without its
 * rendered HTML, since that view shows the note's source.
 */
export interface SearchPageState extends SearchPageSnapshot {
  parkedTags: string[];
}

/** What the host sends a search page, by type. */
export interface SearchPageHostToPage {
  state: StateMessage<SearchPageState>;
  indexing: IndexingMessage;
}

/** Messages from a search page. */
export type SearchPageMessage = MessageOf<SearchPagePageToHost>;
