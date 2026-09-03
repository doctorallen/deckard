import {
  DashboardSnapshot,
  DashboardTask,
  ParsedFile,
  PersistedPreferences,
  RankedNote,
  Section,
  TagInfo,
  Task,
  TaskFilter,
  TagOverviewCard,
  TagOverviewSortMode,
  TagOverviewSnapshot,
  TagReference,
  TaskSortMode,
  SidebarNotesSnapshot,
  WorkspaceIndex,
} from '../../core/types';

import { stripTags } from '../../core/markdown/parser';
import { renderMarkdown, renderMarkdownInline } from '../webview/rendering';

/**
 * Projects one consistent dashboard model from the index and UI-only state.
 *
 * Filtering happens after ordering so ranked tasks retain their intended
 * relative order even when the user narrows the visible set.
 */
export function createDashboardSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  taskFilter: TaskFilter,
  selectedTaskTags: string[] = [],
  selectedTag?: string,
): DashboardSnapshot {
  const tags = sortTags(index.tags.values(), preferences);
  const availableTaskTags = sortTags(
    [...index.tags.values()].filter((tag) => tag.taskIds.length > 0),
    preferences,
  );
  const normalizedTaskTags = normalizeTaskTags(
    selectedTaskTags,
    availableTaskTags,
  );
  const tasks = sortTasks(
    [...index.tasks.values()],
    preferences.taskOrder,
    preferences.taskSortMode,
  )
    .filter((task) => matchesTaskFilter(task, taskFilter, normalizedTaskTags))
    .map((task) => createDashboardTask(task, index.sections));

  return {
    sections: [...index.sections.values()],
    tags,
    tasks,
    totalSectionCount: index.sections.size,
    totalTaskCount: index.tasks.size,
    activeTaskCount: [...index.tasks.values()].filter((task) => !task.completed)
      .length,
    taskFilter,
    taskSortMode: preferences.taskSortMode,
    tagSortMode: preferences.tagSortMode,
    availableTaskTags,
    selectedTaskTags: normalizedTaskTags,
    selectedTag,
  };
}

/**
 * Orders tags with favorites first and deterministic fallbacks for every mode.
 *
 * Stable label ordering keeps the UI predictable when counts or access data
 * tie, while custom order is applied only within the favorite/non-favorite
 * groups users can actually reorder.
 */
export function sortTags(
  tags: Iterable<TagInfo>,
  preferences: PersistedPreferences,
): TagInfo[] {
  const accessOrder = new Map(
    preferences.tagAccessOrder.map((tagKey, index) => [tagKey, index]),
  );
  const sorted = [...tags].map((tag) => ({
    ...tag,
    sectionIds: [...tag.sectionIds],
    taskIds: [...tag.taskIds],
    isFavorite: preferences.favoriteTags.includes(tag.key),
  }));

  sorted.sort((left, right) => {
    if (left.isFavorite !== right.isFavorite) {
      return left.isFavorite ? -1 : 1;
    }

    if (preferences.tagSortMode === 'count' && left.count !== right.count) {
      return right.count - left.count;
    }

    if (preferences.tagSortMode === 'access') {
      const leftAccess = preferences.tagAccessCounts[left.key] ?? 0;
      const rightAccess = preferences.tagAccessCounts[right.key] ?? 0;
      if (leftAccess !== rightAccess) {
        return rightAccess - leftAccess;
      }
    }

    if (preferences.tagSortMode === 'custom') {
      const leftAccess = accessOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER;
      const rightAccess = accessOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER;
      if (leftAccess !== rightAccess) {
        return leftAccess - rightAccess;
      }
    }

    return left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
    });
  });

  return sorted;
}

/**
 * Sorts tasks by the selected policy and falls back to source location.
 *
 * Missing filesystem dates sort last, and the path/line fallback makes results
 * deterministic when several tasks share the same timestamp or rank.
 */
export function sortTasks(
  tasks: Task[],
  taskOrder: string[],
  taskSortMode: TaskSortMode = 'rank',
): Task[] {
  const order = new Map(taskOrder.map((taskId, index) => [taskId, index]));
  return tasks.sort((left, right) => {
    if (taskSortMode === 'created') {
      const result = compareDatesDescending(left.createdAt, right.createdAt);
      if (result !== 0) {
        return result;
      }
    }

    if (taskSortMode === 'updated') {
      const result = compareDatesDescending(left.updatedAt, right.updatedAt);
      if (result !== 0) {
        return result;
      }
    }

    if (taskSortMode === 'rank') {
      const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    }

    return (
      left.filePath.localeCompare(right.filePath) ||
      left.lineNumber - right.lineNumber
    );
  });
}

/**
 * Applies status and tag filters independently; selected tags use OR semantics.
 */
