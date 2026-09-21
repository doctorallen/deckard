import {
  DashboardSavedFilter,
  DashboardSnapshot,
  DashboardNote,
  DashboardTask,
  Entity,
  ParsedFile,
  PersistedPreferences,
  ResultPaging,
  SEARCH_PAGE_SIZES,
  SearchPageSnapshot,
  Section,
  StatsAccessItem,
  TagInfo,
  Task,
  TaskFilter,
  TagTitleDisplayMode,
  TagOverviewCard,
  TagOverviewHub,
  TagOverviewSortMode,
  TagReference,
  TagAssociation,
  TaskSortMode,
  WorkspaceIndex,
  DeckardStatsSnapshot,
} from '../../core/types';
import {
  findDailyNoteDate,
  isPeriodicNotePath,
  isPersonTag,
  stripTags,
} from '../../core/markdown/parser';
import {
  canAppendTerm,
  correctQueryText,
  getPlainTextTerms,
  getTextWords,
  getTopLevelTerms,
} from '../../core/query/queryEdit';
import {
  countTagMatches,
  evaluateQuery,
} from '../../core/query/queryEvaluator';
import {
  collectQueryTagKeys,
  getQueryTagIntersection,
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
import { buildSearchFacets, SearchFacetValue } from './searchFacets';
import { createPinForLine, pinKey } from './pinnedNotes';
import { findTagMergeCandidates } from './tagHygiene';

/**
 * Projects one consistent dashboard model from the index and UI-only state.
 */
export function createDashboardSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  selectedTag?: string,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
): DashboardSnapshot {
  return {
    tags: sortTags(index.tags.values(), preferences),
    entities: sortEntities(index.entities.values(), preferences),
    totalSectionCount: index.sections.size,
    totalNoteCount: index.sections.size + listFrontmatterOnlyFiles(index).length,
    totalTaskCount: index.tasks.size,
    tagColumns: preferences.dashboardTagColumns,
    tagTitleDisplayMode,
    tagSortMode: preferences.tagSortMode,
    entitySortMode: preferences.entitySortMode,
    selectedTag,
    viewState: { ...preferences.dashboardViewState },
    savedFilters: createDashboardSavedFilters(index, preferences),
    widgetConfig: preferences.dashboardWidgets.map((widget) => ({ ...widget })),
  };
}

/**
 * The saved views, with their tags resolved against the index. A saved query
 * keeps its place even when the tags it names are not in the index yet; a
 * saved tag set needs two tags that still exist.
 */
export function createDashboardSavedFilters(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
): DashboardSavedFilter[] {
  return preferences.savedFilters.flatMap((filter) => {
    if (filter.query) {
      return [
        {
          id: filter.id,
          name: filter.name,
          tags: resolveQueryTags(index, parseQuery(filter.query)),
          query: filter.query,
          ...(filter.page ? { page: filter.page } : {}),
        },
      ];
    }
    const tags = filter.tagKeys
      .map((tagKey) => index.tags.get(tagKey))
      .filter((tag): tag is TagInfo => tag !== undefined)
      .map((tag) => ({ key: tag.key, label: tag.label }));
    return tags.length >= 2 ? [{ id: filter.id, name: filter.name, tags }] : [];
  });
}

/** Files known only by their front matter tags, which list as one note each. */
function listFrontmatterOnlyFiles(index: WorkspaceIndex): ParsedFile[] {
  return [...index.files.values()].filter(
    (file) => file.sections.length === 0 && file.frontmatterTags.length > 0,
  );
}

/**
 * The search a saved view runs: its query, or its tags joined by AND.
 */
export function getSavedFilterQuery(filter: {
  tagKeys?: readonly string[];
  tags?: readonly TagReference[];
  query?: string;
}): string {
  if (filter.query) {
    return filter.query;
  }
  const tagKeys = filter.tagKeys ?? (filter.tags ?? []).map((tag) => tag.key);
  return tagKeys.join(' AND ');
}

/** Options for a search page's projection. */
export interface SearchPageOptions {
  /** The search the page was opened with, which Clear returns to. */
  originQuery?: string;
  taskFilter?: TaskFilter;
  tagTitleDisplayMode?: TagTitleDisplayMode;
  /** Whether tags are related by their headings as well as written together. */
  enableHeadingTagRelationships?: boolean;
  /**
   * The closest word the notes contain for each word they do not, from the
   * full-text cache. Without it a search that finds nothing simply says so.
   */
  suggestWords?: (words: readonly string[]) => ReadonlyMap<string, string>;
  /**
   * Words the reader has typed into the search box and not yet committed.
   * They narrow the whole search, not the page of it being shown.
   */
  previewWords?: readonly string[];
  /**
   * False for a caller that wants the whole result rather than a page of it,
   * such as Home's widgets. A search page is paged by the size the reader
   * chose, which is kept in their preferences.
   */
  paged?: boolean;
  /** Which page of each list to carry, 1-based and clamped. */
  notePage?: number;
  taskPage?: number;
  now?: number;
}

