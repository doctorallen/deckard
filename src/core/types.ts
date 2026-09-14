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

export type DashboardMode = 'tasks' | 'notes' | 'browse';

export type DashboardSearchField =
  | 'tasks'
  | 'notes'
  | 'tags'
  | 'taskTags'
  | 'noteTags';

export interface DashboardViewState {
  mode: DashboardMode;
  taskFilter: TaskFilter;
  selectedTaskTags: string[];
  selectedNoteTags: string[];
  taskSearchQuery: string;
  noteSearchQuery: string;
  tagSearchQuery: string;
  taskTagQuery: string;
  noteTagQuery: string;
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
  dashboardNoteSortMode: TagOverviewSortMode;
  dashboardViewState: DashboardViewState;
  renderMode: RenderMode;
  tagOverviewSortMode: TagOverviewSortMode;
  tagOverviewLayout: TagOverviewLayout;
  relatedNotesSortMode: RelatedNotesSortMode;
  sectionAccessCounts: Record<string, number>;
  savedFilters: SavedFilter[];
  /** Absent in preferences saved before the Dashboard had a board layout. */
  dashboardTaskLayout?: DashboardTaskLayout;
  dashboardBoardGroup?: TaskBoardGroupBy;
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
  notes: DashboardNote[];
  tasks: DashboardTask[];
  totalSectionCount: number;
  totalNoteCount: number;
  totalTaskCount: number;
  activeTaskCount: number;
  taskFilter: TaskFilter;
  taskSortMode: TaskSortMode;
  taskColumns: DashboardColumnCount;
  noteColumns: DashboardColumnCount;
  tagColumns: DashboardColumnCount;
  noteSortMode: TagOverviewSortMode;
  renderMode: RenderMode;
  tagTitleDisplayMode: TagTitleDisplayMode;
  tagSortMode: TagSortMode;
  entitySortMode: TagSortMode;
  availableTaskTags: TagInfo[];
  availableNoteTags: TagInfo[];
  selectedTaskTags: string[];
  selectedNoteTags: string[];
  selectedTag?: string;
  viewState: DashboardViewState;
  savedFilters: DashboardSavedFilter[];
  /** List when absent. */
  taskLayout?: DashboardTaskLayout;
  /** The filtered tasks as a board, present when `taskLayout` is `board`. */
  taskBoard?: TaskBoardLayout;
  /**
   * True when `notes` was left empty because the Notes tab is not showing.
   * Notes are most of what the page is sent, so other tabs are sent none.
   */
  notesOmitted?: boolean;
}

