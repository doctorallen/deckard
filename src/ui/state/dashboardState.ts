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
    tagSortMode: preferences.tagSortMode,
    entitySortMode: preferences.entitySortMode,
    availableTaskTags,
    selectedTaskTags: normalizedTaskTags,
    selectedTag,
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
  taskFilter: TaskFilter = 'active',
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  enableHeadingTagRelationships = true,
  filterTagKey?: string,
): TagOverviewSnapshot | undefined {
  const tag = index.tags.get(tagKey);
  if (!tag) {
    return undefined;
  }
  const filterTag = filterTagKey ? index.tags.get(filterTagKey) : undefined;
  const effectiveFilterTagKey = filterTag?.key;
  const association =
    effectiveFilterTagKey === undefined
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
        sectionIncludesTag(index, section, tag.key) &&
        sectionIncludesTag(index, section, effectiveFilterTagKey),
    );
  }
  const fileCandidates = (association ? [] : tag.filePaths)
    .map((filePath) => index.files.get(filePath))
    .filter((file): file is ParsedFile => file !== undefined)
    .filter(
      (file) =>
        effectiveFilterTagKey === undefined ||
        fileIncludesTag(index, file, effectiveFilterTagKey),
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
        taskIncludesTag(index, task, tag.key) &&
        taskIncludesTag(index, task, effectiveFilterTagKey),
    );
  }

  return {
    tag: {
      ...tag,
      sectionIds: [...tag.sectionIds],
      taskIds: [...tag.taskIds],
      filePaths: [...tag.filePaths],
      isFavorite: preferences.favoriteTags.includes(tag.key),
    },
    entity: index.entities.get(tagKey),
    filterTag: filterTag
      ? { key: filterTag.key, label: filterTag.label }
      : undefined,
    associatedTags: enableHeadingTagRelationships
      ? cloneTagAssociations(index.tagAssociations?.get(tagKey) ?? [])
      : [],
    sections,
    tasks: taskCandidates
      .filter((task) => matchesTaskFilter(task, taskFilter))
      .map((task) => createDashboardTask(task, index.sections)),
    taskFilter,
    renderMode: preferences.renderMode,
    sortMode: preferences.tagOverviewSortMode,
    layout: preferences.tagOverviewLayout,
    tagTitleDisplayMode,
  };
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
    coOccurrenceCount: relationship.coOccurrenceCount,
    headingRelationshipCount: relationship.headingRelationshipCount,
  }));
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
    tagOverviewRelationships: {
      associatedTags: cloneTagAssociations(snapshot.associatedTags),
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
): SidebarNotesSnapshot {
  if (!activeFile) {
    return {
      activeTags: [],
      notes: [],
      relatedNotesSortMode,
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
  );
  return {
    activeFileName: getFileName(activeFilePath),
    activeEntryTitle,
    activeTags,
    notes: sortRelatedNotes(notes, relatedNotesSortMode, sectionAccessCounts),
    relatedNotesSortMode,
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
export function rankRelatedNotes(
  index: WorkspaceIndex,
  activeFilePath: string | undefined,
  activeFile: ParsedFile,
  activeTags: TagReference[],
  enableKeywordLinks = true,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  activeTagWeights: ReadonlyMap<string, number> = new Map(),
): RankedNote[] {
  const activeKeys = new Set(activeTags.map((tag) => tag.key));
  const notes: RankedNote[] = [];

  index.files.forEach((file, filePath) => {
    if (filePath === activeFilePath) {
      return;
    }

    const findAssociatedMatches = (
      candidateTags: TagReference[],
    ): Array<{ tag: TagReference; weight: number }> =>
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
            } => match.association !== undefined,
          );
        const weight = associations.reduce(
          (total, match) =>
            total + match.association.weight * match.activeWeight,
          0,
        );
        return weight > 0 ? [{ tag: candidateTag, weight }] : [];
      });
    const directLink = filesAreLinked(activeFile, file);
    const sharedKeywords = enableKeywordLinks
      ? getSharedKeywords(activeFile, file)
      : [];
    const totalActiveWeight = activeTags.reduce(
      (total, tag) => total + (activeTagWeights.get(tag.key) ?? 1),
      0,
    );
    const matchingSections = file.sections.filter((section) => {
      const tags = getTagReferences(section.tags, section.tagLabels);
      const associatedMatches = findAssociatedMatches(tags);
      return (
        tags.some((tag) => activeKeys.has(tag.key)) ||
        associatedMatches.length > 0 ||
        directLink ||
        sharedKeywords.some((keyword) =>
          section.rawContent.toLowerCase().includes(keyword),
        )
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
      rawContent: section.rawContent,
    }));
    // A task under a matching section is already visible through that section;
    // include only standalone matches to keep sidebar entries distinct.
    const matchingTasks = file.tasks.filter((task) => {
      const tags = getTagReferences(task.tags, task.tagLabels);
      return (
        (tags.some((tag) => activeKeys.has(tag.key)) ||
          findAssociatedMatches(tags).length > 0) &&
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
            if (!association) {
              return [];
            }
            const selectedWeight =
              activeTagWeights.get(selectedTag.key) ?? 1;
            return [{
              selectedTag,
              candidateTag,
              associationWeight: association.weight,
              selectedWeight,
              contribution: association.weight * selectedWeight,
            }];
          }),
        );
        const associationWeight = associatedMatches.reduce(
          (total, match) => total + match.weight,
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
          associationWeight,
          totalActiveWeight,
        );
        const linkWeight = directLink ? 0.25 : 0;
        const hasSharedKeywords = sharedKeywords.some((keyword) =>
          reference.rawContent.toLowerCase().includes(keyword),
        );
        const keywordWeight = hasSharedKeywords ? 0.1 : 0;
        const relevanceScore = Math.round(
          Math.min(
            1,
            (directTagWeight +
              appliedAssociationWeight +
              linkWeight +
              keywordWeight) /
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
            appliedAssociationWeight,
            linkWeight,
            keywordWeight,
            specificityPenalty,
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
            ...(directLink ? ['Linked note'] : []),
            ...(hasSharedKeywords
              ? [`Keywords: ${sharedKeywords.slice(0, 3).join(', ')}`]
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

function filesAreLinked(left: ParsedFile, right: ParsedFile): boolean {
  const leftNames = getLinkNames(left.filePath);
  const rightNames = getLinkNames(right.filePath);
  return (
    left.links.some((link) => rightNames.has(normalizeLink(link))) ||
    right.links.some((link) => leftNames.has(normalizeLink(link)))
  );
}

function getLinkNames(filePath: string): Set<string> {
  const fileName = filePath.split('/').pop() ?? filePath;
  return new Set([
    normalizeLink(filePath),
    normalizeLink(fileName),
    normalizeLink(fileName.replace(/\.md$/i, '')),
  ]);
}

function normalizeLink(value: string): string {
  return value.trim().replace(/\.md$/i, '').toLocaleLowerCase();
}

function getSharedKeywords(left: ParsedFile, right: ParsedFile): string[] {
  const leftKeywords = getKeywords(left.content);
  const rightKeywords = new Set(getKeywords(right.content));
  return leftKeywords
    .filter((keyword) => rightKeywords.has(keyword))
    .slice(0, 5);
}

function getKeywords(content: string): string[] {
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
  return [
    ...new Set(
      content
        .toLocaleLowerCase()
        .match(/[a-z][a-z-]{4,}/g)
        ?.filter((word) => !ignored.has(word)) ?? [],
    ),
  ];
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