/**
 * Projects a search page: the notes and tasks one search finds.
 *
 * An empty search lists every note. A search of plain words matches each
 * note's title, file name, body, and tags, the same places the page matches
 * words while they are typed, so a file name still finds its note and the
 * counts agree with what is shown. Any other search is answered by the query
 * evaluator, exactly as it is everywhere else, which includes the tags a note
 * inherits from the headings above it.
 *
 * A search of exactly one tag is that tag's overview: it carries the tag, its
 * entity, and the hub note that describes it, and the hub's own entries are
 * not listed again below it. A search of only tags joined by AND is refined
 * by the tags associated with all of them, ranked by how strongly; any other
 * search is refined by the tags its results carry, ranked by how many.
 */
export function createSearchPageSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  queryText: string,
  options: SearchPageOptions = {},
): SearchPageSnapshot {
  const text = queryText.trim();
  const parsed = parseQuery(text);
  // The words being typed narrow the search before they are committed to the
  // box. They are run as part of the search rather than matched against what
  // is on screen, so a page of thirty is not what a reader is searching, and
  // so what the preview finds is exactly what pressing Enter will find.
  const preview = (options.previewWords ?? [])
    .map((word) => word.trim())
    .filter(Boolean);
  const drafted = preview.length > 0 ? parseQuery([text, ...preview].join(' ')) : parsed;
  const tagTitleDisplayMode = options.tagTitleDisplayMode ?? 'inline';
  const taskFilter = options.taskFilter ?? 'active';
  const tagKeys = resolveQueryTagIntersection(index, parsed);
  const focusTag =
    tagKeys?.length === 1 ? index.tags.get(tagKeys[0]) : undefined;
  const hubFile = focusTag?.hubFilePaths?.length
    ? index.files.get(focusTag.hubFilePaths[0])
    : undefined;

  const results = drafted.node
    ? evaluateQuery(index, drafted.node)
    : {
        sections: [...index.sections.values()],
        tasks: [...index.tasks.values()],
        files: listFrontmatterOnlyFiles(index),
      };
  // Which entries are pinned, so a card's menu offers pinning or unpinning
  // rather than one word that is wrong half the time.
  const pinnedKeys = new Set(
    (preferences.pinnedNotes ?? []).map((pin) => pinKey(pin)),
  );
  const cardFor = (section: Section): TagOverviewCard =>
    createTagOverviewCard(
      section,
      preferences.sectionAccessCounts,
      tagTitleDisplayMode,
      pinnedKeys.size > 0 &&
        pinnedKeys.has(
          pinKey(
            createPinForLine(index, section.filePath, section.startLine) ?? {
              filePath: section.filePath,
            },
          ),
        ),
    );
  const plainTerms = getPlainTextTerms(drafted.node);
  const cards = plainTerms
    ? [
        ...[...index.sections.values()].map(cardFor),
        ...listFrontmatterOnlyFiles(index).map(createFileOverviewCard),
      ].filter((card) => matchesNoteWords(card, plainTerms))
    : [
        ...results.sections
          .filter((section) => section.filePath !== hubFile?.filePath)
          .map(cardFor),
        ...results.files
          .filter((file) => file.filePath !== hubFile?.filePath)
          .map(createFileOverviewCard),
      ];
  const ranked = cards.sort((left, right) =>
    compareTagOverviewCards(left, right, preferences.tagOverviewSortMode),
  );
  const pageSize = options.paged === false ? undefined : preferences.searchPageSize;
  const notePaging = createPaging(ranked.length, pageSize, options.notePage);
  const sections = takePage(ranked, notePaging);
  const tasks = sortTasks(
    [...results.tasks],
    preferences.taskOrder,
    preferences.taskSortMode,
  );
  const shownTasks = tasks
    .filter((task) => matchesTaskFilter(task, taskFilter))
    .map((task) => createDashboardTask(task, index.sections));
  const taskPaging = createPaging(shownTasks.length, pageSize, options.taskPage);
  const related =
    tagKeys && (options.enableHeadingTagRelationships ?? true)
      ? createRelatedFacetValues(index, tagKeys, results)
      : undefined;
  // Only a search that found nothing is worth correcting: results answer the
  // search as it was typed, and offering a different one beside them would
  // argue with what the reader can already see.
  const corrected =
    ranked.length === 0 && tasks.length === 0
      ? suggestSearch(text, parsed, options.suggestWords)
      : undefined;
  // A word the notes contain somewhere may still sit in no note that
  // satisfies the rest of the search, so the correction is run before it is
  // offered. A second dead end would help nobody.
  const suggestion =
    corrected !== undefined && findsSomething(index, corrected, cardFor)
      ? corrected
      : undefined;

  return {
    ...(focusTag
      ? {
          tag: {
            ...focusTag,
            sectionIds: [...focusTag.sectionIds],
            taskIds: [...focusTag.taskIds],
            filePaths: [...focusTag.filePaths],
            isFavorite: preferences.favoriteTags.includes(focusTag.key),
          },
          entity: index.entities.get(focusTag.key),
          ...(hubFile
            ? {
                hub: createTagOverviewHub(
                  hubFile,
                  focusTag.hubFilePaths?.slice(1) ?? [],
                ),
              }
            : {}),
        }
      : {}),
    query: createQueryViewState(
      index,
      parsed,
      { notes: ranked.length, tasks: tasks.length },
      true,
      preferences.recentQueries ?? [],
      {
        facets: parsed.node
          ? buildSearchFacets(index, results, text, {
              related,
              now: options.now,
            })
          : [],
      },
    ),
    ...(suggestion ? { suggestion } : {}),
    ...(preview.length > 0 ? { draftWords: preview } : {}),
    originQuery: options.originQuery?.trim() ?? '',
    savedViewName:
      tagKeys && tagKeys.length >= 2
        ? findMatchingSavedViewName(preferences.savedFilters, tagKeys) ??
          findMatchingSavedQueryName(preferences.savedFilters, parsed)
        : findMatchingSavedQueryName(preferences.savedFilters, parsed),
    sections,
    notePaging,
    tasks: takePage(shownTasks, taskPaging),
    taskPaging,
    taskCounts: {
      all: tasks.length,
      active: tasks.filter((task) => !task.completed).length,
      completed: tasks.filter((task) => task.completed).length,
    },
    taskFilter,
    pageSizes: SEARCH_PAGE_SIZES,
    renderMode: preferences.renderMode,
    sortMode: preferences.tagOverviewSortMode,
    layout: preferences.tagOverviewLayout,
    noteColumns: preferences.dashboardNoteColumns,
    taskColumns: preferences.dashboardTaskColumns,
    tagTitleDisplayMode,
  };
}

