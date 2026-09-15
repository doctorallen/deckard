import {
  DashboardSnapshot,
  DashboardNote,
  DashboardTask,
  Entity,
  ParsedFile,
  PersistedPreferences,
  Section,
  StatsAccessItem,
  TagInfo,
  Task,
  TaskFilter,
  TagTitleDisplayMode,
  TagOverviewCard,
  TagOverviewHub,
  TagOverviewSortMode,
  TagOverviewSnapshot,
  TagReference,
  TagAssociation,
  TaskSortMode,
  SidebarNotesSnapshot,
  WorkspaceIndex,
  DeckardStatsSnapshot,
} from '../../core/types';
import {
  findDailyNoteDate,
  isPeriodicNotePath,
  stripTags,
} from '../../core/markdown/parser';
import {
  canAppendTerm,
  getPlainTextTerms,
  getTopLevelTerms,
} from '../../core/query/queryEdit';
import { evaluateQuery } from '../../core/query/queryEvaluator';
import {
  buildTagIntersectionQuery,
  collectQueryTagKeys,
  quoteValue,
  toBuilderGroups,
} from '../../core/query/queryFormat';
import { FIELD_ALIASES, parseQuery } from '../../core/query/queryParser';
import {
  ParsedQuery,
  QueryFacet,
  QuerySuggestion,
  QuerySuggestions,
  QueryViewState,
  QUERY_FIELD_OPERATORS,
  QUERY_FIELDS,
  QUERY_PRIORITY_VALUES,
} from '../../core/query/queryTypes';
import { buildBacklinkIndex, noteTitle } from '../../core/workspace/backlinks';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { renderMarkdown, renderMarkdownInline } from '../webview/rendering';
import { buildSearchFacets } from './searchFacets';

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
  selectedNoteTags: string[] = [],
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  includeNotes = true,
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
  const availableNoteTags = sortTags(
    [...index.tags.values()].filter(
      (tag) => tag.sectionIds.length > 0 || tag.filePaths.length > 0,
    ),
    preferences,
  );
  const normalizedNoteTags = normalizeTaskTags(
    selectedNoteTags,
    availableNoteTags,
  );
  // Every section becomes a note card, so a page that is not showing notes
  // is spared building them.
  const notes = !includeNotes ? [] : sortDashboardNotes(
    [
      ...[...index.sections.values()].map((section) =>
        createDashboardNote(
          section,
          preferences.sectionAccessCounts,
          tagTitleDisplayMode,
        ),
      ),
      ...[...index.files.values()]
        .filter(
          (file) =>
            file.sections.length === 0 &&
            file.frontmatterTags.length > 0,
        )
        .map((file) => createDashboardFileNote(file)),
    ],
    preferences.dashboardNoteSortMode,
  ).filter((note) => matchesNoteFilter(note, normalizedNoteTags));
  const noteSearch = includeNotes
    ? createNoteSearch(index, preferences, notes)
    : undefined;
  const tasks = sortTasks(
    [...index.tasks.values()],
    preferences.taskOrder,
    preferences.taskSortMode,
  )
    .filter((task) => matchesTaskFilter(task, taskFilter, normalizedTaskTags))
    .map((task) => createDashboardTask(task, index.sections));

  return {
    ...(includeNotes ? {} : { notesOmitted: true }),
    ...(noteSearch
      ? {
          noteQuery: noteSearch.query,
          noteQueryTasks: noteSearch.tasks,
          noteQueryTaskCount: noteSearch.taskCount,
        }
      : {}),
    tags,
    entities,
    notes: noteSearch?.notes ?? notes,
    tasks,
    totalSectionCount: index.sections.size,
    totalNoteCount:
      index.sections.size +
      [...index.files.values()].filter(
        (file) =>
          file.sections.length === 0 && file.frontmatterTags.length > 0,
      ).length,
    totalTaskCount: index.tasks.size,
    activeTaskCount: [...index.tasks.values()].filter((task) => !task.completed)
      .length,
    taskFilter,
    taskSortMode: preferences.taskSortMode,
    taskColumns: preferences.dashboardTaskColumns,
    noteColumns: preferences.dashboardNoteColumns,
    tagColumns: preferences.dashboardTagColumns,
    noteSortMode: preferences.dashboardNoteSortMode,
    renderMode: preferences.renderMode,
    tagTitleDisplayMode,
    tagSortMode: preferences.tagSortMode,
    entitySortMode: preferences.entitySortMode,
    availableTaskTags,
    availableNoteTags,
    selectedTaskTags: normalizedTaskTags,
    selectedNoteTags: normalizedNoteTags,
    selectedTag,
    viewState: {
      ...preferences.dashboardViewState,
      taskFilter,
      selectedTaskTags: normalizedTaskTags,
      selectedNoteTags: normalizedNoteTags,
    },
    savedFilters: preferences.savedFilters.flatMap((filter) => {
      if (filter.query) {
        // A saved query keeps its place in the rail even when the tags it
        // names are not in the index yet.
        return [
          {
            id: filter.id,
            name: filter.name,
            tags: resolveQueryTags(index, parseQuery(filter.query)),
            query: filter.query,
          },
        ];
      }
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

/** How many matching tasks the Notes tab lists under a search. */
const NOTE_SEARCH_TASK_LIMIT = 50;

/**
 * Runs the Notes tab's search.
 *
 * A search of plain words is left to the page, which already filters its
 * notes as they are typed and also matches file names and tags, so nothing
 * it showed before is lost. Any other search is answered by the query
 * evaluator, exactly as it is everywhere else. Either way the tasks it
 * matches and the facets that could narrow it are computed here.
 */
function createNoteSearch(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  notes: DashboardNote[],
): {
  query: QueryViewState;
  notes: DashboardNote[];
  tasks: DashboardTask[];
  taskCount: number;
} {
  const text = preferences.dashboardViewState.noteSearchQuery.trim();
  const parsed = parseQuery(text);
  const recent = preferences.recentQueries ?? [];
  if (!parsed.node) {
    return {
      query: createQueryViewState(
        index,
        parsed,
        { notes: notes.length, tasks: 0 },
        true,
        recent,
      ),
      notes,
      tasks: [],
      taskCount: 0,
    };
  }
  const results = evaluateQuery(index, parsed.node);
  const matchedNotes = getPlainTextTerms(parsed.node)
    ? notes
    : (() => {
        const ids = new Set([
          ...results.sections.map((section) => section.id),
          ...results.files.map((file) => `frontmatter:${file.filePath}`),
        ]);
        return notes.filter((note) => ids.has(note.id));
      })();
  const tasks = [...results.tasks].sort(compareSearchTasks);
  return {
    query: createQueryViewState(
      index,
      parsed,
      { notes: matchedNotes.length, tasks: tasks.length },
      true,
      recent,
      { facets: buildSearchFacets(index, results, text) },
    ),
    notes: matchedNotes,
    tasks: tasks
      .slice(0, NOTE_SEARCH_TASK_LIMIT)
      .map((task) => createDashboardTask(task, index.sections)),
    taskCount: tasks.length,
  };
}

/** Open tasks first, then the soonest due, then in title order. */
function compareSearchTasks(left: Task, right: Task): number {
  return (
    Number(left.completed) - Number(right.completed) ||
    (left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.dueAt ?? Number.MAX_SAFE_INTEGER) ||
    left.title.localeCompare(right.title)
  );
}

function createDashboardNote(
  section: Section,
  sectionAccessCounts: Record<string, number>,
  tagTitleDisplayMode: TagTitleDisplayMode,
): DashboardNote {
  return {
    ...createTagOverviewCard(
      section,
      sectionAccessCounts,
      tagTitleDisplayMode,
    ),
    fileName: section.filePath.split('/').pop() ?? section.filePath,
  };
}

function createDashboardFileNote(file: ParsedFile): DashboardNote {
  return {
    ...createFileOverviewCard(file),
    fileName: file.filePath.split('/').pop() ?? file.filePath,
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
        ? {
            label: tag.label,
            detail: `${tag.count} indexed entries`,
            open: { type: 'openTag', tagKey },
          }
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
              // Entities are keyed by the tag that names them.
              open: { type: 'openTag', tagKey: entityKey },
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
              open: {
                type: 'openSource',
                filePath: section.filePath,
                line: section.startLine,
              },
            }
          : undefined;
      },
    ),
    ...findOrphanNotes(index),
  };
}

