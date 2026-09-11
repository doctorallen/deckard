import {
  DashboardSnapshot,
  DashboardTask,
  Entity,
  ParsedFile,
  PersistedPreferences,
  RelatedNotesSortMode,
  RankedNote,
  Section,
  StatsAccessItem,
  TagInfo,
  Task,
  TaskFilter,
  TagTitleDisplayMode,
  TagOverviewCard,
  TagOverviewSortMode,
  TagOverviewSnapshot,
  TagReference,
  TagAssociation,
  TaskSortMode,
  SidebarNotesSnapshot,
  WorkspaceIndex,
  DeckardStatsSnapshot,
} from '../../core/types';

import { extractWikiLinks, stripTags } from '../../core/markdown/parser';
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
  const entities = sortEntities(index.entities.values(), preferences);
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
    entities,
    tasks,
    totalSectionCount: index.sections.size,
    totalTaskCount: index.tasks.size,
    activeTaskCount: [...index.tasks.values()].filter((task) => !task.completed)
      .length,
    taskFilter,
    taskSortMode: preferences.taskSortMode,
    taskColumns: preferences.dashboardTaskColumns,
    tagColumns: preferences.dashboardTagColumns,
    tagSortMode: preferences.tagSortMode,
    entitySortMode: preferences.entitySortMode,
    availableTaskTags,
    selectedTaskTags: normalizedTaskTags,
    selectedTag,
    savedFilters: preferences.savedFilters.flatMap((filter) => {
      const tags = filter.tagKeys
        .map((tagKey) => index.tags.get(tagKey))
        .filter((tag): tag is TagInfo => tag !== undefined)
        .map((tag) => ({ key: tag.key, label: tag.label }));
      return tags.length >= 2
        ? [{ id: filter.id, name: filter.name, tags }]
        : [];
    }),
  };
}

/**
 * Summarizes the current index and recorded local navigation for the Stats page.
 */
export function createDeckardStatsSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
): DeckardStatsSnapshot {
  return {
    updatedAt: index.updatedAt,
    fileCount: index.files.size,
    sectionCount: index.sections.size,
    taskCount: index.tasks.size,
    activeTaskCount: [...index.tasks.values()].filter((task) => !task.completed)
      .length,
    tagCount: index.tags.size,
    entityCount: index.entities.size,
    wikiLinkCount: [...index.files.values()].reduce(
      (count, file) => count + file.links.length,
      0,
    ),
    tagViews: createAccessItems(preferences.tagAccessCounts, (tagKey) => {
      const tag = index.tags.get(tagKey);
      return tag
        ? { label: tag.label, detail: `${tag.count} indexed entries` }
        : undefined;
    }),
    entityViews: createAccessItems(
      preferences.entityAccessCounts,
      (entityKey) => {
        const entity = index.entities.get(entityKey);
        return entity
          ? {
              label: entity.name,
              detail: `${entity.kind} / ${entity.count} indexed entries`,
            }
          : undefined;
      },
    ),
    sectionViews: createAccessItems(
      preferences.sectionAccessCounts,
      (sectionId) => {
        const section = index.sections.get(sectionId);
        return section
          ? {
              label: stripTags(section.heading),
              detail: `${getFileName(section.filePath) ?? section.filePath} / line ${section.startLine}`,
            }
          : undefined;
      },
    ),
  };
}

/**
 * Joins persisted counters to current index entries and returns the top ten.
 */
function createAccessItems(
  counts: Record<string, number>,
  getItem: (key: string) => Omit<StatsAccessItem, 'count'> | undefined,
): StatsAccessItem[] {
  return Object.entries(counts)
    .map(([key, count]) => {
      const item = getItem(key);
      return item ? { ...item, count } : undefined;
    })
    .filter((item): item is StatsAccessItem => item !== undefined)
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.label.localeCompare(right.label, undefined, {
          sensitivity: 'base',
        }),
    )
    .slice(0, 10);
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
    filePaths: [...tag.filePaths],
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

    return compareTagLabels(left, right);
  });

  return sorted;
}

function compareTagLabels(left: TagInfo, right: TagInfo): number {
  const labelComparison = getTagDisplayName(left).localeCompare(
    getTagDisplayName(right),
    undefined,
    { sensitivity: 'base' },
  );
  return (
    labelComparison ||
    left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
    })
  );
}