export interface TagOverviewSnapshot {
  /**
   * The focus tag of a tag-driven overview.
   *
   * Undefined only for a standalone query view, which has no single tag to
   * anchor its title, sidebar, or rename actions to.
   */
  tag?: TagInfo;
  entity?: Entity;
  /** The note that describes the tag; only on an overview with no filters. */
  hub?: TagOverviewHub;
  /**
   * The advanced filter behind this view.
   *
   * Always present. A plain tag overview carries the query that expresses its
   * own tag intersection, so the query bar and the tag chips never disagree.
   */
  query?: QueryViewState;
  /** @deprecated Use filterTags to support every active overview filter. */
  filterTag?: TagReference;
  filterTags: TagReference[];
  savedViewName?: string;
  associatedTags: TagAssociation[];
  /** Tags independently associated with every active tag in a filtered overview. */
  sharedAssociatedTags: TagAssociation[];
  sections: TagOverviewCard[];
  tasks: DashboardTask[];
  /** Counts before the active completion filter is applied. */
  taskCounts?: {
    all: number;
    active: number;
    completed: number;
  };
  taskFilter: TaskFilter;
  renderMode: RenderMode;
  sortMode: TagOverviewSortMode;
  layout: TagOverviewLayout;
  tagTitleDisplayMode: TagTitleDisplayMode;
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

export interface SearchResult {
  type: 'section' | 'task';
  id: string;
  filePath: string;
  line: number;
  title: string;
  excerpt: string;
  matchedEntities: TagReference[];
  updatedAt?: number;
  score: number;
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
  /** Notes no other note links to, daily notes aside: the first by title. */
  orphanNotes: StatsNoteItem[];
  /** How many such notes there are, listed or not. */
  orphanNoteCount: number;
}

/** Messages from the Stats page, which only opens what it lists. */
export type StatsMessage = OpenTagMessage | OpenSourceMessage;

export interface SidebarNotesSnapshot {
  activeFileName?: string;
  activeEntryTitle?: string;
  activeTags: SidebarTag[];
  notes: RankedNote[];
  relatedNotesSortMode?: RelatedNotesSortMode;
  tagOverview?: TagReference;
  /**
   * The advanced query driving the overview, when one is active.
   *
   * A query that names no single tag has no chip for the sidebar to show, so
   * the query itself identifies the scope instead.
   */
  tagOverviewQuery?: string;
  /** @deprecated Use tagOverviewFilters to support every active overview filter. */
  tagOverviewFilter?: TagReference;
  tagOverviewFilters: TagReference[];
  tagOverviewRelationships?: {
    associatedTags: TagAssociation[];
    sharedAssociatedTags: TagAssociation[];
  };
  tagTitleDisplayMode: TagTitleDisplayMode;
  graph?: SidebarGraphContext;
  state: 'ready' | 'noMarkdown' | 'noTags' | 'noMatches' | 'graph';
}

export interface SidebarTag extends TagReference {
  /** Relative contribution used when ranking Related Notes. */
  weight: number;
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

export interface SetTaskTagsMessage {
  type: 'setTaskTags';
  tagKeys: string[];
}

export interface SetNoteTagsMessage {
  type: 'setNoteTags';
  tagKeys: string[];
}

export interface ReorderTasksMessage {
  type: 'reorderTasks';
  taskIds: string[];
}

export interface SetTaskSortMessage {
  type: 'setTaskSort';
  mode: TaskSortMode;
}

export interface SetNoteSortMessage {
  type: 'setNoteSort';
  mode: TagOverviewSortMode;
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
  section: 'tasks' | 'notes' | 'tags';
  columns: DashboardColumnCount;
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
  /** @deprecated Use filterTagKeys to support every active overview filter. */
  filterTagKey?: string;
  filterTagKeys?: string[];
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
 * Replaces the overview's active query.
 *
 * The webview sends canonical query text whether the author typed it in the
 * query bar or assembled it in the visual builder, so the host only ever has
 * one representation to validate and evaluate.
 */
export interface SetOverviewQueryMessage {
  type: 'setOverviewQuery';
  query: string;
}

/**
 * Clears the advanced query and returns the page to its focus tag.
 */
export interface ClearOverviewQueryMessage {
  type: 'clearOverviewQuery';
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

export interface OpenTaskBoardMessage {
  type: 'openTaskBoard';
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
  | SetTaskFilterMessage
  | SetTaskTagsMessage
  | SetNoteTagsMessage
  | SetTaskSortMessage
  | SetRenderModeMessage
  | SetNoteSortMessage
  | SetDashboardModeMessage
  | SetDashboardSearchMessage
  | SetDashboardColumnsMessage
  | ReorderTasksMessage
  | ReorderTagsMessage
  | ReorderEntitiesMessage
  | OpenTagMessage
  | RenameTagMessage
  | OpenSavedFilterMessage
  | RemoveSavedFilterMessage
  | SetDashboardTaskLayoutMessage
  | SetBoardGroupMessage
  | MoveTaskMessage;

export type TagOverviewMessage =
  | OpenSourceMessage
  | ToggleTaskMessage
  | SetTaskFilterMessage
  | SetRenderModeMessage
  | OpenTagMessage
  | RenameTagMessage
  | SetTagOverviewSortMessage
  | SetTagOverviewLayoutMessage
  | SaveTagOverviewFilterMessage
  | SetOverviewQueryMessage
  | ClearOverviewQueryMessage
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
  | ClearEntryRelatedNotesMessage;

/** How the task board arranges its columns. */
export type TaskBoardGroupBy = 'status' | 'priority' | 'due';

export interface TaskBoardCard {
  taskId: string;
  title: string;
  /** Tags written inside the title, rendered as controls where they appear. */
  titleTags: TagReference[];
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

/** The Task Board page, which chooses its tasks with a query. */
export interface TaskBoardSnapshot extends TaskBoardLayout {
  /** The query narrowing the board, or empty for every task. */
  query: string;
  /** Why the last query typed could not be applied. */
  queryError?: string;
}

/** How the Dashboard's Tasks tab lays out its tasks. */
export type DashboardTaskLayout = 'list' | 'board';

export interface SetDashboardTaskLayoutMessage {
  type: 'setDashboardTaskLayout';
  layout: DashboardTaskLayout;
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

export type TaskBoardMessage =
  | SidebarReadyMessage
  | OpenSourceMessage
  | OpenTagMessage
  | ToggleTaskMessage
  | MoveTaskMessage
  | SetBoardGroupMessage
  | SetBoardQueryMessage;
