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
  | 'pinnedNotes';

/** Whether a widget takes one of Home's two columns or both. */
export type DashboardWidgetWidth = 'half' | 'full';

/** One widget on Home, as the reader arranged it. */
export interface DashboardWidgetConfig {
  /** Unique on the page, so a kind that can repeat is told apart. */
  id: string;
  kind: DashboardWidgetKind;
  width: DashboardWidgetWidth;
  /** How many entries a list widget shows. */
  count?: number;
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
  rawContent: string;
  startLine: number;
  endLine: number;
  createdAt?: number;
  updatedAt?: number;
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
  /** What the Task Board's columns group tasks by. */
  taskBoardGroup: TaskBoardGroupBy;
  /** Which tasks the Task Board's list shows. */
  taskBoardTaskFilter: TaskFilter;
  /** The widgets on the Dashboard's Home, in order. */
  dashboardWidgets: DashboardWidgetConfig[];
  /**
   * When Deckard first indexed each tag, in epoch milliseconds. Tags already
   * in use when this began to be kept are 0, so none of them count as new.
   */
  tagFirstSeen?: Record<string, number>;
  /** Notes pinned to Home, by path, in the order they were pinned. */
  pinnedNotes?: string[];
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
  /** The note a related-notes widget ranks by, or a note Home can pin. */
  sourceNote?: DashboardWidgetNote;
  /** Whether the note in the editor last is already pinned. */
  sourcePinned?: boolean;
}

/**
 * A search page: the notes and tasks one search finds.
 *
 * When the search is exactly one tag, the page is that tag's overview and also
 * carries the tag, its entity, and its hub note. Any other search is described
 * by its search box alone.
 */
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
  /**
   * The note cards the page carries, which a broad search limits to the
   * first `noteLimit` of them.
   */
  sections: TagOverviewCard[];
  /** How many notes the search found, whether or not they are all carried. */
  sectionTotal: number;
  tasks: DashboardTask[];
  /**
   * How many tasks the search found under the active completion filter,
   * whether or not they are all carried.
   */
  taskTotal: number;
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
}

/** Messages from the Stats page, which only opens what it lists. */
/** Asks the host to read every note again. */
export interface ReindexWorkspaceMessage {
  type: 'reindexWorkspace';
}

export type StatsMessage =
  | OpenTagMessage
  | OpenSourceMessage
  | OpenSearchMessage
  | ReindexWorkspaceMessage;

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

export type NotesGraphMessage =
  | NotesGraphOpenSourceMessage
  | NotesGraphOpenTagMessage
  | NotesGraphSelectNodeMessage
  | NotesGraphClearSelectionMessage;

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

/** Pins a note to Home, or unpins it. */
export interface PinNoteMessage {
  type: 'pinNote' | 'unpinNote';
  filePath: string;
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

/** Carry the next batch of results, for a search with more than it sent. */
export interface ShowMoreEntriesMessage {
  type: 'showMoreEntries';
  kind: 'notes' | 'tasks';
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
  | ShowMoreEntriesMessage
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
export type TaskBoardGroupBy = 'status' | 'priority' | 'due';

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
  /** How many searched tasks each of All, Open, and Done keeps. */
  taskCounts: { all: number; active: number; completed: number };
  taskFilter: TaskFilter;
  taskSortMode: TaskSortMode;
  tagTitleDisplayMode: TagTitleDisplayMode;
  /** The board settings the page's view options edit. */
  settings: TaskBoardSettings;
  /** Whether the sidebar is showing this search's Refine options. */
  refineInSidebar?: boolean;
}

/** The `deckard.board` settings, as the Task Board's view options show them. */
export interface TaskBoardSettings {
  statuses: string[];
  statusNamespace: string;
}

/** Whether the Task Board shows its tasks as a list or as columns. */
export type TaskLayout = 'list' | 'board';

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

/** Asks the board to show every task a column is holding back. */
export interface ShowColumnRestMessage {
  type: 'showColumnRest';
  columnId: string;
}

export type TaskBoardMessage =
  | OpenHelpMessage
  | ShowColumnRestMessage
  | SaveBoardSearchMessage
  | SidebarReadyMessage
  | OpenSourceMessage
  | OpenTagMessage
  | ToggleTaskMessage
  | MoveTaskMessage
  | SetBoardGroupMessage
  | SetBoardQueryMessage
  | SetTaskLayoutMessage
  | SetTaskFilterMessage
  | SetTaskSortMessage
  | ReorderTasksMessage
  | SetBoardStatusesMessage
  | SetBoardStatusNamespaceMessage;