/** How many of the notes nothing links to the Stats page names. */
const ORPHAN_NOTE_LIMIT = 50;

/**
 * Notes no other note links to, by title. Daily, weekly, and monthly notes are
 * left out, since they are found by their date rather than through links.
 */
function findOrphanNotes(
  index: WorkspaceIndex,
): Pick<DeckardStatsSnapshot, 'orphanNotes' | 'orphanNoteCount'> {
  const backlinks = buildBacklinkIndex(index);
  const orphans = [...index.files.values()]
    .filter(
      (file) =>
        backlinks.toNote(file.filePath).length === 0 &&
        !isPeriodicNotePath(file.filePath) &&
        !findDailyNoteDate(
          file.filePath,
          file.sections
            .filter((section) => section.headingLevel === 1)
            .map((section) => section.heading),
        ),
    )
    .map((file) => ({ filePath: file.filePath, title: noteTitle(file.filePath) }))
    .sort(
      (left, right) =>
        baseCollator.compare(left.title, right.title) ||
        defaultCollator.compare(left.filePath, right.filePath),
    );
  return {
    orphanNoteCount: orphans.length,
    orphanNotes: orphans
      .slice(0, ORPHAN_NOTE_LIMIT)
      .map(({ filePath, title }) => ({
        label: title,
        detail: filePath,
        open: { type: 'openSource' as const, filePath, line: 1 },
      })),
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
  const labelComparison = baseCollator.compare(
    getTagDisplayName(left),
    getTagDisplayName(right),
  );
  return (
    labelComparison ||
    baseCollator.compare(left.label, right.label)
  );
}

function matchesNoteFilter(
  note: DashboardNote,
  selectedNoteTags: string[],
): boolean {
  return (
    selectedNoteTags.length === 0 ||
    selectedNoteTags.some((tagKey) =>
      note.tags.some((tag) => tag.key === tagKey),
    )
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
  refinementText = '',
): TagOverviewSnapshot | undefined {
  const tag = index.tags.get(tagKey);
  if (!tag) {
    return undefined;
  }
  // A search typed after the tags narrows the page's own entries.
  const refinement = parseQuery(refinementText);
  const refined = refinement.node
    ? evaluateQuery(index, refinement.node)
    : undefined;
  const refinedSectionIds = refined
    ? new Set(refined.sections.map((section) => section.id))
    : undefined;
  const refinedTaskIds = refined
    ? new Set(refined.tasks.map((task) => task.id))
    : undefined;
  const refinedFilePaths = refined
    ? new Set(refined.files.map((file) => file.filePath))
    : undefined;
  const effectiveFilterTags = getOverviewFilterTags(
    index,
    tag.key,
    filterTagKey,
    filterTagKeys,
  );
  const savedViewName = findMatchingSavedViewName(preferences.savedFilters, [
    tag.key,
    ...effectiveFilterTags.map((filterTag) => filterTag.key),
  ]);
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
    )
    .filter((file) => refinedFilePaths?.has(file.filePath) ?? true);
  if (refinedSectionIds) {
    sectionCandidates = sectionCandidates.filter((section) =>
      refinedSectionIds.has(section.id),
    );
  }

  // A plain overview leads with the tag's hub note, so the hub's own entries
  // are not listed again below it.
  const hubFile =
    effectiveFilterTags.length === 0 &&
    !refinement.node &&
    tag.hubFilePaths?.length
      ? index.files.get(tag.hubFilePaths[0])
      : undefined;
  const sections = sectionCandidates
    .filter((section) => section.filePath !== hubFile?.filePath)
    .map((section) =>
      createTagOverviewCard(
        section,
        preferences.sectionAccessCounts,
        tagTitleDisplayMode,
      ),
    )
    .concat(
      fileCandidates
        .filter((file) => file.filePath !== hubFile?.filePath)
        .map((file) => createFileOverviewCard(file)),
    )
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
  if (refinedTaskIds) {
    taskCandidates = taskCandidates.filter((task) => refinedTaskIds.has(task.id));
  }
  const taskCounts = {
    all: taskCandidates.length,
    active: taskCandidates.filter((task) => !task.completed).length,
    completed: taskCandidates.filter((task) => task.completed).length,
  };

  const activeTagKeys = [
    tag.key,
    ...effectiveFilterTags.map((filterTag) => filterTag.key),
  ];

  return {
    tag: {
      ...tag,
      sectionIds: [...tag.sectionIds],
      taskIds: [...tag.taskIds],
      filePaths: [...tag.filePaths],
      isFavorite: preferences.favoriteTags.includes(tag.key),
    },
    // The tag chips set this page's scope, and the search box refines it, so
    // the box holds only what was typed after the tags.
    query: createQueryViewState(
      index,
      refinement,
      { notes: sections.length, tasks: taskCandidates.length },
      false,
      preferences.recentQueries ?? [],
      {
        scope: buildTagIntersectionQuery(activeTagKeys),
        facets: buildSearchFacets(
          index,
          {
            sections: sectionCandidates,
            tasks: taskCandidates,
            files: fileCandidates,
          },
          refinementText,
          // The page already lists the tags associated with its own.
          { includeTags: false },
        ),
      },
    ),
    entity: index.entities.get(tagKey),
    ...(hubFile
      ? {
          hub: createTagOverviewHub(
            hubFile,
            tag.hubFilePaths?.slice(1) ?? [],
          ),
        }
      : {}),
    filterTag: effectiveFilterTags[0],
    filterTags: effectiveFilterTags,
    savedViewName,
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

function findMatchingSavedViewName(
  savedFilters: PersistedPreferences['savedFilters'],
  activeTagKeys: readonly string[],
): string | undefined {
  const normalizedActiveTagKeys = [...new Set(activeTagKeys)].sort();
  return savedFilters.find((filter) => {
    const normalizedFilterTagKeys = [...new Set(filter.tagKeys)].sort();
    return (
      normalizedFilterTagKeys.length === normalizedActiveTagKeys.length &&
      normalizedFilterTagKeys.every(
        (tagKey, index) => tagKey === normalizedActiveTagKeys[index],
      )
    );
  })?.name;
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

export function findTagAssociation(
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
): SidebarNotesSnapshot | undefined {
  const query = snapshot.query?.isAdvanced ? snapshot.query : undefined;
  const queryTags = query?.tags ?? [];
  // A query drives the page whenever one is active, so the sidebar follows the
  // query rather than the tag the page happened to be opened on. A query that
  // names exactly one tag still gets that tag's chip and associations.
  const focusTag = query
    ? queryTags.length === 1
      ? { ...queryTags[0] }
      : undefined
    : snapshot.tag
      ? { key: snapshot.tag.key, label: snapshot.tag.label }
      : undefined;
  if (!focusTag && !query) {
    return undefined;
  }

  const matchedTags = focusTag ? [focusTag] : queryTags.map((tag) => ({ ...tag }));
  const notes = snapshot.sections.map((section) => ({
    filePath: section.filePath,
    title: section.heading,
    fileName: getFileName(section.filePath) ?? section.filePath,
    sourceLine: section.startLine,
    headingPath: [stripTags(section.heading)],
    titleTags: section.titleTags,
    matchedTags,
    matchCount: Math.max(1, matchedTags.length),
    totalTagCount: Math.max(1, matchedTags.length),
    overlap: 1,
    relevanceScore: 100,
  }));

  const filterTags = query
    ? focusTag
      ? []
      : queryTags.map((tag) => ({ ...tag }))
    : snapshot.filterTags.map((tag) => ({ ...tag }));

  return {
    activeTags: [],
    notes,
    tagOverview: focusTag,
    tagOverviewQuery: query?.text,
    tagOverviewFilter: query
      ? undefined
      : snapshot.filterTag
        ? { ...snapshot.filterTag }
        : undefined,
    tagOverviewFilters: filterTags,
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
 * Sorts dashboard note entries without mutating the index projection.
 */
export function sortDashboardNotes(
  notes: DashboardNote[],
  sortMode: TagOverviewSortMode,
): DashboardNote[] {
  return [...notes].sort((left, right) =>
    compareTagOverviewCards(left, right, sortMode),
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

/**
 * Lists a section's heading and its ancestors, outermost first, without tags.
 */
export function getHeadingPath(
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

/**
 * Adds rendered task text and source context without changing the domain task.
 */
function createDashboardTask(
  task: Task,
  sections: Map<string, Section>,
): DashboardTask {
  return {
    task,
    renderedTitle: renderTaskTitle(task),
    titleTags: getTitleTags(task.tags, task.tagLabels, task.title),
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
    renderedHtml: renderSectionBody(section),
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

/**
 * The note that describes a tag, shown above the tag's overview entries.
 */
function createTagOverviewHub(
  file: ParsedFile,
  otherFilePaths: string[],
): TagOverviewHub {
  const rawContent = getFrontmatterBody(file.content);
  return {
    filePath: file.filePath,
    fileName: getFileName(file.filePath) ?? file.filePath,
    rawContent,
    renderedHtml: renderMarkdown(rawContent),
    properties: (file.hub?.properties ?? []).map((property) => ({
      name: property.name,
      values: property.values.map((value) => ({ ...value })),
    })),
    otherFilePaths,
  };
}

export function normalizeTagTitleDisplayMode(
  value: unknown,
): TagTitleDisplayMode {
  return value === 'separate' ? 'separate' : 'inline';
}

export function getNoteTitle(
  heading: string,
  tagTitleDisplayMode: TagTitleDisplayMode,
): string {
  return tagTitleDisplayMode === 'separate' ? stripTags(heading) : heading;
}

export function getTitleTags(
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

export function getInlineSource(section: Section): string {
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
/**
 * `localeCompare` with options builds a collator on every call, which made
 * sorting thousands of cards the slowest part of the Dashboard. These compare
 * in exactly the same order as `localeCompare` with and without
 * `{ sensitivity: 'base' }`.
 */
const baseCollator = new Intl.Collator(undefined, { sensitivity: 'base' });
const defaultCollator = new Intl.Collator();

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
    baseCollator.compare(left.heading, right.heading) ||
    defaultCollator.compare(left.filePath, right.filePath) ||
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
/**
 * Sanitized HTML is the costliest part of a card, and an entry's text never
 * changes after it is parsed, so each body and title is rendered once. A
 * reparsed note brings new entries, and the old ones are let go with them.
 */
const renderedSectionBodies = new WeakMap<Section, string>();
const renderedTaskTitles = new WeakMap<Task, string>();

function renderSectionBody(section: Section): string {
  let html = renderedSectionBodies.get(section);
  if (html === undefined) {
    html = renderMarkdown(getSectionBody(section.rawContent));
    renderedSectionBodies.set(section, html);
  }
  return html;
}

function renderTaskTitle(task: Task): string {
  let html = renderedTaskTitles.get(task);
  if (html === undefined) {
    html = renderMarkdownInline(task.title);
    renderedTaskTitles.set(task, html);
  }
  return html;
}

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
export function getFileName(filePath: string | undefined): string | undefined {
  return filePath?.split('/').pop() ?? filePath;
}

/**
 * Projects an overview driven by a Deckard query rather than a single tag.
 *
 * Results come from the query evaluator, but every card, task, and control is
 * built with the same helpers a tag overview uses, so an advanced view is the
 * same page with a wider filter rather than a second, divergent surface.
 */
export function createQueryOverviewSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  queryText: string,
  taskFilter: TaskFilter = 'active',
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  enableHeadingTagRelationships = true,
  focusTagKey?: string,
): TagOverviewSnapshot {
  const parsed = parseQuery(queryText);
  const results = evaluateQuery(index, parsed.node);

  const sections = results.sections
    .map((section) =>
      createTagOverviewCard(
        section,
        preferences.sectionAccessCounts,
        tagTitleDisplayMode,
      ),
    )
    .concat(results.files.map((file) => createFileOverviewCard(file)))
    .sort((left, right) =>
      compareTagOverviewCards(left, right, preferences.tagOverviewSortMode),
    );

  const taskCounts = {
    all: results.tasks.length,
    active: results.tasks.filter((task) => !task.completed).length,
    completed: results.tasks.filter((task) => task.completed).length,
  };

  const queryTags = resolveQueryTags(index, parsed);
  const focusTag = focusTagKey ? index.tags.get(focusTagKey) : undefined;

  return {
    tag: focusTag
      ? {
          ...focusTag,
          sectionIds: [...focusTag.sectionIds],
          taskIds: [...focusTag.taskIds],
          filePaths: [...focusTag.filePaths],
          isFavorite: preferences.favoriteTags.includes(focusTag.key),
        }
      : undefined,
    // Whatever its shape, this page is driven by the query rather than by the
    // panel's focus tag, so it must not present that tag's chips.
    query: createQueryViewState(
      index,
      parsed,
      { notes: sections.length, tasks: results.tasks.length },
      true,
      preferences.recentQueries ?? [],
      {
        facets: buildSearchFacets(index, results, queryText, {
          // A query naming one tag keeps that tag's association suggestions.
          includeTags: queryTags.length !== 1,
        }),
      },
    ),
    entity: focusTag ? index.entities.get(focusTag.key) : undefined,
    filterTags: [],
    savedViewName: findMatchingSavedQueryName(preferences.savedFilters, parsed),
    // Association suggestions describe one tag's neighbourhood, which a
    // multi-branch query does not have; they return with the tag chips.
    associatedTags:
      enableHeadingTagRelationships && queryTags.length === 1
        ? cloneTagAssociations(index.tagAssociations?.get(queryTags[0].key) ?? [])
        : [],
    sharedAssociatedTags:
      enableHeadingTagRelationships && queryTags.length > 1
        ? getSharedTagAssociations(
            index,
            queryTags.map((tag) => tag.key),
          )
        : [],
    sections,
    tasks: results.tasks
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
 * Builds everything the query bar and its builder need from one parse.
 */
export function createQueryViewState(
  index: WorkspaceIndex,
  parsed: ParsedQuery,
  matchCounts: { notes: number; tasks: number },
  isAdvanced: boolean,
  recentQueries: readonly string[] = [],
  extras: { scope?: string; facets?: QueryFacet[] } = {},
): QueryViewState {
  const groups = toBuilderGroups(parsed.node);
  return {
    text: parsed.text,
    ...(extras.scope !== undefined ? { scope: extras.scope } : {}),
    terms: getTopLevelTerms(parsed),
    canAppend: canAppendTerm(parsed),
    facets: extras.facets ?? [],
    isAdvanced,
    isBuildable: groups.every((group) =>
      group.rows.every((row) => row.supported),
    ),
    diagnostics: parsed.diagnostics,
    groups,
    tags: resolveQueryTags(index, parsed),
    suggestions: createQuerySuggestions(index, recentQueries),
    matchCounts,
  };
}

/**
 * Resolves the tags a query names against the index so chips and titles can
 * show a tag's real label rather than the spelling that was typed.
 */
function resolveQueryTags(
  index: WorkspaceIndex,
  parsed: ParsedQuery,
): TagReference[] {
  const seen = new Set<string>();
  return collectQueryTagKeys(parsed.node)
    .map((tagKey) => resolveIndexedTagKey(index.tags, tagKey))
    .flatMap((tagKey) => {
      if (!tagKey || seen.has(tagKey)) {
        return [];
      }
      seen.add(tagKey);
      const tag = index.tags.get(tagKey);
      return tag ? [{ key: tag.key, label: tag.label }] : [];
    });
}

/** Upper bound on tag completions sent across the webview boundary. */
const QUERY_TAG_SUGGESTION_LIMIT = 400;
/** Upper bound on file and path completions. */
const QUERY_PATH_SUGGESTION_LIMIT = 200;

/**
 * Builds the completions both editing surfaces use.
 *
 * Values are grouped by field rather than pre-joined to one, so the query bar
 * can complete a value once it knows which field the caret is in, and a
 * builder row can complete its own value field with the same list.
 */
export function createQuerySuggestions(
  index: WorkspaceIndex,
  recentQueries: readonly string[] = [],
): QuerySuggestions {
  const fields: QuerySuggestion[] = QUERY_FIELDS.map((field) => ({
    value: field,
    label: field,
    detail: describeQueryField(field),
  }));

  const tags: QuerySuggestion[] = [...index.tags.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, QUERY_TAG_SUGGESTION_LIMIT)
    .map((tag) => ({
      value: tag.key,
      label: tag.label,
      detail: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
    }));

  const kinds: QuerySuggestion[] = [
    ...new Set(
      [...index.entities.values()].map((entity) => String(entity.kind)),
    ),
  ]
    .sort((left, right) => left.localeCompare(right))
    .map((kind) => ({ value: kind, label: kind }));

  const filePaths = [...index.files.keys()].sort();
  const paths: QuerySuggestion[] = filePaths
    .slice(0, QUERY_PATH_SUGGESTION_LIMIT)
    .map((filePath) => ({ value: filePath, label: filePath }));
  const files: QuerySuggestion[] = [
    ...new Set(filePaths.map((filePath) => getFileName(filePath) ?? filePath)),
  ]
    .slice(0, QUERY_PATH_SUGGESTION_LIMIT)
    .map((fileName) => ({ value: fileName, label: fileName }));

  const dates: QuerySuggestion[] = [
    { value: 'today', label: 'today' },
    { value: 'yesterday', label: 'yesterday' },
    { value: '7d', label: '7d', detail: 'the last seven days' },
    { value: '30d', label: '30d', detail: 'the last thirty days' },
    { value: '90d', label: '90d', detail: 'the last ninety days' },
  ];
  const noDate: QuerySuggestion = {
    value: 'none',
    label: 'none',
    detail: 'no date written',
  };
  const taskDates: QuerySuggestion[] = [
    { value: 'today', label: 'today' },
    { value: 'tomorrow', label: 'tomorrow' },
    { value: '7d', label: '7d', detail: 'today and the next six days' },
    { value: '30d', label: '30d', detail: 'the next thirty days' },
    noDate,
  ];
  const priorities: QuerySuggestion[] = QUERY_PRIORITY_VALUES.map((value) => ({
    value,
    label: value,
  }));
  const folders: QuerySuggestion[] = collectFolders(filePaths)
    .slice(0, QUERY_PATH_SUGGESTION_LIMIT)
    .map((folder) => ({ value: folder, label: folder }));

  return {
    fields,
    aliases: { ...FIELD_ALIASES },
    operators: { ...QUERY_FIELD_OPERATORS },
    values: {
      tag: tags,
      kind: kinds,
      is: IS_SUGGESTIONS.map((item) => ({
        value: item.value.slice('is:'.length),
        label: item.value.slice('is:'.length),
        detail: item.detail,
      })),
      task: [
        { value: 'open', label: 'open' },
        { value: 'done', label: 'done' },
        { value: 'any', label: 'any' },
      ],
      has: HAS_SUGGESTIONS.map((value) => ({ value, label: value })),
      file: files,
      path: paths,
      in: folders,
      due: taskDates,
      scheduled: taskDates,
      start: taskDates,
      done: [...dates, noDate],
      priority: priorities,
      created: dates,
      updated: dates,
    },
    conditions: [
      ...IS_SUGGESTIONS.map((item) => ({ ...item, label: item.value })),
      ...HAS_SUGGESTIONS.flatMap((value) => [
        { value: `has:${value}`, label: `has:${value}`, detail: `Tasks with a ${value === 'priority' ? 'priority' : `${value} date`}` },
        { value: `no:${value}`, label: `no:${value}`, detail: `Tasks without a ${value === 'priority' ? 'priority' : `${value} date`}` },
      ]),
      { value: 'priority >= high', label: 'priority >= high', detail: 'High or highest priority tasks' },
      { value: 'updated >= 7d', label: 'updated >= 7d', detail: 'Updated in the last seven days' },
      { value: 'created = today', label: 'created = today', detail: 'Created today' },
      ...folders.slice(0, 20).map((folder) => ({
        value: `in:${quoteValue(folder.value)}`,
        label: `in:${folder.value}`,
        detail: 'Notes in this folder',
      })),
    ],
    recent: recentQueries.map((query) => ({
      value: query,
      label: query,
      detail: 'Recent search',
    })),
  };
}

/** Whole `is:` conditions, with what each finds. */
const IS_SUGGESTIONS: QuerySuggestion[] = [
  { value: 'is:open', label: 'is:open', detail: 'Open tasks' },
  { value: 'is:done', label: 'is:done', detail: 'Completed tasks' },
  { value: 'is:overdue', label: 'is:overdue', detail: 'Open tasks past their due date' },
  { value: 'is:due', label: 'is:due', detail: 'Open tasks due within seven days, overdue included' },
  { value: 'is:task', label: 'is:task', detail: 'Every task' },
  { value: 'is:note', label: 'is:note', detail: 'Note sections only, no tasks' },
];

const HAS_SUGGESTIONS = ['due', 'scheduled', 'start', 'done', 'priority'];

/**
 * Every folder that holds a note, parents before their children.
 */
function collectFolders(filePaths: readonly string[]): string[] {
  const folders = new Set<string>();
  filePaths.forEach((filePath) => {
    const parts = filePath.split('/').slice(0, -1);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join('/')));
  });
  return [...folders].sort((left, right) => left.localeCompare(right));
}

/**
 * One-line help shown beside each field in the query bar and the builder.
 */
export function describeQueryField(field: string): string {
  switch (field) {
    case 'tag':
      return 'A tag, including tags inherited from a parent heading';
    case 'text':
      return 'Words in the note, task, or file body';
    case 'is':
      return 'is:open, is:done, is:overdue, is:due, is:task, or is:note';
    case 'has':
      return 'has:due or no:due, and the same for scheduled, start, done, and priority';
    case 'in':
      return 'A folder and everything in it, as in in:notes/projects';
    case 'task':
      return 'open, done, or any';
    case 'due':
      return 'A task due date (📅): 2026-09-13, today, 7d ahead, or none';
    case 'scheduled':
      return 'A task scheduled date (⏳): 2026-09-13, today, 7d ahead, or none';
    case 'start':
      return 'A task start date (🛫): 2026-09-13, today, 7d ahead, or none';
    case 'done':
      return 'A task completion date (✅): 2026-09-13, today, 7d back, or none';
    case 'priority':
      return 'highest, high, medium, none, low, or lowest';
    case 'kind':
      return 'An entity namespace such as project or person';
    case 'file':
      return 'A file name, with * as a wildcard';
    case 'path':
      return 'A workspace-relative path, with * as a wildcard';
    case 'created':
      return 'A date such as 2026-09-13, a window such as 30d, or today';
    case 'updated':
      return 'A date such as 2026-09-13, a window such as 30d, or today';
    default:
      return '';
  }
}

/**
 * Finds the saved view whose query matches the one on screen.
 */
function findMatchingSavedQueryName(
  savedFilters: PersistedPreferences['savedFilters'],
  parsed: ParsedQuery,
): string | undefined {
  const normalized = parsed.text.trim();
  if (!normalized) {
    return undefined;
  }
  return savedFilters.find((filter) => filter.query?.trim() === normalized)
    ?.name;
}
