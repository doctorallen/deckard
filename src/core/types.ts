import { QueryViewState } from './query/queryTypes';

export type TagSortMode = 'alphabetical' | 'count' | 'access' | 'custom';
export type TaskSortMode = 'rank' | 'created' | 'updated';
export type DashboardColumnCount = 1 | 2 | 3 | 4;
export type TagOverviewSortMode =
  | 'alphabetical'
  | 'created'
  | 'updated'
  | 'access';

export type TagOverviewLayout = 'tabs' | 'split';

/**
 * The page sizes a search page offers.
 *
 * Thirty is a screenful or two, which is what a reader looks through before
 * narrowing the search instead. The larger sizes are for reading a whole
 * result through, and cost more to send and draw the larger they are.
 */
export const SEARCH_PAGE_SIZES = [10, 30, 50, 100, 200] as const;

export type SearchPageSize = (typeof SEARCH_PAGE_SIZES)[number];

export const DEFAULT_SEARCH_PAGE_SIZE: SearchPageSize = 30;

export type RelatedNotesSortMode = 'newest' | 'oldest' | 'tags' | 'access';

export type TaskFilter = 'all' | 'active' | 'completed';

/** Task priorities of the Obsidian Tasks format, 🔺 ⏫ 🔼 🔽 ⏬. */
export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/**
 * The Dashboard's tabs: Home, and Tags. Searches open search pages, and tasks
 * have the Task Board.
 */
export type DashboardMode = 'home' | 'browse';

export type DashboardSearchField = 'tags';

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
  | 'pinnedNotes';

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
}

export type TagTitleDisplayMode = 'inline' | 'separate';

export type RenderMode = 'markdown' | 'html';

export type BuiltInEntityKind =
  | 'person'
  | 'project'
  | 'topic'
  | 'organization'
  | 'meeting';

/**
 * Entity kinds include built-in types and workspace-defined namespaces.
 *
 * The open string branch lets a namespaced tag such as `#management/item`
 * become an entity without requiring a configuration entry first.
 */
export type EntityKind = BuiltInEntityKind | (string & {});

export interface TagReference {
  key: string;
  label: string;
}

export interface Entity {
  key: string;
  label: string;
  kind: EntityKind;
  name: string;
  sectionIds: string[];
  taskIds: string[];
  filePaths: string[];
  count: number;
  isFavorite: boolean;
  updatedAt?: number;
}

export interface SourceLocation {
  filePath: string;
  line: number;
}

export interface Section {
  id: string;
  filePath: string;
  heading: string;
  headingLevel: number;
  isInline?: boolean;
  /** Tags written on this heading, excluding inherited front-matter tags. */
  headingTags?: TagReference[];
  /** Explicit tag groups written on individual source lines. */
  associationTagGroups?: TagReference[][];
  /** Structural heading parent, including untagged intermediate headings. */
  parentSectionId?: string;
  tags: string[];
  tagLabels: Record<string, string>;
  links: string[];
  /** The section and everything nested inside it, which is what Extract moves. */
  rawContent: string;
  /**
   * The section's own text: its heading and the lines under it, stopping at
   * the next heading of any level. A parent's own body does not contain its
   * children's, so a line belongs to the text of exactly one entry.
   */
  bodyContent: string;
  startLine: number;
  /** The last line of the section and everything nested inside it. */
  endLine: number;
  /** The last line of the section's own body, before any nested heading. */
  bodyEndLine: number;
  /**
   * Tags written on the section's own body lines, each with the line that
   * carries it.
   *
   * The tag stays where its author wrote it. A heading matches a search for
   * one of these because it contains the line, not because the tag was moved
   * onto the heading — so `tags` remains what was written on the heading
   * itself, and a match can say which line answered it.
   */
  bodyTags?: SectionBodyTag[];
  createdAt?: number;
  updatedAt?: number;
}

export interface SectionBodyTag extends TagReference {
  /** One-based line the tag is written on. */
  line: number;
}