function getTagDisplayName(tag: TagInfo): string {
  const label = String(tag.label || tag.key).replace(/^[@#]/, '');
  return label.slice(label.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
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
  taskFilter: TaskFilter = 'active',
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  enableHeadingTagRelationships = true,
  filterTagKey?: string,
  filterTagKeys: string[] = [],
): TagOverviewSnapshot | undefined {
  const tag = index.tags.get(tagKey);
  if (!tag) {
    return undefined;
  }
  const effectiveFilterTags = getOverviewFilterTags(
    index,
    tag.key,
    filterTagKey,
    filterTagKeys,
  );
  const effectiveFilterTagKey = effectiveFilterTags[0]?.key;
  const association =
    effectiveFilterTags.length !== 1 || effectiveFilterTagKey === undefined
      ? undefined
      : findTagAssociation(index, tag.key, effectiveFilterTagKey);
  const associationSectionIds = association
    ? new Set(association.sectionIds)
    : undefined;
  const associationTaskIds = association ? new Set(association.taskIds) : undefined;

  let sectionCandidates: Section[];
  if (associationSectionIds) {
    sectionCandidates = [...associationSectionIds]
      .map((sectionId) => index.sections.get(sectionId))
      .filter((section): section is Section => section !== undefined);
  } else if (effectiveFilterTagKey === undefined) {
    sectionCandidates = tag.sectionIds
      .map((sectionId) => index.sections.get(sectionId))
      .filter((section): section is Section => section !== undefined);
  } else {
    sectionCandidates = [...index.sections.values()].filter(
      (section) =>
        [
          tag.key,
          ...effectiveFilterTags.map((filterTag) => filterTag.key),
        ].every((activeTagKey) => sectionIncludesTag(index, section, activeTagKey)),
    );
  }
  const fileCandidates = (association ? [] : tag.filePaths)
    .map((filePath) => index.files.get(filePath))
    .filter((file): file is ParsedFile => file !== undefined)
    .filter(
      (file) =>
        effectiveFilterTags.every((filterTag) =>
          fileIncludesTag(index, file, filterTag.key),
        ),
    );

  const sections = sectionCandidates
    .map((section) =>
      createTagOverviewCard(
        section,
        preferences.sectionAccessCounts,
        tagTitleDisplayMode,
      ),
    )
    .concat(fileCandidates.map((file) => createFileOverviewCard(file)))
    .sort((left, right) =>
      compareTagOverviewCards(left, right, preferences.tagOverviewSortMode),
    );
  let taskCandidates: Task[];
  if (associationTaskIds) {
    taskCandidates = [...associationTaskIds]
      .map((taskId) => index.tasks.get(taskId))
      .filter((task): task is Task => task !== undefined);
  } else if (effectiveFilterTagKey === undefined) {
    taskCandidates = tag.taskIds
      .map((taskId) => index.tasks.get(taskId))
      .filter((task): task is Task => task !== undefined);
  } else {
    taskCandidates = [...index.tasks.values()].filter(
      (task) =>
        [
          tag.key,
          ...effectiveFilterTags.map((filterTag) => filterTag.key),
        ].every((activeTagKey) => taskIncludesTag(index, task, activeTagKey)),
    );
  }
  const taskCounts = {
    all: taskCandidates.length,
    active: taskCandidates.filter((task) => !task.completed).length,
    completed: taskCandidates.filter((task) => task.completed).length,
  };

  return {
    tag: {
      ...tag,
      sectionIds: [...tag.sectionIds],
      taskIds: [...tag.taskIds],
      filePaths: [...tag.filePaths],
      isFavorite: preferences.favoriteTags.includes(tag.key),
    },
    entity: index.entities.get(tagKey),
    filterTag: effectiveFilterTags[0],
    filterTags: effectiveFilterTags,
    associatedTags: enableHeadingTagRelationships
      ? cloneTagAssociations(index.tagAssociations?.get(tagKey) ?? [])
      : [],
    sharedAssociatedTags:
      enableHeadingTagRelationships && effectiveFilterTags.length > 0
        ? getSharedTagAssociations(index, [
            tag.key,
            ...effectiveFilterTags.map((filterTag) => filterTag.key),
          ])
        : [],
    sections,
    tasks: taskCandidates
      .filter((task) => matchesTaskFilter(task, taskFilter))
      .map((task) => createDashboardTask(task, index.sections)),
    taskCounts,
    taskFilter,
    renderMode: preferences.renderMode,
    sortMode: preferences.tagOverviewSortMode,
    layout: preferences.tagOverviewLayout,
    tagTitleDisplayMode,
  };
}

/**
 * Canonicalizes all usable filters while retaining the legacy single-filter
 * argument for callers restored from earlier webview state.
 */
function getOverviewFilterTags(
  index: WorkspaceIndex,
  focusTagKey: string,
  filterTagKey: string | undefined,
  filterTagKeys: string[],
): TagReference[] {
  const seen = new Set<string>();
  const focusLabel = index.tags.get(focusTagKey)?.label;
  return [...filterTagKeys, ...(filterTagKey ? [filterTagKey] : [])]
    .map((key) => index.tags.get(key))
    .filter((tag): tag is TagInfo => tag !== undefined)
    .filter(
      (tag) =>
        tag.key !== focusTagKey &&
        tag.label !== focusLabel &&
        !seen.has(tag.key) &&
        (seen.add(tag.key), true),
    )
    .map((tag) => ({ key: tag.key, label: tag.label }));
}

function cloneTagAssociations(
  relationships: TagAssociation[],
): TagAssociation[] {
  return relationships.map((relationship) => ({
    associatedTag: { ...relationship.associatedTag },
    sectionIds: [...relationship.sectionIds],
    taskIds: [...relationship.taskIds],
    count: relationship.count,
    weight: relationship.weight,
    normalizedWeight: relationship.normalizedWeight,
    tagSourceUnitCount: relationship.tagSourceUnitCount,
    associatedTagSourceUnitCount: relationship.associatedTagSourceUnitCount,
    totalSourceUnitCount: relationship.totalSourceUnitCount,
    coOccurrenceCount: relationship.coOccurrenceCount,
    headingRelationshipCount: relationship.headingRelationshipCount,
  }));
}

/**
 * Keeps tags independently associated with every active overview tag. The
 * lowest relationship strength expresses the limiting side of that context.
 */
function getSharedTagAssociations(
  index: WorkspaceIndex,
  activeTagKeys: string[],
): TagAssociation[] {
  const associationsByTagKey = new Map<string, TagAssociation[]>();
  activeTagKeys.forEach((activeTagKey) => {
    (index.tagAssociations?.get(activeTagKey) ?? []).forEach(
      (association) => {
        const associatedTagKey = association.associatedTag.key;
        if (!activeTagKeys.includes(associatedTagKey)) {
          const matches = associationsByTagKey.get(associatedTagKey) ?? [];
          matches.push(association);
          associationsByTagKey.set(associatedTagKey, matches);
        }
      },
    );
  });

  return [...associationsByTagKey.values()]
    .filter((associations) => associations.length === activeTagKeys.length)
    .map((associations) => {
      const [first, ...rest] = associations;
      const minimum = (
        value: (association: TagAssociation) => number,
      ): number => Math.min(...associations.map(value));
      return {
        ...first,
        associatedTag: { ...first.associatedTag },
        sectionIds: first.sectionIds.filter((sectionId) =>
          rest.every((association) => association.sectionIds.includes(sectionId)),
        ),
        taskIds: first.taskIds.filter((taskId) =>
          rest.every((association) => association.taskIds.includes(taskId)),
        ),
        count: minimum((association) => association.count),
        weight: minimum((association) => association.weight),
        normalizedWeight: minimum(
          (association) => association.normalizedWeight,
        ),
        tagSourceUnitCount: minimum(
          (association) => association.tagSourceUnitCount,
        ),
        associatedTagSourceUnitCount: minimum(
          (association) => association.associatedTagSourceUnitCount,
        ),
        totalSourceUnitCount: minimum(
          (association) => association.totalSourceUnitCount,
        ),
        coOccurrenceCount: minimum(
          (association) => association.coOccurrenceCount,
        ),
        headingRelationshipCount: minimum(
          (association) => association.headingRelationshipCount,
        ),
      };
    })
    .filter((association) =>
      hasAllTagOverviewEntries(
        index,
        [...activeTagKeys, association.associatedTag.key],
      ),
    );
}

/**
 * Offers only association filters that can produce an entry under the same
 * structural all-tag matching rules used by a multi-tag overview.
 */
function hasAllTagOverviewEntries(
  index: WorkspaceIndex,
  tagKeys: string[],
): boolean {
  return (
    [...index.sections.values()].some((section) =>
      tagKeys.every((tagKey) => sectionIncludesTag(index, section, tagKey)),
    ) ||
    [...index.tasks.values()].some((task) =>
      tagKeys.every((tagKey) => taskIncludesTag(index, task, tagKey)),
    )
  );
}

function findTagAssociation(
  index: WorkspaceIndex,
  tagKey: string,
  associatedTagKey: string,
): TagAssociation | undefined {
  return index.tagAssociations?.get(tagKey)?.find(
    (relationship) => relationship.associatedTag.key === associatedTagKey,
  );
}

function sectionIncludesTag(
  index: WorkspaceIndex,
  section: Section,
  tagKey: string,
): boolean {
  if (section.tags.includes(tagKey)) {
    return true;
  }

  let parentSectionId = section.parentSectionId;
  while (parentSectionId) {
    const parent = index.sections.get(parentSectionId);
    if (!parent) {
      break;
    }
    if (parent.headingTags?.some((tag) => tag.key === tagKey)) {
      return true;
    }
    parentSectionId = parent.parentSectionId;
  }
  return false;
}

function taskIncludesTag(
  index: WorkspaceIndex,
  task: Task,
  tagKey: string,
): boolean {
  if (task.tags.includes(tagKey)) {
    return true;
  }
  const section = task.sectionId
    ? index.sections.get(task.sectionId)
    : undefined;
  return section ? sectionIncludesTag(index, section, tagKey) : false;
}

function fileIncludesTag(
  index: WorkspaceIndex,
  file: ParsedFile,
  tagKey: string,
): boolean {
  return (
    file.frontmatterTags.some((tag) => tag.key === tagKey) ||
    file.sections.some((section) => sectionIncludesTag(index, section, tagKey)) ||
    file.tasks.some((task) => taskIncludesTag(index, task, tagKey))
  );
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
    headingPath: [stripTags(section.heading)],
    titleTags: section.titleTags,
    matchedTags: [tag],
    matchCount: 1,
    totalTagCount: 1,
    overlap: 1,
    relevanceScore: 100,
  }));

  return {
    activeTags: [],
    notes,
    tagOverview: tag,
    tagOverviewFilter: snapshot.filterTag
      ? { ...snapshot.filterTag }
      : undefined,
    tagOverviewFilters: snapshot.filterTags.map((tag) => ({ ...tag })),
    tagOverviewRelationships: {
      associatedTags: cloneTagAssociations(snapshot.associatedTags),
      sharedAssociatedTags: cloneTagAssociations(snapshot.sharedAssociatedTags),
    },
    tagTitleDisplayMode: snapshot.tagTitleDisplayMode,
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
  enableKeywordLinks = true,
  relatedNotesSortMode: RelatedNotesSortMode = 'tags',
  sectionAccessCounts: Record<string, number> = {},
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  activeEntryTitle?: string,
  activeTagWeights?: ReadonlyMap<string, number>,
  rankingOptions?: RelatedNotesRankingOptions,
): SidebarNotesSnapshot {
  if (!activeFile) {
    return {
      activeTags: [],
      notes: [],
      relatedNotesSortMode,
      tagOverviewFilters: [],
      tagTitleDisplayMode,
      state: 'noMarkdown',
    };
  }

  const activeTags = sortTagReferences(collectFileTags(activeFile));
  const notes = rankRelatedNotes(
    index,
    activeFilePath,
    activeFile,
    activeTags,
    enableKeywordLinks,
    tagTitleDisplayMode,
    activeTagWeights,
    rankingOptions,
  );
  return {
    activeFileName: getFileName(activeFilePath),
    activeEntryTitle,
    activeTags,
    notes: sortRelatedNotes(notes, relatedNotesSortMode, sectionAccessCounts),
    relatedNotesSortMode,
    tagOverviewFilters: [],
    tagTitleDisplayMode,
    state:
      notes.length > 0
        ? 'ready'
        : activeTags.length > 0
          ? 'noMatches'
          : 'noTags',
  };
}

/**
 * Deduplicates tags across sections and tasks so one note has one tag list.
 */
export function collectFileTags(file: ParsedFile): TagReference[] {
  const tags = new Map<string, TagReference>();
  const addTag = (key: string, label: string | undefined): void => {
    if (!tags.has(key)) {
      tags.set(key, { key, label: label ?? key });
    }
  };

  file.frontmatterTags.forEach((tag) => addTag(tag.key, tag.label));
  file.sections.forEach((section) => {
    section.tags.forEach((key) => addTag(key, section.tagLabels[key]));
  });
  file.tasks.forEach((task) => {
    task.tags.forEach((key) => addTag(key, task.tagLabels[key]));
  });

  return [...tags.values()];
}

function getTagReferences(
  keys: string[],
  labels: Record<string, string>,
): TagReference[] {
  return keys.map((key) => ({ key, label: labels[key] ?? key }));
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
export interface RelatedNotesRankingOptions {
  /**
   * One preserves intentional one-off associations; higher values suppress
   * low-support learned edges without discarding their index evidence.
   */
  associationMinimumSupport?: number;
  /** Disabled at zero; a positive value is the recency decay half-life. */
  recencyHalfLifeDays?: number;
}

export function rankRelatedNotes(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile,
  activeTags: TagReference[],
  enableKeywordLinks = true,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  activeTagWeights: ReadonlyMap<string, number> = new Map(),
  options: RelatedNotesRankingOptions = {},
): RankedNote[] {
  const activeKeys = new Set(activeTags.map((tag) => tag.key));
  const notes: RankedNote[] = [];
  const associationMinimumSupport = Math.max(
    1,
    Math.floor(options.associationMinimumSupport ?? 1),
  );
  const lexicalModel = enableKeywordLinks
    ? createLexicalModel(index, activeFile)
    : undefined;

  index.files.forEach((file, filePath) => {
    if (filePath === activeFilePath) {
      return;
    }

    const findAssociatedMatches = (
      candidateTags: TagReference[],
    ): Array<{ tag: TagReference; weight: number; rawWeight: number }> =>
      candidateTags.flatMap((candidateTag) => {
        const associations = activeTags
          .map((activeTag) => ({
            association: findTagAssociation(
              index,
              activeTag.key,
              candidateTag.key,
            ),
            activeWeight: activeTagWeights.get(activeTag.key) ?? 1,
          }))
          .filter(
            (match): match is {
              association: TagAssociation;
              activeWeight: number;
            } =>
              match.association !== undefined &&
              match.association.count >= associationMinimumSupport,
          );
        const weight = associations.reduce(
          (total, match) =>
            total + match.association.normalizedWeight * match.activeWeight,
          0,
        );
        const rawWeight = associations.reduce(
          (total, match) =>
            total + match.association.weight * match.activeWeight,
          0,
        );
        return weight > 0
          ? [{ tag: candidateTag, weight, rawWeight }]
          : [];
      });
    const totalActiveWeight = activeTags.reduce(
      (total, tag) => total + (activeTagWeights.get(tag.key) ?? 1),
      0,
    );
    const matchingSections = file.sections.filter((section) => {
      const tags = getTagReferences(section.tags, section.tagLabels);
      const associatedMatches = findAssociatedMatches(tags);
      const linkEvidence = getLinkEvidence(
        activeFile,
        activeFilePath,
        file,
        extractWikiLinks(
          getSectionLexicalContent(section, file.sections),
        ),
        section.heading,
      );
      const lexicalWeight = getLexicalWeight(
        lexicalModel,
        section.heading,
        getSectionLexicalContent(section, file.sections),
      ).weight;
      return (
        tags.some((tag) => activeKeys.has(tag.key)) ||
        associatedMatches.length > 0 ||
        linkEvidence.entryWeight > 0 ||
        linkEvidence.fileWeight > 0 ||
        lexicalWeight > 0
      );
    });
    const matchingSectionIds = new Set(
      matchingSections.map((section) => section.id),
    );
    const sectionsById = new Map(
      file.sections.map((section) => [section.id, section]),
    );
    const references: Array<{
      sectionId?: string;
      title: string;
      sourceLine: number;
      titleTags: TagReference[];
      updatedAt?: number;
      tags: TagReference[];
      rawContent: string;
      links: string[];
      headingPath: string[];
      dailyDate?: string;
    }> = matchingSections.map((section) => ({
      sectionId: section.id,
      title: getNoteTitle(section.heading, tagTitleDisplayMode),
      sourceLine: section.startLine,
      titleTags: getTitleTags(
        section.tags,
        section.tagLabels,
        getInlineSource(section),
      ),
      updatedAt: file.updatedAt ?? section.updatedAt,
      tags: getTagReferences(section.tags, section.tagLabels),
      rawContent: getSectionLexicalContent(section, file.sections),
      links: extractWikiLinks(
        getSectionLexicalContent(section, file.sections),
      ),
      headingPath: getHeadingPath(section, sectionsById),
      dailyDate: getDailyNoteDate(file),
    }));
    // A task under a matching section is already visible through that section;
    // include only standalone matches to keep sidebar entries distinct.
    const matchingTasks = file.tasks.filter((task) => {
      const tags = getTagReferences(task.tags, task.tagLabels);
      const linkEvidence = getLinkEvidence(
        activeFile,
        activeFilePath,
        file,
        extractWikiLinks(task.sourceLineText),
        task.title,
      );
      const lexicalWeight = getLexicalWeight(
        lexicalModel,
        task.title,
        task.sourceLineText,
      ).weight;
      return (
        (tags.some((tag) => activeKeys.has(tag.key)) ||
          findAssociatedMatches(tags).length > 0 ||
          linkEvidence.entryWeight > 0 ||
          linkEvidence.fileWeight > 0 ||
          lexicalWeight > 0) &&
        (!task.sectionId || !matchingSectionIds.has(task.sectionId))
      );
    });

    matchingTasks.forEach((task) => {
      references.push({
        sectionId: task.sectionId,
        title: getNoteTitle(task.title, tagTitleDisplayMode),
        sourceLine: task.lineNumber,
        titleTags: getTitleTags(task.tags, task.tagLabels, task.title),
        updatedAt: file.updatedAt ?? task.updatedAt,
        tags: getTagReferences(task.tags, task.tagLabels),
        rawContent: task.sourceLineText,
        links: extractWikiLinks(task.sourceLineText),
        headingPath: getTaskHeadingPath(task, sectionsById),
        dailyDate: getDailyNoteDate(file),
      });
    });

    notes.push(
      ...references.map((reference) => {
        const matchedTags = activeTags.filter((tag) =>
          reference.tags.some((candidateTag) => candidateTag.key === tag.key),
        );
        const associatedMatches = findAssociatedMatches(reference.tags);
        const associationMatches = reference.tags.flatMap((candidateTag) =>
          activeTags.flatMap((selectedTag) => {
            const association = findTagAssociation(
              index,
              selectedTag.key,
              candidateTag.key,
            );
            if (
              !association ||
              association.count < associationMinimumSupport
            ) {
              return [];
            }
            const selectedWeight =
              activeTagWeights.get(selectedTag.key) ?? 1;
            return [{
              selectedTag,
              candidateTag,
              associationWeight: association.weight,
              normalizedAssociationWeight: association.normalizedWeight,
              sourceUnitCount: association.count,
              selectedTagSourceUnitCount: association.tagSourceUnitCount,
              candidateTagSourceUnitCount:
                association.associatedTagSourceUnitCount,
              totalSourceUnitCount: association.totalSourceUnitCount,
              selectedWeight,
              contribution: association.normalizedWeight * selectedWeight,
            }];
          }),
        );
        const associationWeight = associatedMatches.reduce(
          (total, match) => total + match.rawWeight,
          0,
        );
        const normalizedAssociationWeight = associationMatches.reduce(
          (total, match) => total + match.normalizedAssociationWeight,
          0,
        );
        const unionSize = new Set([
          ...activeKeys,
          ...reference.tags.map((tag) => tag.key),
        ]).size;
        const directTagWeight = matchedTags.reduce(
          (total, tag) => total + 2 * (activeTagWeights.get(tag.key) ?? 1),
          0,
        );
        const appliedAssociationWeight = getDiminishingAssociationWeight(
          normalizedAssociationWeight,
          totalActiveWeight,
        );
        const linkEvidence = getLinkEvidence(
          activeFile,
          activeFilePath,
          file,
          reference.links,
          reference.title,
        );
        const lexicalEvidence = getLexicalWeight(
          lexicalModel,
          reference.title,
          reference.rawContent,
        );
        const recencyWeight = getRecencyWeight(
          getRelevantDate(file),
          options.recencyHalfLifeDays,
        );
        const relevanceScore = Math.round(
          Math.min(
            1,
            (directTagWeight +
              appliedAssociationWeight +
              linkEvidence.entryWeight +
              linkEvidence.fileWeight +
              lexicalEvidence.weight +
              recencyWeight) /
              Math.max(1, totalActiveWeight * 2),
          ) * 100,
        );
        const specificityPenalty =
          reference.sectionId &&
          matchedTags.length > 0 &&
          hasMoreSpecificMatchingDescendant(
            reference.sectionId,
            matchingSections,
            matchedTags,
            sectionsById,
          )
            ? 0.05
            : 0;
        const referenceRelevanceScore = Math.max(
          0,
          relevanceScore - Math.round(specificityPenalty * 100),
        );
        return {
          sectionId: reference.sectionId,
          filePath,
          title: reference.title,
          fileName: getFileName(filePath) ?? filePath,
          sourceLine: reference.sourceLine,
          headingPath: reference.headingPath,
          dailyDate: reference.dailyDate,
          titleTags: reference.titleTags,
          updatedAt: reference.updatedAt,
          matchedTags,
          matchCount: matchedTags.reduce(
            (total, tag) => total + (activeTagWeights.get(tag.key) ?? 1),
            0,
          ),
          totalTagCount: activeTags.length,
          overlap:
            unionSize > 0 ? referenceRelevanceScore / 100 : 0,
          relevanceScore: referenceRelevanceScore,
          associationWeight,
          associationMatches,
          relevanceEvidence: {
            directTagWeight,
            associationWeight,
            normalizedAssociationWeight,
            appliedAssociationWeight,
            entryLinkWeight: linkEvidence.entryWeight,
            fileLinkWeight: linkEvidence.fileWeight,
            lexicalWeight: lexicalEvidence.weight,
            recencyWeight,
            specificityPenalty,
            lexicalTerms: lexicalEvidence.terms,
          },
          reasons: [
            ...(matchedTags.length > 0
              ? [
                  `Shared: ${matchedTags.map((tag) => tag.label).join(', ')}`,
                ]
              : []),
            ...(associatedMatches.length > 0
              ? [
                  `Associated: ${associatedMatches
                    .map((match) => match.tag.label)
                    .join(', ')}`,
                ]
              : []),
            ...(linkEvidence.entryWeight > 0 ? ['Direct entry link'] : []),
            ...(linkEvidence.fileWeight > 0 ? ['Linked note'] : []),
            ...(lexicalEvidence.terms.length > 0
              ? [
                  `Similar terms: ${lexicalEvidence.terms
                    .slice(0, 3)
                    .map((term) => term.term)
                    .join(', ')}`,
                ]
              : []),
            ...(recencyWeight > 0
              ? [`Recent ${getRelevantDate(file)?.source ?? 'note'}`]
              : []),
            ...(specificityPenalty > 0
              ? ['Broader match contains a more specific entry']
              : []),
          ],
        };
      }),
    );
  });

  return notes.sort(compareRelatedNotes);
}

/**
 * Lets stronger association evidence keep improving relevance without allowing
 * repeated indirect evidence to overwhelm a complete direct-tag match.
 */
function getDiminishingAssociationWeight(
  rawAssociationWeight: number,
  totalActiveWeight: number,
): number {
  if (rawAssociationWeight <= 0 || totalActiveWeight <= 0) {
    return 0;
  }
  return (
    totalActiveWeight *
    (rawAssociationWeight / (rawAssociationWeight + totalActiveWeight))
  );
}

function hasMoreSpecificMatchingDescendant(
  sectionId: string,
  matchingSections: Section[],
  matchedTags: TagReference[],
  sectionsById: ReadonlyMap<string, Section>,
): boolean {
  return matchingSections.some((candidate) => {
    if (
      candidate.id === sectionId ||
      !matchedTags.every((tag) => candidate.tags.includes(tag.key))
    ) {
      return false;
    }

    let parentId = candidate.parentSectionId;
    while (parentId) {
      if (parentId === sectionId) {
        return true;
      }
      parentId = sectionsById.get(parentId)?.parentSectionId;
    }
    return false;
  });
}

/**
 * Applies the selected Related Notes ordering while preserving deterministic
 * relevance and source-location fallbacks for tied values.
 */
export function sortRelatedNotes(
  notes: RankedNote[],
  sortMode: RelatedNotesSortMode,
  sectionAccessCounts: Record<string, number> = {},
): RankedNote[] {
  return [...notes].sort((left, right) => {
    if (sortMode === 'newest' || sortMode === 'oldest') {
      const dateOrder = compareRelatedNoteDates(
        left.updatedAt,
        right.updatedAt,
        sortMode,
      );
      if (dateOrder !== 0) {
        return dateOrder;
      }
    }

    if (sortMode === 'access') {
      const leftAccess = left.sectionId
        ? (sectionAccessCounts[left.sectionId] ?? 0)
        : 0;
      const rightAccess = right.sectionId
        ? (sectionAccessCounts[right.sectionId] ?? 0)
        : 0;
      if (leftAccess !== rightAccess) {
        return rightAccess - leftAccess;
      }
    }

    return compareRelatedNotes(left, right);
  });
}

function compareRelatedNoteDates(
  left: number | undefined,
  right: number | undefined,
  sortMode: 'newest' | 'oldest',
): number {
  if (left === undefined || right === undefined) {
    if (left === right) {
      return 0;
    }
    return left === undefined ? 1 : -1;
  }
  return sortMode === 'newest' ? right - left : left - right;
}

function compareRelatedNotes(left: RankedNote, right: RankedNote): number {
  return (
    right.relevanceScore - left.relevanceScore ||
    right.matchCount - left.matchCount ||
    (right.associationWeight ?? 0) - (left.associationWeight ?? 0) ||
    right.overlap - left.overlap ||
    (right.reasons?.length ?? 0) - (left.reasons?.length ?? 0) ||
    left.filePath.localeCompare(right.filePath) ||
    left.sourceLine - right.sourceLine ||
    left.title.localeCompare(right.title)
  );
}

export function sortEntities(
  entities: Iterable<Entity>,
  preferences: PersistedPreferences,
): Entity[] {
  const order = new Map(
    preferences.entityAccessOrder.map((entityKey, index) => [entityKey, index]),
  );

  const sorted = [...entities].map((entity) => ({
    ...entity,
    sectionIds: [...entity.sectionIds],
    taskIds: [...entity.taskIds],
    filePaths: [...entity.filePaths],
    isFavorite: preferences.favoriteEntities.includes(entity.key),
  }));

  sorted.sort((left, right) => {
    if (left.isFavorite !== right.isFavorite) {
      return left.isFavorite ? -1 : 1;
    }
    if (preferences.entitySortMode === 'count' && left.count !== right.count) {
      return right.count - left.count;
    }
    if (preferences.entitySortMode === 'access') {
      const leftAccess = preferences.entityAccessCounts[left.key] ?? 0;
      const rightAccess = preferences.entityAccessCounts[right.key] ?? 0;
      if (leftAccess !== rightAccess) {
        return rightAccess - leftAccess;
      }
    }
    if (preferences.entitySortMode === 'custom') {
      const leftOrder = order.get(left.key) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.key) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    }
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
    });
  });

  return sorted;
}