/**
 * The canonical keys of a search made only of tags joined by AND, each of
 * which is in the index, or undefined for any other search.
 */
export function resolveQueryTagIntersection(
  index: WorkspaceIndex,
  parsed: ParsedQuery,
): string[] | undefined {
  const intersection = getQueryTagIntersection(parsed.node);
  if (!intersection || intersection.length === 0) {
    return undefined;
  }
  const tagKeys: string[] = [];
  for (const tagKey of intersection) {
    const canonical = resolveIndexedTagKey(index.tags, tagKey);
    if (!canonical) {
      return undefined;
    }
    if (!tagKeys.includes(canonical)) {
      tagKeys.push(canonical);
    }
  }
  return tagKeys;
}

/**
 * The tags associated with every one of a search's tags, as Refine offers
 * them: each keeps as many results as carry it, and its strength is its
 * association relative to the strongest listed.
 */
function createRelatedFacetValues(
  index: WorkspaceIndex,
  tagKeys: readonly string[],
  results: { sections: Section[]; tasks: Task[]; files: ParsedFile[] },
): SearchFacetValue[] {
  const associations = (
    tagKeys.length === 1
      ? index.tagAssociations?.get(tagKeys[0]) ?? []
      : getSharedTagAssociations(index, [...tagKeys])
  ).filter((association) => !tagKeys.includes(association.associatedTag.key));
  const strongest = Math.max(
    0,
    ...associations.map((association) => association.normalizedWeight),
  );
  return associations
    .map((association) => {
      const tagKey = association.associatedTag.key;
      return {
        label: index.tags.get(tagKey)?.label ?? association.associatedTag.label,
        clause: tagKey,
        count:
          results.sections.filter((section) =>
            sectionIncludesTag(index, section, tagKey),
          ).length +
          results.tasks.filter((task) => taskIncludesTag(index, task, tagKey))
            .length +
          results.files.filter((file) => fileIncludesTag(index, file, tagKey))
            .length,
        strength:
          strongest > 0 ? association.normalizedWeight / strongest : 0,
        detail: describeAssociation(association),
      };
    })
    .sort(
      (left, right) =>
        right.strength - left.strength ||
        right.count - left.count ||
        baseCollator.compare(left.label, right.label),
    );
}

