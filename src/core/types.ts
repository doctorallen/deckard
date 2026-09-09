export type TagSortMode = 'alphabetical' | 'count' | 'access' | 'custom';

export type TaskSortMode = 'rank' | 'created' | 'updated';

export type TagOverviewSortMode =
  | 'alphabetical'
  | 'created'
  | 'updated'
  | 'access';

export type TagOverviewLayout = 'tabs' | 'split';

export type RelatedNotesSortMode = 'newest' | 'oldest' | 'tags' | 'access';

export type TaskFilter = 'all' | 'active' | 'completed';

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
  dueAt?: number;
  dueText?: string;
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
  createdAt?: number;
  updatedAt?: number;
}

export interface TagInfo {
  key: string;
  label: string;
  sectionIds: string[];
  taskIds: string[];
  filePaths: string[];
  count: number;
  isFavorite: boolean;
}

export interface TagRelationship {
  parent: TagReference;
  child: TagReference;
  sectionIds: string[];
  count: number;
}

export interface TagSiblingRelationship {
  sibling: TagReference;
  sectionIds: string[];
  count: number;
}

export interface WorkspaceIndex {
  files: Map<string, ParsedFile>;
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  tags: Map<string, TagInfo>;
  entities: Map<string, Entity>;
  /** Child tag key -> relationships whose parent is a tagged ancestor. */
  tagParents?: Map<string, TagRelationship[]>;
  /** Parent tag key -> relationships whose child is a nested tagged heading. */
  tagChildren?: Map<string, TagRelationship[]>;
  /** Tag key -> relationships whose sibling shares its structural parent. */
  tagSiblings?: Map<string, TagSiblingRelationship[]>;
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
  renderMode: RenderMode;
  tagOverviewSortMode: TagOverviewSortMode;
  tagOverviewLayout: TagOverviewLayout;
  relatedNotesSortMode: RelatedNotesSortMode;
  sectionAccessCounts: Record<string, number>;
}

export interface DashboardTask {
  task: Task;
  renderedTitle: string;
  sectionHeading?: string;
  fileName: string;
}

export interface DashboardSnapshot {
  sections: Section[];
  tags: TagInfo[];
  entities: Entity[];
  tasks: DashboardTask[];
  totalSectionCount: number;
  totalTaskCount: number;
  activeTaskCount: number;
  taskFilter: TaskFilter;
  taskSortMode: TaskSortMode;
  tagSortMode: TagSortMode;
  entitySortMode: TagSortMode;
  availableTaskTags: TagInfo[];
  selectedTaskTags: string[];
  selectedTag?: string;
}

export interface TagOverviewSnapshot {
  tag: TagInfo;
  entity?: Entity;
  filterTag?: TagReference;
  parentTags: TagRelationship[];
  childTags: TagRelationship[];
  siblingTags: TagSiblingRelationship[];
  sections: TagOverviewCard[];
  tasks: DashboardTask[];
  taskFilter: TaskFilter;
  renderMode: RenderMode;
  sortMode: TagOverviewSortMode;
  layout: TagOverviewLayout;
  tagTitleDisplayMode: TagTitleDisplayMode;
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
  titleTags: TagReference[];
  updatedAt?: number;
  matchedTags: TagReference[];
  matchCount: number;
  totalTagCount: number;
  overlap: number;
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
}

export interface SidebarNotesSnapshot {
  activeFileName?: string;
  activeTags: TagReference[];
  notes: RankedNote[];
  relatedNotesSortMode?: RelatedNotesSortMode;
  tagOverview?: TagReference;
  tagOverviewFilter?: TagReference;
  tagOverviewRelationships?: {
    parentTags: TagRelationship[];
    childTags: TagRelationship[];
    siblingTags: TagSiblingRelationship[];
  };
  tagTitleDisplayMode: TagTitleDisplayMode;
  state: 'ready' | 'noMarkdown' | 'noTags' | 'noMatches';
}

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

export interface ReorderTasksMessage {
  type: 'reorderTasks';
  taskIds: string[];
}

export interface SetTaskSortMessage {
  type: 'setTaskSort';
  mode: TaskSortMode;
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
  filterTagKey?: string;
}

export interface RenameTagMessage {
  type: 'renameTag';
  tagKey: string;
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

export type DashboardMessage =
  | OpenSourceMessage
  | ToggleTaskMessage
  | ToggleFavoriteMessage
  | ToggleFavoriteEntityMessage
  | SetTagSortMessage
  | SetEntitySortMessage
  | SetTaskFilterMessage
  | SetTaskTagsMessage
  | SetTaskSortMessage
  | ReorderTasksMessage
  | ReorderTagsMessage
  | ReorderEntitiesMessage
  | OpenTagMessage
  | RenameTagMessage;

export type TagOverviewMessage =
  | OpenSourceMessage
  | ToggleTaskMessage
  | SetTaskFilterMessage
  | SetRenderModeMessage
  | OpenTagMessage
  | RenameTagMessage
  | SetTagOverviewSortMessage
  | SetTagOverviewLayoutMessage;

export type SidebarMessage =
  | OpenSourceMessage
  | OpenTagMessage
  | RenameTagMessage
  | OpenDashboardMessage
  | CreateDailyNoteMessage
  | OpenHelpMessage
  | SetRelatedNotesSortMessage;
