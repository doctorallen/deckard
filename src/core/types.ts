export type TagSortMode = 'alphabetical' | 'count' | 'access' | 'custom';

export type TaskSortMode = 'rank' | 'created' | 'updated';

export type TagOverviewSortMode =
  | 'alphabetical'
  | 'created'
  | 'updated'
  | 'access';

export type TaskFilter = 'all' | 'active' | 'completed';

export type RenderMode = 'markdown' | 'html';

export interface TagReference {
  key: string;
  label: string;
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
  tags: string[];
  tagLabels: Record<string, string>;
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
  createdAt?: number;
  updatedAt?: number;
}

export interface TagInfo {
  key: string;
  label: string;
  sectionIds: string[];
  taskIds: string[];
  count: number;
  isFavorite: boolean;
}

export interface WorkspaceIndex {
  files: Map<string, ParsedFile>;
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  tags: Map<string, TagInfo>;
  updatedAt: number;
}

export interface PersistedPreferences {
  version: 1;
  favoriteTags: string[];
  tagSortMode: TagSortMode;
  tagAccessOrder: string[];
  tagAccessCounts: Record<string, number>;
  taskOrder: string[];
  taskSortMode: TaskSortMode;
  renderMode: RenderMode;
  tagOverviewSortMode: TagOverviewSortMode;
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
  tasks: DashboardTask[];
  totalSectionCount: number;
  totalTaskCount: number;
  activeTaskCount: number;
  taskFilter: TaskFilter;
  taskSortMode: TaskSortMode;
  tagSortMode: TagSortMode;
  availableTaskTags: TagInfo[];
  selectedTaskTags: string[];
  selectedTag?: string;
}

export interface TagOverviewSnapshot {
  tag: TagInfo;
  sections: TagOverviewCard[];
  renderMode: RenderMode;
  sortMode: TagOverviewSortMode;
}

export interface TagOverviewCard {
  id: string;
  filePath: string;
  heading: string;
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
  filePath: string;
  title: string;
  fileName: string;
  sourceLine: number;
  matchedTags: TagReference[];
  matchCount: number;
  totalTagCount: number;
  overlap: number;
}

export interface SidebarNotesSnapshot {
  activeFileName?: string;
  activeTags: TagReference[];
  notes: RankedNote[];
  tagOverview?: TagReference;
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

export interface SetTagSortMessage {
  type: 'setTagSort';
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

export interface OpenTagMessage {
  type: 'openTag';
  tagKey: string;
}

export interface SetTagOverviewSortMessage {
  type: 'setTagOverviewSort';
  mode: TagOverviewSortMode;
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

export type DashboardMessage =
  | OpenSourceMessage
  | ToggleTaskMessage
  | ToggleFavoriteMessage
  | SetTagSortMessage
  | SetTaskFilterMessage
  | SetTaskTagsMessage
  | SetTaskSortMessage
  | ReorderTasksMessage
  | ReorderTagsMessage
  | OpenTagMessage;

export type TagOverviewMessage =
  | OpenSourceMessage
  | SetRenderModeMessage
  | OpenTagMessage
  | SetTagOverviewSortMessage;

export type SidebarMessage =
  | OpenSourceMessage
  | OpenTagMessage
  | OpenDashboardMessage
  | CreateDailyNoteMessage;