export function matchesTaskFilter(
  task: Task,
  taskFilter: TaskFilter,
  selectedTaskTags: string[] = [],
): boolean {
  return (
    (taskFilter === 'all' ||
      (taskFilter === 'completed' ? task.completed : !task.completed)) &&
    (selectedTaskTags.length === 0 ||
      selectedTaskTags.some((tagKey) => task.tags.includes(tagKey)))
  );
}

/**
 * Filters an existing task list without treating an empty selection as a
 * special hidden state.
 */
export function filterTasksByTags(
  tasks: Task[],
  selectedTaskTags: string[],
): Task[] {
  if (selectedTaskTags.length === 0) {
    return [...tasks];
  }

  return tasks.filter((task) =>
    selectedTaskTags.some((tagKey) => task.tags.includes(tagKey)),
  );
}

/**
 * Builds the entries for one tag while dropping references removed by a refresh.
 */
export function createTagOverviewSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  tagKey: string,
): TagOverviewSnapshot | undefined {
  const tag = index.tags.get(tagKey);
  if (!tag) {
    return undefined;
  }

  const sections = tag.sectionIds
    .map((sectionId) => index.sections.get(sectionId))
    .filter((section): section is Section => section !== undefined)
    .map((section) =>
      createTagOverviewCard(section, preferences.sectionAccessCounts),
    )
    .sort((left, right) =>
      compareTagOverviewCards(left, right, preferences.tagOverviewSortMode),
    );

  return {
    tag: {
      ...tag,
      sectionIds: [...tag.sectionIds],
      taskIds: [...tag.taskIds],
      isFavorite: preferences.favoriteTags.includes(tag.key),
    },
    sections,
    renderMode: preferences.renderMode,
    sortMode: preferences.tagOverviewSortMode,
  };
}

/**
 * Adapts an overview into the sidebar's related-note contract.
 */
export function createTagOverviewSidebarSnapshot(
  snapshot: TagOverviewSnapshot,
): SidebarNotesSnapshot {
  const tag = {
    key: snapshot.tag.key,
    label: snapshot.tag.label,
  };
  const notes = snapshot.sections.map((section) => ({
    filePath: section.filePath,
    title: section.heading,
    fileName: getFileName(section.filePath) ?? section.filePath,
    sourceLine: section.startLine,
    matchedTags: [tag],
    matchCount: 1,
    totalTagCount: 1,
    overlap: 1,
  }));

  return {
    activeTags: [],
    notes,
    tagOverview: tag,
    state: notes.length > 0 ? 'ready' : 'noMatches',
  };
}

/**
 * Sorts overview cards without mutating the webview's source snapshot.
 */
export function sortTagOverviewCards(
  cards: TagOverviewCard[],
  sortMode: TagOverviewSortMode,
): TagOverviewCard[] {
  return [...cards].sort((left, right) =>
    compareTagOverviewCards(left, right, sortMode),
  );
}

/**
 * Chooses between tag-overview context and the active Markdown editor context.
 */
export function createSidebarSnapshot(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile | undefined,
): SidebarNotesSnapshot {
  if (!activeFile) {
    return { activeTags: [], notes: [], state: 'noMarkdown' };
  }

  const activeTags = sortTagReferences(collectFileTags(activeFile));
  if (activeTags.length === 0) {
    return {
      activeFileName: getFileName(activeFilePath),
      activeTags,
      notes: [],
      state: 'noTags',
    };
  }

  const notes = rankRelatedNotes(index, activeFilePath, activeTags);
  return {
    activeFileName: getFileName(activeFilePath),
    activeTags,
    notes,
    state: notes.length > 0 ? 'ready' : 'noMatches',
  };
}

/**
 * Deduplicates tags across sections and tasks so one note has one tag list.
 */
export function collectFileTags(file: ParsedFile): TagReference[] {
  const tags = new Map<string, TagReference>();
  const addTag = (key: string, label: string | undefined): void => {
    if (!tags.has(key)) {
      tags.set(key, { key, label: label ?? `#${key}` });
    }
  };

  file.sections.forEach((section) => {
    section.tags.forEach((key) => addTag(key, section.tagLabels[key]));
  });
  file.tasks.forEach((task) => {
    task.tags.forEach((key) => addTag(key, task.tagLabels[key]));
  });

  return [...tags.values()];
}

/**
 * Uses canonical keys for ordering while retaining labels for display.
 */
function sortTagReferences(tags: TagReference[]): TagReference[] {
  return tags.sort(
    (left, right) =>
      left.key.localeCompare(right.key, undefined, { sensitivity: 'base' }) ||
      left.label.localeCompare(right.label),
  );
}

/**
 * Ranks other notes by shared tags and exposes matching sections/tasks as source
 * references without duplicating a task already represented by its section.
 */