function getLinkEvidence(
  activeFile: ParsedFile,
  activeFilePath: string | undefined,
  candidateFile: ParsedFile,
  candidateLinks: string[],
  candidateTitle: string,
): { entryWeight: number; fileWeight: number } {
  const activeEntryTitle =
    activeFile.sections[0]?.heading ?? activeFile.tasks[0]?.title;
  const candidateMatchesActive = candidateLinks.some((link) =>
    activeEntryTitle !== undefined &&
    linkTargetsEntry(link, activeFilePath ?? activeFile.filePath, activeEntryTitle),
  );
  const activeMatchesCandidate = activeFile.links.some((link) =>
    linkTargetsEntry(link, candidateFile.filePath, candidateTitle),
  );
  if (candidateMatchesActive || activeMatchesCandidate) {
    return { entryWeight: 0.5, fileWeight: 0 };
  }
  return filesAreLinked(activeFile, candidateFile)
    ? { entryWeight: 0, fileWeight: 0.1 }
    : { entryWeight: 0, fileWeight: 0 };
}

function filesAreLinked(left: ParsedFile, right: ParsedFile): boolean {
  const leftNames = getLinkNames(left.filePath);
  const rightNames = getLinkNames(right.filePath);
  return (
    left.links.some((link) => rightNames.has(getLinkFileTarget(link))) ||
    right.links.some((link) => leftNames.has(getLinkFileTarget(link)))
  );
}