/**
 * Why two tags are related, such as "Written together 16 times; heading
 * context 3 times".
 */
export function describeAssociation(association: TagAssociation): string {
  const times = (count: number): string =>
    `${count} time${count === 1 ? '' : 's'}`;
  const heading = association.headingRelationshipCount
    ? `heading context ${times(association.headingRelationshipCount)}`
    : '';
  if (!association.coOccurrenceCount) {
    return heading ? heading.charAt(0).toUpperCase() + heading.slice(1) : '';
  }
  return `Written together ${times(association.coOccurrenceCount)}${heading ? `; ${heading}` : ''}`;
}

/**
 * Whether a note card has every word in its title, file name, body, or tags.
 */
function matchesNoteWords(card: TagOverviewCard, words: readonly string[]): boolean {
  const text = [
    card.heading,
    getFileName(card.filePath) ?? card.filePath,
    card.rawContent,
    ...card.tags.map((tag) => tag.label),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word.toLowerCase()));
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
    ...findLookalikeTags(index),
  };
}

/** How many of the tags that look alike the Stats page names. */
const LOOKALIKE_TAG_LIMIT = 12;

/** Tags that look like two spellings of one idea, the clearest pairs first. */
function findLookalikeTags(
  index: WorkspaceIndex,
): Pick<DeckardStatsSnapshot, 'lookalikeTags' | 'lookalikeTagCount'> {
  const { candidates, total } = findTagMergeCandidates(
    index,
    LOOKALIKE_TAG_LIMIT,
  );
  return { lookalikeTags: candidates, lookalikeTagCount: total };
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
 * Merges a requested order with current IDs so a stale drag result cannot lose
 * entries created or removed since the webview rendered its list.
 */
export function mergeOrder(
  requested: string[],
  available: Iterable<string>,
): string[] {
  const availableIds = [...available];
  const availableSet = new Set(availableIds);
  const requestedIds = requested.filter((id) => availableSet.has(id));
  const requestedSet = new Set(requestedIds);
  return [
    ...requestedIds,
    ...availableIds.filter((id) => !requestedSet.has(id)),
  ];
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
export function createDashboardTask(
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
  pinned = false,
): TagOverviewCard {
  return {
    id: section.id,
    filePath: section.filePath,
    heading: getNoteTitle(section.heading, tagTitleDisplayMode),
    ...(pinned ? { pinned } : {}),
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

/**
 * Works out which page of a list is being shown.
 *
 * A page number is clamped rather than refused, because the results move
 * under it: a note saved elsewhere can shorten a search while its last page
 * is open, and the reader should find the last page there rather than an
 * empty one. Without a page size there is one page holding everything.
 */
function createPaging(
  total: number,
  size: number | undefined,
  page: number | undefined,
): ResultPaging {
  if (size === undefined || size <= 0) {
    return { page: 1, size: Math.max(total, 1), pageCount: 1, total };
  }
  const pageCount = Math.max(Math.ceil(total / size), 1);
  return {
    page: Math.min(Math.max(Math.trunc(page ?? 1), 1), pageCount),
    size,
    pageCount,
    total,
  };
}

/** The slice of a list that one page shows. */
function takePage<T>(entries: T[], paging: ResultPaging): T[] {
  if (paging.pageCount === 1 && paging.page === 1 && entries.length <= paging.size) {
    return entries;
  }
  const start = (paging.page - 1) * paging.size;
  return entries.slice(start, start + paging.size);
}

/**
 * Whether a search finds any note or task, counted the same two ways the
 * page itself counts: a search of plain words matches each note's title,
 * file name, body, and tags, and any other search is answered by the query
 * evaluator.
 */
function findsSomething(
  index: WorkspaceIndex,
  text: string,
  cardFor: (section: Section) => TagOverviewCard,
): boolean {
  const parsed = parseQuery(text);
  if (!parsed.node) {
    return false;
  }
  const results = evaluateQuery(index, parsed.node);
  if (results.tasks.length > 0) {
    return true;
  }
  const plainTerms = getPlainTextTerms(parsed.node);
  if (!plainTerms) {
    return results.sections.length > 0 || results.files.length > 0;
  }
  return (
    [...index.sections.values()].some((section) =>
      matchesNoteWords(cardFor(section), plainTerms),
    ) ||
    listFrontmatterOnlyFiles(index).some((file) =>
      matchesNoteWords(createFileOverviewCard(file), plainTerms),
    )
  );
}

/**
 * Writes a search again with its misspellings corrected, or nothing when
 * there is nothing to correct.
 */
function suggestSearch(
  text: string,
  parsed: ParsedQuery,
  suggestWords: SearchPageOptions['suggestWords'],
): string | undefined {
  if (!suggestWords || !parsed.node) {
    return undefined;
  }
  const words = getTextWords(parsed.node);
  if (words.length === 0) {
    return undefined;
  }
  const corrections = suggestWords(words);
  if (corrections.size === 0) {
    return undefined;
  }
  return correctQueryText(text, parsed.node, (word) => corrections.get(word));
}

export function getInlineSource(section: Section): string {
  return section.isInline && section.rawContent
    ? section.rawContent
    : section.heading;
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
 * Builds everything the query bar and its builder need from one parse.
 */
export function createQueryViewState(
  index: WorkspaceIndex,
  parsed: ParsedQuery,
  matchCounts: { notes: number; tasks: number },
  isAdvanced: boolean,
  recentQueries: readonly string[] = [],
  extras: { facets?: QueryFacet[]; pending?: string } = {},
): QueryViewState {
  const groups = toBuilderGroups(parsed.node);
  const pending = extras.pending?.trim();
  return {
    text: parsed.text,
    ...(pending ? { pending } : {}),
    terms: getTopLevelTerms(parsed),
    canAppend: canAppendTerm(parsed),
    facets: extras.facets ?? [],
    isAdvanced,
    isBuildable: groups.every((group) =>
      group.rows.every((row) => row.supported),
    ),
    diagnostics: pending ? parseQuery(pending).diagnostics : parsed.diagnostics,
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
 * What searching for a tag finds, such as "2 notes · 3 tasks", written the
 * way a search's own result count is, so the two agree.
 */
export function describeTagMatches(
  index: WorkspaceIndex,
  tagKey: string,
): string {
  const count = countTagMatches(index).get(tagKey) ?? { notes: 0, tasks: 0 };
  return `${count.notes} ${count.notes === 1 ? 'note' : 'notes'} · ${count.tasks} ${count.tasks === 1 ? 'task' : 'tasks'}`;
}

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
      detail: describeTagMatches(index, tag.key),
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
  // A task's assignee is a person, so the people in the index are what it
  // completes with, plus the way to ask for the tasks nobody was named on.
  const people: QuerySuggestion[] = [
    ...[...index.tags.values()]
      .filter((tag) => isPersonTag(tag.key))
      .sort((left, right) => right.count - left.count)
      .slice(0, QUERY_TAG_SUGGESTION_LIMIT)
      .map((tag) => ({
        value: tag.key,
        label: tag.label,
        detail: describeTagMatches(index, tag.key),
      })),
    { value: 'none', label: 'none', detail: 'tasks that name nobody' },
  ];
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
      assignee: people,
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
  { value: 'is:blocked', label: 'is:blocked', detail: 'Open tasks waiting for a task that is still open' },
  { value: 'is:blocking', label: 'is:blocking', detail: 'Open tasks an open task is waiting for' },
  { value: 'is:mine', label: 'is:mine', detail: 'Tasks for the person deckard.me names' },
  { value: 'is:assigned', label: 'is:assigned', detail: 'Tasks that name a person' },
  { value: 'is:unassigned', label: 'is:unassigned', detail: 'Tasks that name nobody' },
];

const HAS_SUGGESTIONS = [
  'due',
  'scheduled',
  'start',
  'done',
  'priority',
  'id',
  'dependsOn',
];

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
      return 'is:open, is:done, is:overdue, is:due, is:task, is:note, is:blocked, is:blocking, is:mine, is:assigned, or is:unassigned';
    case 'has':
      return 'has:due or no:due, and the same for scheduled, start, done, priority, id, and dependsOn';
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
    case 'assignee':
      return 'The person a task is for: whoever its 👤 field names, or none';
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
  // A search saved on the Task Board is that page's, not this one's.
  return savedFilters.find(
    (filter) => filter.query?.trim() === normalized && !filter.page,
  )?.name;
}