export function rankRelatedNotes(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeTags: TagReference[],
): RankedNote[] {
  const activeKeys = new Set(activeTags.map((tag) => tag.key));
  const notes: RankedNote[] = [];

  index.files.forEach((file, filePath) => {
    if (filePath === activeFilePath) {
      return;
    }

    const candidateTags = collectFileTags(file);
    const candidateKeys = new Set(candidateTags.map((tag) => tag.key));
    const matchedTags = activeTags.filter((tag) => candidateKeys.has(tag.key));
    if (matchedTags.length === 0) {
      return;
    }

    const unionSize = new Set([...activeKeys, ...candidateKeys]).size;
    const matchingSections = file.sections.filter((section) =>
      section.tags.some((tagKey) => activeKeys.has(tagKey)),
    );
    const matchingSectionIds = new Set(
      matchingSections.map((section) => section.id),
    );
    const references = matchingSections.map((section) => ({
      title: stripTags(section.heading),
      sourceLine: section.startLine,
      matchedTags: activeTags.filter((tag) => section.tags.includes(tag.key)),
    }));
    // A task under a matching section is already visible through that section;
    // include only standalone matches to keep sidebar entries distinct.
    const matchingTasks = file.tasks.filter(
      (task) =>
        task.tags.some((tagKey) => activeKeys.has(tagKey)) &&
        (!task.sectionId || !matchingSectionIds.has(task.sectionId)),
    );

    matchingTasks.forEach((task) => {
      references.push({
        title: stripTags(task.title),
        sourceLine: task.lineNumber,
        matchedTags: activeTags.filter((tag) => task.tags.includes(tag.key)),
      });
    });

    notes.push(
      ...references.map((reference) => ({
        filePath,
        title: reference.title,
        fileName: getFileName(filePath) ?? filePath,
        sourceLine: reference.sourceLine,
        matchedTags: reference.matchedTags,
        matchCount: reference.matchedTags.length,
        totalTagCount: activeTags.length,
        overlap: unionSize > 0 ? reference.matchedTags.length / unionSize : 0,
      })),
    );
  });

  return notes.sort(
    (left, right) =>
      right.matchCount - left.matchCount ||
      right.overlap - left.overlap ||
      left.filePath.localeCompare(right.filePath) ||
      left.sourceLine - right.sourceLine ||
      left.title.localeCompare(right.title),
  );
}

/**
 * Adds rendered task text and source context without changing the domain task.
 */
function createDashboardTask(
  task: Task,
  sections: Map<string, Section>,
): DashboardTask {
  return {
    task,
    renderedTitle: renderMarkdownInline(task.title),
    sectionHeading: task.sectionId
      ? sections.get(task.sectionId)?.heading
      : undefined,
    fileName: task.filePath.split('/').pop() ?? task.filePath,
  };
}

/**
 * Removes the heading from the overview body and prepares both render modes.
 */
function createTagOverviewCard(
  section: Section,
  sectionAccessCounts: Record<string, number>,
): TagOverviewCard {
  return {
    id: section.id,
    filePath: section.filePath,
    heading: stripTags(section.heading),
    tags: section.tags.map((key) => ({
      key,
      label: section.tagLabels[key] ?? `#${key}`,
    })),
    rawContent: getSectionBody(section.rawContent),
    renderedHtml: renderMarkdown(getSectionBody(section.rawContent)),
    startLine: section.startLine,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    accessCount: sectionAccessCounts[section.id] ?? 0,
  };
}

/**
 * Discards selected tags that no longer exist or no longer apply to tasks.
 */
function normalizeTaskTags(
  selectedTaskTags: string[],
  availableTaskTags: TagInfo[],
): string[] {
  const available = new Set(availableTaskTags.map((tag) => tag.key));
  return [...new Set(selectedTaskTags)].filter((tagKey) =>
    available.has(tagKey),
  );
}

/**
 * Applies the requested overview mode and a stable heading/path/line fallback.
 */
function compareTagOverviewCards(
  left: TagOverviewCard,
  right: TagOverviewCard,
  sortMode: TagOverviewSortMode,
): number {
  if (sortMode === 'created') {
    const result = compareDatesDescending(left.createdAt, right.createdAt);
    if (result !== 0) {
      return result;
    }
  }

  if (sortMode === 'updated') {
    const result = compareDatesDescending(left.updatedAt, right.updatedAt);
    if (result !== 0) {
      return result;
    }
  }

  if (sortMode === 'access' && left.accessCount !== right.accessCount) {
    return right.accessCount - left.accessCount;
  }

  return (
    left.heading.localeCompare(right.heading, undefined, {
      sensitivity: 'base',
    }) ||
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine
  );
}

/**
 * Places unknown dates after known dates for useful date sorting.
 */
function compareDatesDescending(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return right - left;
}

/**
 * Keeps overview cards focused on body content instead of repeating their title.
 */
function getSectionBody(rawContent: string): string {
  const lines = rawContent.split(/\r?\n/);
  return lines.length > 1 ? lines.slice(1).join('\n').replace(/^\n/, '') : '';
}

/**
 * Extracts a compact display name while preserving the full path elsewhere.
 */
function getFileName(filePath: string | undefined): string | undefined {
  return filePath?.split('/').pop() ?? filePath;
}