function linkTargetsEntry(
  link: string,
  filePath: string,
  title: string,
): boolean {
  const [fileTarget, headingTarget] = link.split('#', 2);
  if (!getLinkNames(filePath).has(normalizeLink(fileTarget))) {
    return false;
  }
  return !headingTarget || normalizeHeadingTarget(headingTarget) ===
    normalizeHeadingTarget(title);
}

function getLinkNames(filePath: string): Set<string> {
  const fileName = filePath.split('/').pop() ?? filePath;
  return new Set([
    normalizeLink(filePath),
    normalizeLink(fileName),
    normalizeLink(fileName.replace(/\.md$/i, '')),
  ]);
}

function getLinkFileTarget(link: string): string {
  return normalizeLink(link.split('#', 1)[0]);
}

function normalizeLink(value: string): string {
  return value.trim().replace(/\.md$/i, '').toLocaleLowerCase();
}

function normalizeHeadingTarget(value: string): string {
  return stripTags(value)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface LexicalModel {
  queryTerms: Set<string>;
  documentFrequency: Map<string, number>;
  documentCount: number;
  averageLength: number;
}

interface LexicalEvidence {
  weight: number;
  terms: Array<{ term: string; contribution: number }>;
}

function createLexicalModel(
  index: WorkspaceIndex,
  activeFile: ParsedFile,
): LexicalModel {
  const documents = [
    ...index.sections.values(),
  ].map((section) =>
    getLexicalTerms(
      section.heading,
      getSectionLexicalContent(
        section,
        index.files.get(section.filePath)?.sections ?? [],
      ),
    ),
  ).concat(
    [...index.tasks.values()].map((task) =>
      getLexicalTerms(task.title, task.sourceLineText),
    ),
  );
  const documentFrequency = new Map<string, number>();
  documents.forEach((terms) => {
    new Set(terms).forEach((term) =>
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1),
    );
  });
  const activeTerms = getLexicalTerms(activeFile.content, activeFile.content);
  return {
    queryTerms: new Set(activeTerms),
    documentFrequency,
    documentCount: Math.max(1, documents.length),
    averageLength: Math.max(
      1,
      documents.reduce((total, terms) => total + terms.length, 0) /
        Math.max(1, documents.length),
    ),
  };
}