export interface Task {
  id: string;
  filePath: string;
  sectionId?: string;
  title: string;
  completed: boolean;
  tags: string[];
  tagLabels: Record<string, string>;
  /** Explicit tags written on this task line, excluding inherited tags. */
  associationTagGroups?: TagReference[][];
  dueAt?: number;
  dueText?: string;
  /** ⏳ scheduled date: the day the author plans to work on the task. */
  scheduledAt?: number;
  /** 🛫 start date: the task is not actionable before this day. */
  startAt?: number;
  /** ✅ date the task was completed. */
  doneAt?: number;
  priority?: TaskPriority;
  /** 🔁 repeat rule as written, such as "every week". */
  recurrence?: string;
  /**
   * 👤 the person the task is for, as their tag is written. Anyone else named
   * on the line is mentioned rather than asked.
   */
  assignee?: string;
  /** 🆔 name other tasks use in ⛔ to depend on this one. */
  dependencyId?: string;
  /** ⛔ names of the tasks that must be done first. */
  dependsOn?: string[];
  lineNumber: number;
  checkboxColumn: number;
  checkboxValue: ' ' | 'x' | 'X';
  sourceLineText: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ParsedFile {
  filePath: string;
  content: string;
  sections: Section[];
  tasks: Task[];
  frontmatterTags: TagReference[];
  links: string[];
  /** Other names `[[links]]` can use for the note, from `aliases:` front matter. */
  aliases?: string[];
  /**
   * The `^block-id` markers the note carries, each with the one-based line it
   * marks, so a `[[Note#^id]]` link can be opened at the line it names.
   */
  blockIds?: Record<string, number>;
  /** Present when the note's `describes:` front matter names tags. */
  hub?: NoteHub;
  /**
   * When the note was created and last updated. A date the note states about
   * itself, in front matter or as a daily note's day, comes before its file's.
   */
  createdAt?: number;
  updatedAt?: number;
  /**
   * The file's own created and modified times, which tell whether the file
   * changed since it was last read.
   */
  fileTimes?: { createdAt?: number; updatedAt?: number };
}

/**
 * A note that describes tags, so it can lead their overviews.
 */
export interface NoteHub {
  describes: TagReference[];
  /** The rest of the note's front matter, in source order. */
  properties: FrontmatterProperty[];
}

export interface FrontmatterProperty {
  name: string;
  values: FrontmatterValue[];
}

export interface FrontmatterValue {
  text: string;
  /** Set when the value names a tag, such as `owner: "@dana"`. */
  tag?: TagReference;
}

export interface TagInfo {
  key: string;
  label: string;
  sectionIds: string[];
  taskIds: string[];
  filePaths: string[];
  count: number;
  isFavorite: boolean;
  /** Notes whose `describes:` names this tag, by path; the first is its hub. */
  hubFilePaths?: string[];
}

export interface TagAssociation {
  associatedTag: TagReference;
  sectionIds: string[];
  taskIds: string[];
  count: number;
  /** Total evidence score: co-occurrence is 1; heading proximity decays by depth. */
  weight: number;
  /** Prevalence- and support-normalized relevance used for Related Notes. */
  normalizedWeight: number;
  /** Distinct atomic source units containing the source tag. */
  tagSourceUnitCount: number;
  /** Distinct atomic source units containing the associated tag. */
  associatedTagSourceUnitCount: number;
  /** Total atomic source units observed while building this relationship. */
  totalSourceUnitCount: number;
  coOccurrenceCount: number;
  headingRelationshipCount: number;
}

export interface WorkspaceIndex {
  files: Map<string, ParsedFile>;
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  tags: Map<string, TagInfo>;
  entities: Map<string, Entity>;
  /** Tag key -> weighted co-occurrence and heading-proximity associations. */
  tagAssociations?: Map<string, TagAssociation[]>;
  updatedAt: number;
}

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
  tagOverviewSortMode: TagOverviewSortMode;
  tagOverviewLayout: TagOverviewLayout;
  /** How many notes, and how many tasks, a search page shows at a time. */
  searchPageSize: SearchPageSize;
  relatedNotesSortMode: RelatedNotesSortMode;
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

/**
 * A saved filter after its persisted keys have been resolved against the index.
 */
export interface DashboardSavedFilter {
  id: string;
  name: string;
  tags: TagReference[];
  /** Present when reopening this view should restore an advanced query. */
  query?: string;
  /** Set when the search reopens on the Task Board. */
  page?: 'taskBoard';
}

export interface DashboardTask {
  task: Task;
  renderedTitle: string;
  titleTags: TagReference[];
  sectionHeading?: string;
  fileName: string;
}

export interface DashboardNote extends TagOverviewCard {
  fileName: string;
}

export interface DashboardSnapshot {
  tags: TagInfo[];
  entities: Entity[];
  totalSectionCount: number;
  totalNoteCount: number;
  totalTaskCount: number;
  tagColumns: DashboardColumnCount;
  tagTitleDisplayMode: TagTitleDisplayMode;
  tagSortMode: TagSortMode;
  entitySortMode: TagSortMode;
  selectedTag?: string;
  viewState: DashboardViewState;
  savedFilters: DashboardSavedFilter[];
  /** Home's widgets as arranged, sent with every state. */
  widgetConfig: DashboardWidgetConfig[];
  /** What each widget shows, sent while Home is the tab shown. */
  widgets?: DashboardWidget[];
}

/** A tag a Home widget lists, with what searching for it finds. */
export interface DashboardWidgetTag extends TagReference {
  detail: string;
}

/** A note a Home widget lists, which opens at its line. */
export interface DashboardWidgetNote {
  filePath: string;
  line: number;
  title: string;
  detail: string;
  /** For a pinned note, the pin its row lets go of. */
  pinKey?: string;
}

/** Two tags written together, as Home lists them. */
export interface DashboardWidgetTagPair {
  tags: [TagReference, TagReference];
  /** How many times they were written together. */
  count: number;
  /** The share of the rarer tag's entries that also carry the other, 0–1. */
  overlap: number;
  detail: string;
}

/** Today's daily note, as Home shows it. */
export interface DashboardWidgetToday {
  /** Today, as YYYY-MM-DD. */
  date: string;
  /** The note, when it exists. */
  filePath?: string;
  /** Its open tasks, listed or not. */
  openTaskCount: number;
}

/** One agenda group, as Home's agenda widget shows it. */
export interface DashboardWidgetAgendaGroup {
  id: string;
  label: string;
  count: number;
  tasks: DashboardTask[];
}

/** What one Home widget shows. Each kind fills only its own fields. */
export interface DashboardWidget extends DashboardWidgetConfig {
  title: string;
  /** How many entries there are, listed or not. */
  total?: number;
  /** Which page of its entries it carries, for a widget that is paged. */
  paging?: ResultPaging;
  tasks?: DashboardTask[];
  tags?: DashboardWidgetTag[];
  notes?: DashboardWidgetNote[];
  queries?: string[];
  savedFilters?: DashboardSavedFilter[];
  agenda?: DashboardWidgetAgendaGroup[];
  stats?: Array<{ label: string; value: number }>;
  /** A saved-search widget's search. */
  savedQuery?: string;
  /** Set when that search was saved on the Task Board, which opens it. */
  savedPage?: 'taskBoard';
  /** The notes a saved-search widget's search finds, listed or not. */
  noteTotal?: number;
  /** Set when the widget names a saved search that no longer exists. */
  missing?: boolean;
  /** Why a tasks widget's search could not run. */
  error?: string;
  /** The search widget's box: its completions and recent searches. */
  searchState?: QueryViewState;
  tagPairs?: DashboardWidgetTagPair[];
  today?: DashboardWidgetToday;
  /** The note a related-notes widget ranks by. */
  sourceNote?: DashboardWidgetNote;
}

/**
 * A search page: the notes and tasks one search finds.
 *
 * When the search is exactly one tag, the page is that tag's overview and also
 * carries the tag, its entity, and its hub note. Any other search is described
 * by its search box alone.
 */
/**
 * One page of a search's results.
 *
 * A search page shows a page at a time rather than everything it found: a
 * search that matches a workspace would otherwise send, and draw, every note
 * on every save — megabytes of card text for the screenful anyone reads.
 * `total` is of the whole search, so every count on the page is of the search
 * and not of the page being shown.
 */
export interface ResultPaging {
  /** 1-based, clamped to the pages the search has. */
  page: number;
  /** How many results a page holds. */
  size: number;
  /** How many pages the results fill; at least one, even when empty. */
  pageCount: number;
  /** How many results the search found. */
  total: number;
}

export interface SearchPageSnapshot {
  /** The tag the page is about, when the search is that one tag. */
  tag?: TagInfo;
  entity?: Entity;
  /** The note that describes the tag. */
  hub?: TagOverviewHub;
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
  taskFilter: TaskFilter;
  renderMode: RenderMode;
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

export interface TagOverviewCard {
  id: string;
  filePath: string;
  heading: string;
  /** Whether this entry is pinned to Home, so a menu says which it offers. */
  pinned?: boolean;
  titleTags: TagReference[];
  tags: TagReference[];
  rawContent: string;
  renderedHtml: string;
  startLine: number;
  createdAt?: number;
  updatedAt?: number;
  accessCount: number;
}

export interface HeadingTagSpan extends TagReference {
  lineNumber: number;
  startColumn: number;
  endColumn: number;
}

export interface RankedNote {
  sectionId?: string;
  filePath: string;
  title: string;
  fileName: string;
  sourceLine: number;
  /** Outline context, including the entry title, for disambiguating daily notes. */
  headingPath: string[];
  /** Date inferred from a daily-note filename or date heading, when present. */
  dailyDate?: string;
  titleTags: TagReference[];
  updatedAt?: number;
  matchedTags: TagReference[];
  matchCount: number;
  totalTagCount: number;
  overlap: number;
  relevanceScore: number;
  associationWeight?: number;
  associationMatches?: Array<{
    selectedTag: TagReference;
    candidateTag: TagReference;
    associationWeight: number;
    normalizedAssociationWeight: number;
    sourceUnitCount: number;
    selectedTagSourceUnitCount: number;
    candidateTagSourceUnitCount: number;
    totalSourceUnitCount: number;
    selectedWeight: number;
    contribution: number;
  }>;
  relevanceEvidence?: {
    directTagWeight: number;
    associationWeight: number;
    normalizedAssociationWeight: number;
    appliedAssociationWeight: number;
    entryLinkWeight: number;
    fileLinkWeight: number;
    lexicalWeight: number;
    recencyWeight: number;
    specificityPenalty: number;
    lexicalTerms: Array<{ term: string; contribution: number }>;
  };
  reasons?: string[];
}

export interface StatsAccessItem {
  label: string;
  detail: string;
  count: number;
  /** The message that opens the item: its tag overview or its source line. */
  open: OpenTagMessage | OpenSourceMessage;
}

/**
 * Why two tags look like two spellings of one idea, most confusable first:
 * the same name written with a different marker or under a different
 * namespace, punctuated differently, pluralized, or simply mistyped.
 */
export type TagMergeReason =
  | 'marker'
  | 'namespace'
  | 'separator'
  | 'plural'
  | 'spelling';

/** Two tags that look alike, and what merging them would spend and keep. */
export interface TagMergeCandidate {
  /** The tag with fewer entries, which a merge spends. */
  sourceKey: string;
  sourceLabel: string;
  sourceCount: number;
  /** The tag a merge keeps. */
  targetKey: string;
  targetLabel: string;
  targetCount: number;
  reason: TagMergeReason;
  /** Why the pair was picked, as the row reads it. */
  detail: string;
}

/** A note the Stats page lists by name, which opens at its first line. */
export interface StatsNoteItem {
  label: string;
  detail: string;
  open: OpenSourceMessage;
}

export interface DeckardStatsSnapshot {
  updatedAt: number;
  fileCount: number;
  sectionCount: number;
  taskCount: number;
  activeTaskCount: number;
  tagCount: number;
  entityCount: number;
  wikiLinkCount: number;
  tagViews: StatsAccessItem[];
  entityViews: StatsAccessItem[];
  sectionViews: StatsAccessItem[];
  /** Notes no other note links to, periodic notes aside: the first by title. */
  orphanNotes: StatsNoteItem[];
  /** How many such notes there are, listed or not. */
  orphanNoteCount: number;
  /** Tags that look like two spellings of one idea: the clearest first. */
  lookalikeTags: TagMergeCandidate[];
  /** How many such pairs there are, listed or not. */
  lookalikeTagCount: number;
}

/** Messages from the Stats page, which only opens what it lists. */
/** Asks the host to read every note again. */
export interface ReindexWorkspaceMessage {
  type: 'reindexWorkspace';
}

/** Asks the host to merge one of the tags that look alike into the other. */
export interface MergeTagsMessage {
  type: 'mergeTags';
  sourceKey: string;
  targetKey: string;
}

export type StatsMessage =
  | OpenTagMessage
  | OpenSourceMessage
  | OpenSearchMessage
  | ReindexWorkspaceMessage
  | MergeTagsMessage;

/** Messages from the sidebar calendar. The host finds each note itself. */
export type CalendarMessage =
  | { type: 'ready' }
  | { type: 'openMonth' }
  | { type: 'showMonth'; month: string }
  | { type: 'openDay'; date: string }
  | { type: 'openWeek'; date: string };

export interface SidebarNotesSnapshot {
  activeFileName?: string;
  activeEntryTitle?: string;
  activeTags: SidebarTag[];
  notes: RankedNote[];
  relatedNotesSortMode?: RelatedNotesSortMode;
  tagTitleDisplayMode: TagTitleDisplayMode;
  graph?: SidebarGraphContext;
  /** The active search page's Refine options, shown in its place. */
  refine?: SearchRefineState;
  state:
    | 'ready'
    | 'loading'
    | 'notIndexed'
    | 'noMarkdown'
    | 'noTags'
    | 'noMatches'
    | 'graph'
    | 'refine';
}

/**
 * The search a page is showing, as the sidebar's Refine view needs it.
 */
export interface SearchRefineState {
  /** Which page the search is on. */
  page: 'search' | 'taskBoard';
  /** The page's name, such as "Person: Sable Ortiz". */
  title: string;
  query: QueryViewState;
  /** What the page can find, so the counts name only those. */
  resultKinds: Array<'notes' | 'tasks'>;
}

export interface SidebarTag extends TagReference {
  /** Relative contribution used when ranking Related Notes. */
  weight: number;
  /** How many notes and tasks a search for the tag finds. */
  matches?: { notes: number; tasks: number };
}

export type NotesGraphNodeKind = 'note' | 'task' | 'tag';

export type NotesGraphEdgeType =
  | 'wiki-link'
  | 'heading'
  | 'associated-tag'
  | 'tag-membership';

export interface NotesGraphNode {
  /** 'section:<id>' | 'task:<id>' | 'file:<path>' | 'tag:<key>' */
  id: string;
  kind: NotesGraphNodeKind;
  /** Heading or task text with tags stripped, or the tag label. */
  title: string;
  filePath?: string;
  line?: number;
  /** Canonical tag keys carried by this node; empty for tag nodes. */
  tagKeys: string[];
  /** Precomputed edge count; drives node radius in the webview. */
  degree: number;
}

export interface NotesGraphEdge {
  /** '<sourceId>::<targetId>' with the two ids sorted. */
  id: string;
  source: string;
  target: string;
  /** Combined evidence weight, used for spring strength. */
  weight: number;
  types: NotesGraphEdgeType[];
}

export interface NotesGraphSnapshot {
  updatedAt: number;
  nodes: NotesGraphNode[];
  edges: NotesGraphEdge[];
  /** All indexed tags for the filter list: [key, label, count]. */
  tags: [string, string, number][];
  totalNoteCount: number;
  totalTaskCount: number;
  /** The note the graph is drawn around, when it is drawn around one. */
  focus?: NotesGraphFocus;
}

/**
 * What a local graph is centred on: the note last open in an editor, how far
 * out it reaches, and whether the graph on screen is that neighbourhood or
 * the whole workspace.
 */
export interface NotesGraphFocus {
  /** On, and drawn around the note; off, and the whole workspace is drawn. */
  local: boolean;
  /** How many hops out from the note the local graph reaches. */
  depth: number;
  /** The note it is drawn around, when one is open. */
  filePath?: string;
  title?: string;
  /** How many nodes and edges the whole workspace holds, for the readout. */
  workspaceNodeCount: number;
}

export interface NotesGraphConnection {
  node: NotesGraphNode;
  weight: number;
  types: NotesGraphEdgeType[];
}

export interface SidebarGraphContext {
  selectedNode?: NotesGraphNode;
  connections: NotesGraphConnection[];
}

export interface NotesGraphOpenSourceMessage {
  type: 'openSource';
  filePath: string;
  line: number;
}

export interface NotesGraphOpenTagMessage {
  type: 'openTag';
  tagKey: string;
}

export interface NotesGraphSelectNodeMessage {
  type: 'selectNode';
  nodeId: string;
}

export interface NotesGraphClearSelectionMessage {
  type: 'clearSelection';
}

/** Draw the whole workspace, or the neighbourhood of the note in the editor. */
export interface NotesGraphSetScopeMessage {
  type: 'setGraphScope';
  local: boolean;
  depth: number;
}

export type NotesGraphMessage =
  | NotesGraphOpenSourceMessage
  | NotesGraphOpenTagMessage
  | NotesGraphSelectNodeMessage
  | NotesGraphClearSelectionMessage
  | NotesGraphSetScopeMessage;

export interface OpenSourceMessage {
  type: 'openSource';
  filePath: string;
  line: number;
  /** Open beside the current editor rather than replacing it. */
  beside?: boolean;
}

/**
 * Write a `[[Note#Heading]]` link to a related note at the cursor of the note
 * being edited.
 */
export interface InsertLinkMessage {
  type: 'insertLink';
  filePath: string;
  line: number;
}

export interface ToggleTaskMessage {
  type: 'toggleTask';
  taskId: string;
  completed: boolean;
}

export interface ToggleFavoriteMessage {
  type: 'toggleFavorite';
  tagKey: string;
}

export interface ToggleFavoriteEntityMessage {
  type: 'toggleFavoriteEntity';
  entityKey: string;
}

export interface SetTagSortMessage {
  type: 'setTagSort';
  mode: TagSortMode;
}

export interface SetEntitySortMessage {
  type: 'setEntitySort';
  mode: TagSortMode;
}

export interface SetTaskFilterMessage {
  type: 'setTaskFilter';
  filter: TaskFilter;
}

export interface ReorderTasksMessage {
  type: 'reorderTasks';
  taskIds: string[];
}

export interface SetTaskSortMessage {
  type: 'setTaskSort';
  mode: TaskSortMode;
}

export interface SetDashboardModeMessage {
  type: 'setDashboardMode';
  mode: DashboardMode;
}

export interface SetDashboardSearchMessage {
  type: 'setDashboardSearch';
  field: DashboardSearchField;
  query: string;
}

export interface CreateHubNoteMessage {
  type: 'createHubNote';
}

export interface SetDashboardColumnsMessage {
  type: 'setDashboardColumns';
  section: 'tags';
  columns: DashboardColumnCount;
}

/** Sets how many columns a search page lays its notes or tasks out in. */
export interface SetSearchColumnsMessage {
  type: 'setSearchColumns';
  section: 'notes' | 'tasks';
  columns: DashboardColumnCount;
}

/** Replaces Home's widgets, in order. */
export interface SetDashboardWidgetsMessage {
  type: 'setDashboardWidgets';
  widgets: DashboardWidgetConfig[];
}

/** Puts Home's widgets back as they first were. */
export interface ResetDashboardWidgetsMessage {
  type: 'resetDashboardWidgets';
}

/** Opens a search page on a search. */
export interface OpenSearchMessage {
  type: 'openSearch';
  query: string;
}

/** Opens today's daily note, creating it when it does not exist yet. */
export interface OpenDailyNoteMessage {
  type: 'openDailyNote';
}

/** Adds a task to today's daily note. */
export interface QuickAddMessage {
  type: 'quickAdd';
  text: string;
}

/** Creates a tag's hub note. */
export interface CreateTagHubMessage {
  type: 'createTagHub';
  tagKey: string;
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

/** Pins the note at a line to Home, or unpins the pin a row names. */
export interface PinNoteMessage {
  type: 'pinNote' | 'unpinNote';
  filePath: string;
  /** The line whose entry is pinned; the whole note without one. */
  line?: number;
  /** Which pin to remove, as `pinKey` writes it. */
  pinKey?: string;
}

/** Opens a note at its top. */
export interface OpenNoteMessage {
  type: 'openNote';
  filePath: string;
}

/** Opens a Deckard view Home links to. */
export interface OpenDeckardViewMessage {
  type: 'openView';
  view: 'agenda' | 'stats';
}

export interface ReorderTagsMessage {
  type: 'reorderTags';
  tagKeys: string[];
  tagKey: string;
  isFavorite: boolean;
}

export interface ReorderEntitiesMessage {
  type: 'reorderEntities';
  entityKeys: string[];
}

export interface OpenTagMessage {
  type: 'openTag';
  tagKey: string;
}

export interface RenameTagMessage {
  type: 'renameTag';
  tagKey: string;
}

export interface OpenSavedFilterMessage {
  type: 'openSavedFilter';
  filterId: string;
}

export interface RemoveSavedFilterMessage {
  type: 'removeSavedFilter';
  filterId: string;
}

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

/** Remembers a search that was run, for Find and the search boxes. */
export interface RecordRecentQueryMessage {
  type: 'recordRecentQuery';
  query: string;
}

export interface SetTagOverviewSortMessage {
  type: 'setTagOverviewSort';
  mode: TagOverviewSortMode;
}

export interface SetTagOverviewLayoutMessage {
  type: 'setTagOverviewLayout';
  layout: TagOverviewLayout;
}

export interface SetRenderModeMessage {
  type: 'setRenderMode';
  mode: RenderMode;
}

export interface OpenDashboardMessage {
  type: 'openDashboard';
}

export interface OpenNotesGraphMessage {
  type: 'openNotesGraph';
}

/** Opens the Task Board, on a search when one is given. */
export interface OpenTaskBoardMessage {
  type: 'openTaskBoard';
  query?: string;
}

export interface ActivateNotesGraphNodeMessage {
  type: 'activateNotesGraphNode';
  nodeId: string;
  open: boolean;
}

export interface HoverNotesGraphNodeMessage {
  type: 'hoverNotesGraphNode';
  nodeId?: string;
}

export interface CreateDailyNoteMessage {
  type: 'createDailyNote';
}

export interface OpenHelpMessage {
  type: 'openHelp';
}

export interface SetRelatedNotesSortMessage {
  type: 'setRelatedNotesSort';
  mode: RelatedNotesSortMode;
}

export interface SidebarReadyMessage {
  type: 'ready';
}

/**
 * Narrows the active search by one of its facet values, from the sidebar's
 * Refine view: `and` keeps only it, `exclude` leaves it out, and `or` allows
 * it beside the value of the same facet already chosen.
 */
export interface RefineActiveSearchMessage {
  type: 'refineActiveSearch';
  facetId: string;
  clause: string;
  mode: 'and' | 'exclude' | 'or';
}

export interface ClearEntryRelatedNotesMessage {
  type: 'clearEntryRelatedNotes';
}

export type DashboardMessage =
  | OpenSourceMessage
  | ToggleTaskMessage
  | ToggleFavoriteMessage
  | ToggleFavoriteEntityMessage
  | SetTagSortMessage
  | SetEntitySortMessage
  | SetDashboardModeMessage
  | SetDashboardSearchMessage
  | SetDashboardColumnsMessage
  | ReorderTagsMessage
  | ReorderEntitiesMessage
  | OpenTagMessage
  | RenameTagMessage
  | OpenSavedFilterMessage
  | RemoveSavedFilterMessage
  | RecordRecentQueryMessage
  | SetDashboardWidgetsMessage
  | ResetDashboardWidgetsMessage
  | OpenSearchMessage
  | OpenTaskBoardMessage
  | OpenDeckardViewMessage
  | OpenDailyNoteMessage
  | QuickAddMessage
  | CreateTagHubMessage
  | PinNoteMessage
  | OpenNoteMessage;

export type SearchPageMessage =
  | PinNoteMessage
  | OpenHelpMessage
  | OpenSourceMessage
  | ToggleTaskMessage
  | SetTaskFilterMessage
  | SetRenderModeMessage
  | OpenTagMessage
  | RenameTagMessage
  | SetTagOverviewSortMessage
  | SetTagOverviewLayoutMessage
  | SetSearchColumnsMessage
  | SaveTagOverviewFilterMessage
  | SetOverviewQueryMessage
  | ClearOverviewQueryMessage
  | SetResultPageMessage
  | SetResultsPerPageMessage
  | PreviewSearchMessage
  | EditResultsMessage
  | CreateHubNoteMessage;

export type SidebarMessage =
  | SidebarReadyMessage
  | OpenSourceMessage
  | OpenTagMessage
  | RenameTagMessage
  | OpenDashboardMessage
  | OpenNotesGraphMessage
  | OpenTaskBoardMessage
  | ActivateNotesGraphNodeMessage
  | HoverNotesGraphNodeMessage
  | CreateDailyNoteMessage
  | OpenHelpMessage
  | SetRelatedNotesSortMessage
  | ClearEntryRelatedNotesMessage
  | InsertLinkMessage
  | RefineActiveSearchMessage;

/** How the task board arranges its columns. */
export type TaskBoardGroupBy = 'status' | 'priority' | 'due' | 'assignee';

export interface TaskBoardCard {
  taskId: string;
  title: string;
  /** Tags written inside the title, rendered as controls where they appear. */
  titleTags: TagReference[];
  /** The title as sanitized inline Markdown, as the task list shows it. */
  renderedTitle: string;
  completed: boolean;
  filePath: string;
  line: number;
  /** Short facts under the title, such as "due 2026-09-14". */
  details: string[];
  overdue: boolean;
}

export interface TaskBoardColumn {
  /** What dropping a task here writes, such as `status:doing` or `done`. */
  id: string;
  label: string;
  /** False for a column that no single edit can move a task into. */
  droppable: boolean;
  cards: TaskBoardCard[];
  /** Completed tasks left out of a long Done column. */
  hiddenCount: number;
}

/** A task board's columns, whichever page chose its tasks. */
export interface TaskBoardLayout {
  groupBy: TaskBoardGroupBy;
  columns: TaskBoardColumn[];
  taskCount: number;
}

/** The Task Board page, which chooses its tasks with a search. */
export interface TaskBoardSnapshot extends TaskBoardLayout {
  /** The search narrowing the tasks, as every search box shows one. */
  query: QueryViewState;
  layout: TaskLayout;
  /** The searched tasks as a list, present when `layout` is `list`. */
  tasks?: DashboardTask[];
  /** The searched tasks as rows and columns, present when `layout` is `table`. */
  table?: TaskTable;
  /** How many searched tasks are open and how many are done. */
  taskCounts: { all: number; active: number; completed: number };
  taskSortMode: TaskSortMode;
  tagTitleDisplayMode: TagTitleDisplayMode;
  /** The board settings the page's view options edit. */
  settings: TaskBoardSettings;
  /** Whether the sidebar is showing this search's Refine options. */
  refineInSidebar?: boolean;
  /** Whether the Tasks view lists this search, so the board can say so. */
  agendaListsThisSearch?: boolean;
}

/** The Task Board's table: the columns shown, every column there is, and the rows. */
export interface TaskTable {
  columns: { id: TaskColumnId; label: string }[];
  available: { id: TaskColumnId; label: string }[];
  /** The column the rows are ordered by; none means the list's own order. */
  sort?: TableSort;
  rows: TaskTableRow[];
}

export interface TaskTableRow {
  taskId: string;
  filePath: string;
  line: number;
  completed: boolean;
  /** One cell per column, in the columns' order. */
  cells: TableCell[];
}

/** The `deckard.board` settings, as the Task Board's view options show them. */
export interface TaskBoardSettings {
  statuses: string[];
  statusNamespace: string;
}

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

export type TableSortDirection = 'asc' | 'desc';

export interface TableSort {
  column: TaskColumnId;
  direction: TableSortDirection;
}

/**
 * One cell: its text, and what it is, so a surface can colour an overdue
 * date or quieten a file name without knowing which column it drew.
 */
export interface TableCell {
  text: string;
  kind?: 'overdue' | 'muted';
}

/** Sorts the table by a column; the same column again turns it round, and none clears it. */
export interface SetTableSortMessage {
  type: 'setTableSort';
  column?: TaskColumnId;
}

/** Chooses the table's columns. */
export interface SetTableColumnsMessage {
  type: 'setTableColumns';
  columns: TaskColumnId[];
}

export interface SetTaskLayoutMessage {
  type: 'setTaskLayout';
  layout: TaskLayout;
}

export interface MoveTaskMessage {
  type: 'moveTask';
  taskId: string;
  column: string;
}

export interface SetBoardGroupMessage {
  type: 'setBoardGroup';
  groupBy: TaskBoardGroupBy;
}

export interface SetBoardQueryMessage {
  type: 'setBoardQuery';
  query: string;
}

/** Replaces the status columns, in order. */
export interface SetBoardStatusesMessage {
  type: 'setBoardStatuses';
  statuses: string[];
}

export interface SetBoardStatusNamespaceMessage {
  type: 'setBoardStatusNamespace';
  namespace: string;
}

/** Names the Task Board's search and keeps it as a saved view. */
export interface SaveBoardSearchMessage {
  type: 'saveBoardSearch';
}

/** Makes the Tasks view list the Task Board's search. */
export interface UseSearchForAgendaMessage {
  type: 'useSearchForAgenda';
}

/** Asks the board to show every task a column is holding back. */
export interface ShowColumnRestMessage {
  type: 'showColumnRest';
  columnId: string;
}

export type TaskBoardMessage =
  | OpenHelpMessage
  | ShowColumnRestMessage
  | SaveBoardSearchMessage
  | UseSearchForAgendaMessage
  | SidebarReadyMessage
  | OpenSourceMessage
  | OpenTagMessage
  | ToggleTaskMessage
  | MoveTaskMessage
  | SetBoardGroupMessage
  | SetBoardQueryMessage
  | SetTaskLayoutMessage
  | SetTaskSortMessage
  | SetTableSortMessage
  | SetTableColumnsMessage
  | ReorderTasksMessage
  | SetBoardStatusesMessage
  | SetBoardStatusNamespaceMessage;