function getLexicalWeight(
  model: LexicalModel | undefined,
  title: string,
  content: string,
): LexicalEvidence {
  if (!model || model.queryTerms.size === 0) {
    return { weight: 0, terms: [] };
  }
  const terms = getLexicalTerms(title, content);
  const frequencies = new Map<string, number>();
  terms.forEach((term) => frequencies.set(term, (frequencies.get(term) ?? 0) + 1));
  const lengthFactor =
    1.2 * (1 - 0.75 + 0.75 * (terms.length / model.averageLength));
  const contributions = [...model.queryTerms].flatMap((term) => {
    const frequency = frequencies.get(term) ?? 0;
    if (frequency === 0) {
      return [];
    }
    const inverseFrequency = Math.log(
      1 + (model.documentCount - (model.documentFrequency.get(term) ?? 0) + 0.5) /
        ((model.documentFrequency.get(term) ?? 0) + 0.5),
    );
    const contribution =
      inverseFrequency * ((frequency * 2.2) / (frequency + lengthFactor));
    return contribution > 0 ? [{ term, contribution }] : [];
  });
  const rawWeight = contributions.reduce(
    (total, term) => total + term.contribution,
    0,
  );
  return {
    weight: Math.min(0.3, rawWeight / (rawWeight + 1)),
    terms: contributions.sort((left, right) => right.contribution - left.contribution),
  };
}

function getLexicalTerms(title: string, content: string): string[] {
  const ignored = new Set([
    'about',
    'after',
    'before',
    'because',
    'could',
    'should',
    'their',
    'there',
    'these',
    'those',
    'which',
    'would',
    'with',
  ]);
  const clean = `${title}\n${content}`
    .replace(/^---\s*$[\s\S]*?^---\s*$/m, ' ')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/\[\[[^\]]+\]\]|https?:\/\/\S+|[#@][\w/-]+/g, ' ');
  const titleTerms = title
    .replace(/[#@][\w/-]+/g, ' ')
    .toLocaleLowerCase()
    .match(/[a-z][a-z-]{2,}/g) ?? [];
  const bodyTerms = clean.toLocaleLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
  return [
    ...titleTerms.filter((word) => !ignored.has(word)),
    ...titleTerms.filter((word) => !ignored.has(word)),
    ...bodyTerms.filter((word) => !ignored.has(word)),
  ];
}

function getSectionLexicalContent(
  section: Section,
  fileSections: Section[],
): string {
  if (section.isInline) {
    return section.rawContent || section.heading;
  }
  const lines = section.rawContent.split(/\r?\n/);
  const excludedChildren = fileSections
    .filter(
      (candidate) =>
        candidate.id !== section.id &&
        candidate.startLine > section.startLine &&
        candidate.endLine <= section.endLine,
    )
    .sort((left, right) => right.startLine - left.startLine);
  excludedChildren.forEach((child) => {
    const start = child.startLine - section.startLine;
    const end = child.endLine - section.startLine + 1;
    lines.splice(start, end - start);
  });
  return lines.join('\n');
}

function getHeadingPath(
  section: Section,
  sectionsById: ReadonlyMap<string, Section>,
): string[] {
  const path = [stripTags(section.heading)];
  const visited = new Set<string>([section.id]);
  let parentId = section.parentSectionId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = sectionsById.get(parentId);
    if (!parent) {
      break;
    }
    path.unshift(stripTags(parent.heading));
    parentId = parent.parentSectionId;
  }
  return path.filter(Boolean);
}

function getTaskHeadingPath(
  task: Task,
  sectionsById: ReadonlyMap<string, Section>,
): string[] {
  const section = task.sectionId ? sectionsById.get(task.sectionId) : undefined;
  return section
    ? [...getHeadingPath(section, sectionsById), stripTags(task.title)]
    : [stripTags(task.title)];
}

function getDailyNoteDate(file: ParsedFile): string | undefined {
  const fromPath = file.filePath.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})(?:\.md)?$/);
  if (fromPath) {
    return fromPath[1];
  }
  return file.sections
    .filter((section) => section.headingLevel === 1)
    .map((section) => section.heading.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0])
    .find((date): date is string => date !== undefined);
}

function getRelevantDate(
  file: ParsedFile,
): { at: number; source: string } | undefined {
  const frontmatterBlock = file.content.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/,
  )?.[1];
  const frontmatter = frontmatterBlock?.match(
    /^(?:date|created|updated):\s*["']?(\d{4}-\d{2}-\d{2})/im,
  )?.[1];
  const dailyDate = getDailyNoteDate(file);
  const date = frontmatter ?? dailyDate;
  if (date) {
    const at = new Date(`${date}T00:00:00`).getTime();
    if (!Number.isNaN(at)) {
      return { at, source: frontmatter ? 'dated note' : `daily note ${date}` };
    }
  }
  return file.updatedAt === undefined
    ? undefined
    : { at: file.updatedAt, source: 'updated note' };
}

function getRecencyWeight(
  date: { at: number } | undefined,
  halfLifeDays: number | undefined,
): number {
  if (!date || !halfLifeDays || halfLifeDays <= 0) {
    return 0;
  }
  const ageDays = Math.max(0, (Date.now() - date.at) / 86_400_000);
  return 0.1 * 2 ** (-ageDays / halfLifeDays);
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
  tagTitleDisplayMode: TagTitleDisplayMode,
): TagOverviewCard {
  return {
    id: section.id,
    filePath: section.filePath,
    heading: getNoteTitle(section.heading, tagTitleDisplayMode),
    titleTags: getTitleTags(
      section.tags,
      section.tagLabels,
      getInlineSource(section),
    ),
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

function createFileOverviewCard(file: ParsedFile): TagOverviewCard {
  const heading = getFileName(file.filePath) ?? file.filePath;
  const rawContent = getFrontmatterBody(file.content);
  return {
    id: `frontmatter:${file.filePath}`,
    filePath: file.filePath,
    heading,
    titleTags: [],
    tags: file.frontmatterTags.map((tag) => ({ ...tag })),
    rawContent,
    renderedHtml: renderMarkdown(rawContent),
    startLine: 1,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    accessCount: 0,
  };
}

export function normalizeTagTitleDisplayMode(
  value: unknown,
): TagTitleDisplayMode {
  return value === 'separate' ? 'separate' : 'inline';
}

function getNoteTitle(
  heading: string,
  tagTitleDisplayMode: TagTitleDisplayMode,
): string {
  return tagTitleDisplayMode === 'separate' ? stripTags(heading) : heading;
}

function getTitleTags(
  tagKeys: string[],
  tagLabels: Record<string, string>,
  title: string,
): TagReference[] {
  return tagKeys
    .map((key) => ({
      key,
      label: tagLabels[key] ?? `#${key}`,
    }))
    .filter((tag) => title.includes(tag.label));
}

function getInlineSource(section: Section): string {
  return section.isInline && section.rawContent
    ? section.rawContent
    : section.heading;
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

function getFrontmatterBody(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  const endLine = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  return endLine >= 0 ? lines.slice(endLine + 1).join('\n').replace(/^\n/, '') : content;
}

/**
 * Extracts a compact display name while preserving the full path elsewhere.
 */
function getFileName(filePath: string | undefined): string | undefined {
  return filePath?.split('/').pop() ?? filePath;
}
