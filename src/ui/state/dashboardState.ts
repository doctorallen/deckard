import { describeSteps } from '../../core/markdown/taskSteps';
import {
  isParkedFile,
  isParkedSection,
  isParkedTask,
  parkedLast,
} from '../../core/workspace/parked';
import {
  DashboardSavedFilter,
  DashboardSnapshot,
  DashboardNote,
  DashboardTask,
  Entity,
  SearchPageEntity,
  SearchPreview,
  ParsedFile,
  PersistedPreferences,
  ResultPaging,
  SEARCH_PAGE_SIZES,
  SearchPageSnapshot,
  Section,
  StatsAccessItem,
  TagInfo,
  Task,
  TagTitleDisplayMode,
  TagOverviewCard,
  TagOverviewHub,
  TagOverviewSortMode,
  TagReference,
  TagAssociation,
  TaskSortMode,
  WorkspaceIndex,
  DeckardStatsSnapshot,
  StatsTrend,
  StatsTagUsage,
  TagMergeCandidate,
  UnreadableNote,
  TaskGlance,
} from '../../core/types';
import {
  isPeriodicNoteFile,
  isPersonTag,
  stripTags,
} from '../../core/markdown/parser';
import {
  canAppendTerm,
  correctQueryText,
  getPlainTextTerms,
  getTextWords,
  getTopLevelJoin,
  getTopLevelTerms,
} from '../../core/query/queryEdit';
import {
  countTagMatches,
  evaluateQuery,
  getQueryWeekStart,
  QueryResults,
} from '../../core/query/queryEvaluator';
import {
  collectQueryTagKeys,
  getQueryTagIntersection,
  quoteValue,
  toBuilderTree,
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
import { addDays, describeDueDate } from '../../core/markdown/taskMetadata';
import {
  formatMonthDay,
  formatMonthName,
  formatShortDay,
  parseDatePhrase,
  resolveDatePeriod,
} from '../../core/markdown/dates';
import {
  findMissingLinkTargets,
  getBacklinkIndex,
  noteTitle,
} from '../../core/workspace/backlinks';
import { getExtractedNoteFileName } from '../../core/markdown/noteNames';
import { resolveIndexedTagKey } from '../../core/workspace/tagNavigation';
import { renderMarkdown, renderMarkdownInline } from '../webview/rendering';
import { createAgenda, normalizeAgendaQuery, selectAgendaTasks } from './agendaState';
import { buildSearchFacets, SearchFacetValue } from './searchFacets';
import { createPinForLine, pinKey } from './pinnedNotes';
import { findTagLookalikes, findTagMergeCandidates } from './tagHygiene';

/**
 * Projects one consistent dashboard model from the index and UI-only state.
 */
export function createDashboardSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  selectedTag?: string,
  tagTitleDisplayMode: TagTitleDisplayMode = 'inline',
  options: { agendaQuery?: string; now?: number } = {},
): DashboardSnapshot {
  return {
    taskGlance: createTaskGlance(index, options.agendaQuery ?? '', options.now ?? Date.now()),
    // The page reads a tag's name, count, and heart; the entry lists each
    // one carried ran to megabytes in a large workspace and were never read.
    tags: sortTags(index.tags.values(), preferences).map((tag) => ({
      key: tag.key,
      label: tag.label,
      count: tag.count,
      isFavorite: tag.isFavorite,
    })),
    entities: sortEntities(index.entities.values(), preferences).map((entity) => ({
      key: entity.key,
      label: entity.label,
      kind: entity.kind,
      count: entity.count,
      isFavorite: entity.isFavorite,
    })),
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
 * Home's tiles, counted as the Tasks view and the status bar count: Overdue
 * and Today are its groups, and Open every open task the agenda's search
 * lists. Each search is scoped by that search too, so the tile's number and
 * the page it opens say the same thing.
 */
export function createTaskGlance(
  index: WorkspaceIndex,
  agendaQuery: string,
  now: number,
): TaskGlance {
  const selected = selectAgendaTasks(index, agendaQuery);
  const groups = createAgenda(index, now, { tasks: selected.tasks, upcomingDays: 1 });
  const count = (id: string): number =>
    groups.find((group) => group.id === id)?.entries.length ?? 0;
  const scope = normalizeAgendaQuery(agendaQuery);
  const scoped = (clause: string): string =>
    scope && !selected.error ? `(${scope}) AND ${clause}` : clause;
  return {
    overdue: count('overdue'),
    today: count('today'),
    open: selected.tasks.filter((task) => !task.completed).length,
    overdueQuery: scoped('is:overdue -is:needs-date'),
    todayQuery: scoped('is:today'),
    openQuery: scoped('is:open'),
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
  // A search Home already lists does not offer to be listed again.
  const onHome = new Set(
    preferences.dashboardWidgets
      .filter((widget) => widget.kind === 'savedQuery' && widget.filterId)
      .map((widget) => widget.filterId as string),
  );
  const home = (id: string): { onHome?: boolean } => (onHome.has(id) ? { onHome: true } : {});
  return preferences.savedFilters.flatMap((filter) => {
    if (filter.query) {
      return [
        {
          id: filter.id,
          name: filter.name,
          tags: resolveQueryTags(index, parseQuery(filter.query)),
          query: filter.query,
          ...(filter.page ? { page: filter.page } : {}),
          ...home(filter.id),
        },
      ];
    }
    const tags = filter.tagKeys
      .map((tagKey) => index.tags.get(tagKey))
      .filter((tag): tag is TagInfo => tag !== undefined)
      .map((tag) => ({ key: tag.key, label: tag.label }));
    return tags.length >= 2 ? [{ id: filter.id, name: filter.name, tags, ...home(filter.id) }] : [];
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
  /**
   * A page size of the caller's own, such as a Home widget's count, in place
   * of the reader's; it outranks `paged`.
   */
  pageSize?: number;
  /**
   * On a tag's page, also list the entries that link to its hub note without
   * the tag, as `deckard.tagOverview.includeHubLinks` says. On unless false.
   */
  includeHubLinks?: boolean;
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
  const page = evaluateSearchPage(index, text, options);
  const { parsed, drafted, preview, tagKeys, focusTag, hubFile, results, viaHub } = page;
  const tagTitleDisplayMode = options.tagTitleDisplayMode ?? 'inline';
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
      index.sections,
    );
  // Every match is sorted and counted by a key, which costs nothing to
  // build; only the page being shown is drawn. Rendering, the heading path,
  // and the pin lookup ran for every match before, so an empty search of a
  // large workspace rendered every entry to show thirty.
  const sectionKey = (section: Section): NoteKey =>
    createSectionKey(section, preferences.sectionAccessCounts, tagTitleDisplayMode);
  const plainTerms = getPlainTextTerms(drafted.node);
  const keys = plainTerms
    ? [
        ...[...index.sections.values()].map(sectionKey),
        ...listFrontmatterOnlyFiles(index).map(createFileKey),
      ].filter((key) => matchesNoteWords(key, plainTerms))
    : [
        ...results.sections
          .filter((section) => section.filePath !== hubFile?.filePath)
          .map(sectionKey),
        ...results.files
          .filter((file) => file.filePath !== hubFile?.filePath)
          .map(createFileKey),
      ];
  // Parked results are kept, after the rest, so the page before them is the
  // unparked ones whatever the sort.
  const keyParked = (key: NoteKey): boolean =>
    key.section ? isParkedSection(index, key.section.id) : isParkedFile(index, key.filePath);
  const ranked = parkedLast(
    keys.sort((left, right) =>
      compareTagOverviewCards(left, right, preferences.tagOverviewSortMode),
    ),
    keyParked,
  );
  const pageSize =
    options.pageSize ??
    (options.paged === false ? undefined : preferences.searchPageSize);
  const notePaging = createPaging(ranked.length, pageSize, options.notePage);
  // The words a card's three lines are drawn around: those searched for,
  // and those being typed.
  const snippetWords = [...new Set([...getTextWords(drafted.node), ...preview])]
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 2);
  const markVia = <T extends object>(item: T, id: string): T =>
    viaHub.has(id) ? { ...item, via: 'hubLink' as const } : item;
  const markParked = <T extends object>(item: T, parked: boolean): T =>
    parked ? { ...item, parked: true } : item;
  const sections = takePage(ranked, notePaging).map((key) =>
    withPreview(
      markParked(
        key.section
          ? markVia(cardFor(key.section), key.section.id)
          : markVia(createFileOverviewCard(key.file as ParsedFile), (key.file as ParsedFile).filePath),
        keyParked(key),
      ),
      preferences.searchPreview,
      snippetWords,
    ),
  );
  const tasks = parkedLast(
    sortTasks([...results.tasks], preferences.taskOrder, preferences.taskSortMode),
    (task) => isParkedTask(index, task.id),
  );
  const taskPaging = createPaging(tasks.length, pageSize, options.taskPage);
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
    corrected !== undefined && findsSomething(index, corrected, sectionKey)
      ? corrected
      : undefined;

  return {
    ...(focusTag
      ? {
          // What the page draws of the tag and its entity; their lists of
          // entries ran to thousands of ids a page never reads.
          tag: {
            key: focusTag.key,
            label: focusTag.label,
            count: focusTag.count,
            isFavorite: preferences.favoriteTags.includes(focusTag.key),
            ...(focusTag.hubFilePaths?.length ? { hubFilePaths: [...focusTag.hubFilePaths] } : {}),
          },
          ...(index.entities.get(focusTag.key)
            ? { entity: slimEntity(index.entities.get(focusTag.key) as Entity) }
            : {}),
          ...(hubFile
            ? {
                hub: createTagOverviewHub(
                  hubFile,
                  focusTag.hubFilePaths?.slice(1) ?? [],
                ),
              }
            : {}),
          tagPage: {
            lookalikes: findTagLookalikes(index, focusTag.key),
            hubLinkCount: viaHub.size,
            ...(page.hubTitle ? { hubTitle: page.hubTitle } : {}),
            ...describeTagMentions(index, focusTag),
          },
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
    tasks: takePage(tasks, taskPaging).map((task) =>
      markParked(
        markVia(createDashboardTask(task, index.sections), task.id),
        isParkedTask(index, task.id),
      ),
    ),
    taskPaging,
    taskCounts: {
      all: tasks.length,
      active: tasks.filter((task) => !task.completed).length,
      completed: tasks.filter((task) => task.completed).length,
    },
    pageSizes: SEARCH_PAGE_SIZES,
    renderMode: preferences.renderMode,
    preview: preferences.searchPreview,
    sortMode: preferences.tagOverviewSortMode,
    layout: preferences.tagOverviewLayout,
    noteColumns: preferences.dashboardNoteColumns,
    taskColumns: preferences.dashboardTaskColumns,
    tagTitleDisplayMode,
  };
}

/**
 * The word a tag names, as it would be written in prose: the part after its
 * namespace, with `-` and `_` read as spaces. `#project/atlas` is "atlas",
 * `@dana` is "dana". Undefined for a name too short or only a number.
 */
export function tagMentionWord(tagKey: string): string | undefined {
  const name = tagKey.replace(/^[#@]/, '');
  const word = name
    .slice(name.lastIndexOf('/') + 1)
    .replace(/[-_]+/g, ' ')
    .trim();
  return word.length >= 3 && !/^[\d\s]+$/.test(word) ? word : undefined;
}

/**
 * How many entries write a tag's name as a plain word without carrying the
 * tag, leaving out its hub notes, and the search that lists them.
 */
function describeTagMentions(
  index: WorkspaceIndex,
  tag: TagInfo,
): { mention?: { word: string; count: number; query: string } } {
  const word = tagMentionWord(tag.key);
  if (!word) {
    return {};
  }
  const query = [
    `text = ${quoteValue(word)}`,
    `-${tag.key}`,
    ...(tag.hubFilePaths ?? []).map((filePath) => `NOT path = ${quoteValue(filePath)}`),
  ].join(' ');
  const found = evaluateQuery(index, parseQuery(query).node);
  const count = found.sections.length + found.tasks.length + found.files.length;
  return count > 0 ? { mention: { word, count, query } } : {};
}

/** What one search page lists, before it is sorted, paged, and drawn. */
export interface SearchPageResults {
  parsed: ParsedQuery;
  /** The search with the words still being typed. */
  drafted: ParsedQuery;
  preview: string[];
  tagKeys?: string[];
  focusTag?: TagInfo;
  hubFile?: ParsedFile;
  results: QueryResults;
  /**
   * What is listed only because it links to the tag's hub note: section and
   * task ids, and file paths.
   */
  viaHub: Set<string>;
  hubTitle?: string;
}

/**
 * Evaluates a search page's search, as the page, Bulk edit, and Export all
 * need it. A tag's page with a hub note also lists what links to the hub
 * without carrying the tag, unless `includeHubLinks` is false; the hub notes'
 * own entries stay out of that, as they are the hub.
 */
export function evaluateSearchPage(
  index: WorkspaceIndex,
  queryText: string,
  options: Pick<SearchPageOptions, 'previewWords' | 'includeHubLinks'> = {},
): SearchPageResults {
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
  const tagKeys = resolveQueryTagIntersection(index, parsed);
  const focusTag =
    tagKeys?.length === 1 ? index.tags.get(tagKeys[0]) : undefined;
  const hubPaths = focusTag?.hubFilePaths ?? [];
  const hubFile = hubPaths.length ? index.files.get(hubPaths[0]) : undefined;

  const results: QueryResults = drafted.node
    ? evaluateQuery(index, drafted.node)
    : {
        sections: [...index.sections.values()],
        tasks: [...index.tasks.values()],
        files: listFrontmatterOnlyFiles(index),
      };
  const viaHub = new Set<string>();
  if (!hubFile || options.includeHubLinks === false || !drafted.node) {
    return { parsed, drafted, preview, tagKeys, focusTag, hubFile, results, viaHub };
  }
  const hubs = new Set(hubPaths);
  const links = hubPaths
    .map((filePath) => `link = [[${noteTitle(filePath)}]]`)
    .join(' OR ');
  const linking = evaluateQuery(
    index,
    parseQuery(preview.length > 0 ? `(${links}) ${preview.join(' ')}` : links).node,
  );
  const sectionIds = new Set(results.sections.map((section) => section.id));
  const taskIds = new Set(results.tasks.map((task) => task.id));
  const filePaths = new Set(results.files.map((file) => file.filePath));
  const sections = linking.sections.filter(
    (section) => !sectionIds.has(section.id) && !hubs.has(section.filePath),
  );
  const tasks = linking.tasks.filter(
    (task) => !taskIds.has(task.id) && !hubs.has(task.filePath),
  );
  const files = linking.files.filter(
    (file) => !filePaths.has(file.filePath) && !hubs.has(file.filePath),
  );
  sections.forEach((section) => viaHub.add(section.id));
  tasks.forEach((task) => viaHub.add(task.id));
  files.forEach((file) => viaHub.add(file.filePath));
  return {
    parsed,
    drafted,
    preview,
    tagKeys,
    focusTag,
    hubFile,
    results: {
      sections: [...results.sections, ...sections],
      tasks: [...results.tasks, ...tasks],
      files: [...results.files, ...files],
    },
    viaHub,
    hubTitle: noteTitle(hubFile.filePath),
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
 * them: each keeps as many results as carry it, and its strength is that
 * share of the results — part of a whole, "in 6 of 13 results", which a
 * reader can check, where a weight relative to the strongest listed could
 * not be. Most results first, then the stronger association.
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
  const total =
    results.sections.length + results.tasks.length + results.files.length;
  return associations
    .map((association) => {
      const tagKey = association.associatedTag.key;
      const count =
        results.sections.filter((section) =>
          sectionIncludesTag(index, section, tagKey),
        ).length +
        results.tasks.filter((task) => taskIncludesTag(index, task, tagKey))
          .length +
        results.files.filter((file) => fileIncludesTag(index, file, tagKey))
          .length;
      const why = describeAssociation(association);
      return {
        value: {
          label: index.tags.get(tagKey)?.label ?? association.associatedTag.label,
          clause: tagKey,
          count,
          strength: total > 0 ? count / total : 0,
          total,
          detail: `In ${count} of ${total} results.${why ? ` ${why}` : ''}`,
        },
        weight: association.normalizedWeight,
      };
    })
    .sort(
      (left, right) =>
        right.value.count - left.value.count ||
        right.weight - left.weight ||
        baseCollator.compare(left.value.label, right.value.label),
    )
    .map((entry) => entry.value);
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

/** A card's body lines, past which it is cut to three with Show all. */
const PREVIEW_LINES = 3;
/** Characters past which a short body still wraps beyond three lines. */
const PREVIEW_CHARACTERS = 280;

/**
 * A card as the Preview row draws it: whether it runs past three lines, and,
 * when the searched words sit below them, the paragraph they are in.
 */
function withPreview(
  card: TagOverviewCard,
  preview: SearchPreview,
  words: readonly string[],
): TagOverviewCard {
  const lines = card.rawContent.split(/\r?\n/);
  const start = preview === 'lines' && words.length > 0 ? findSnippetStart(lines, words) : undefined;
  const snippet =
    start === undefined
      ? undefined
      : {
          rawContent: lines.slice(start).join('\n'),
          renderedHtml: renderMarkdown(lines.slice(start).join('\n')),
          line: card.startLine + 1 + start,
        };
  const long =
    lines.length > PREVIEW_LINES ||
    card.rawContent.length > PREVIEW_CHARACTERS ||
    snippet !== undefined;
  return { ...card, ...(snippet ? { snippet } : {}), ...(long ? { long } : {}) };
}

/**
 * The line a card's snippet starts on: the start of the paragraph holding
 * the first line with a searched word, or the fence around it when it is in
 * code. Nothing when that line is already among the first three.
 */
export function findSnippetStart(
  lines: readonly string[],
  words: readonly string[],
): number | undefined {
  let fence: { marker: string; size: number; start: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker && !fence) {
      fence = { marker: marker[1][0], size: marker[1].length, start: index };
      continue;
    }
    if (
      marker &&
      fence &&
      marker[1][0] === fence.marker &&
      marker[1].length >= fence.size &&
      /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)
    ) {
      fence = undefined;
      continue;
    }
    const lower = line.toLowerCase();
    if (!words.some((word) => lower.includes(word))) {
      continue;
    }
    let start = index;
    if (fence) {
      start = fence.start;
    } else {
      for (let step = 0; step < 2 && start > 0 && lines[start - 1].trim(); step += 1) {
        start -= 1;
      }
    }
    return start < PREVIEW_LINES ? undefined : start;
  }
  return undefined;
}

/**
 * A note as a search sorts, counts, and matches it, before it is drawn: an
 * entry or a front-matter-only file, with what the sort orders by.
 */
interface NoteKey {
  section?: Section;
  file?: ParsedFile;
  heading: string;
  filePath: string;
  startLine: number;
  createdAt?: number;
  updatedAt?: number;
  accessCount: number;
}

function createSectionKey(
  section: Section,
  sectionAccessCounts: Record<string, number>,
  tagTitleDisplayMode: TagTitleDisplayMode,
): NoteKey {
  return {
    section,
    heading: getNoteTitle(section.heading, tagTitleDisplayMode),
    filePath: section.filePath,
    startLine: section.startLine,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    accessCount: sectionAccessCounts[section.id] ?? 0,
  };
}

function createFileKey(file: ParsedFile): NoteKey {
  return {
    file,
    heading: getFileName(file.filePath) ?? file.filePath,
    filePath: file.filePath,
    startLine: 1,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    accessCount: 0,
  };
}

/** What a search's plain words are matched against, once per entry. */
const noteWordText = new WeakMap<Section | ParsedFile, string>();

/**
 * Whether a note has every word in its title, file name, body, or tags, the
 * same places the page matches words while they are typed.
 */
function matchesNoteWords(key: NoteKey, words: readonly string[]): boolean {
  const owner = (key.section ?? key.file) as Section | ParsedFile;
  let body = noteWordText.get(owner);
  if (body === undefined) {
    body = (
      key.section
        ? [
            getSectionBody(key.section.rawContent),
            ...key.section.tags.map((tag) => key.section?.tagLabels[tag] ?? `#${tag}`),
          ]
        : [
            getFrontmatterBody((key.file as ParsedFile).content),
            ...(key.file as ParsedFile).frontmatterTags.map((tag) => tag.label),
          ]
    )
      .join(' ')
      .toLowerCase();
    noteWordText.set(owner, body);
  }
  const text = `${key.heading} ${getFileName(key.filePath) ?? key.filePath} ${body}`.toLowerCase();
  return words.every((word) => text.includes(word.toLowerCase()));
}

/** An entity as a search page draws it: its name, kind, and count. */
function slimEntity(entity: Entity): SearchPageEntity {
  return {
    key: entity.key,
    label: entity.label,
    kind: entity.kind,
    name: entity.name,
    count: entity.count,
  };
}

/**
 * Summarizes the current index and recorded local navigation for the Stats page.
 */
export function createDeckardStatsSnapshot(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  unreadable: readonly UnreadableNote[] = [],
  now = Date.now(),
): DeckardStatsSnapshot {
  // Every pair, once: Stats lists the clearest, and a tag used once is
  // offered its lookalike from the same list.
  const lookalikes = findTagMergeCandidates(index, Number.MAX_SAFE_INTEGER);
  return {
    trends: createStatsTrends(index, now),
    updatedAt: index.updatedAt,
    unreadable: unreadable.map((note) => ({
      ...note,
      open: { type: 'openSource', filePath: note.filePath, line: 1 },
    })),
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
    ...findLookalikeTags(lookalikes),
    tagUsage: createTagUsage(index, lookalikes.candidates),
    ...listMissingLinkTargets(index),
    ...countParked(index),
  };
}

const TREND_WEEK = 7 * 24 * 60 * 60 * 1000;
/** Twelve rolling seven-day spans: thirteen points, the last one now. */
const TREND_POINTS = 13;

/**
 * How the Notes, Tasks, and Open tasks totals stood at the end of each of
 * the last twelve rolling weeks, ending now, rebuilt from today's notes: an
 * entry counts from its note's date, a task is open from then until its ✅
 * date, or its note's last change when it has none. Deleted notes are gone
 * from past weeks too, and an entry added to an old note counts from that
 * note's date. One pass over the entries; each adds where it starts, and a
 * done task takes itself away where it ends.
 */
export function createStatsTrends(
  index: WorkspaceIndex,
  now = Date.now(),
): DeckardStatsSnapshot['trends'] {
  const last = TREND_POINTS - 1;
  /** The first point at which something dated `at` exists; undated, always. */
  const firstPoint = (at: number | undefined): number => {
    if (at === undefined || !Number.isFinite(at)) {
      return 0;
    }
    if (at > now) {
      return last;
    }
    return Math.max(0, last - Math.floor((now - at) / TREND_WEEK));
  };
  const notes = new Array<number>(TREND_POINTS + 1).fill(0);
  const tasks = new Array<number>(TREND_POINTS + 1).fill(0);
  const open = new Array<number>(TREND_POINTS + 1).fill(0);
  index.sections.forEach((section) => {
    notes[firstPoint(section.createdAt)] += 1;
  });
  index.tasks.forEach((task) => {
    const start = firstPoint(task.createdAt);
    tasks[start] += 1;
    if (!task.completed) {
      open[start] += 1;
      return;
    }
    const doneAt = task.doneAt ?? task.updatedAt ?? index.files.get(task.filePath)?.updatedAt;
    if (doneAt === undefined) {
      // Done, and no date says when: it is counted open in no past week.
      return;
    }
    const end = Math.max(start, doneAt > now ? last : Math.max(0, last - Math.floor((now - doneAt) / TREND_WEEK)));
    open[start] += 1;
    open[end] -= 1;
  });
  const levels = (starts: number[], total: number): StatsTrend => {
    const points: number[] = [];
    let running = 0;
    for (let point = 0; point < TREND_POINTS; point += 1) {
      running += starts[point];
      points.push(running);
    }
    // The last point is the total on the tile, so the two always agree.
    points[last] = total;
    return { points, change: points[last] - points[last - 1] };
  };
  return {
    notes: levels(notes, index.sections.size),
    tasks: levels(tasks, index.tasks.size),
    openTasks: levels(open, [...index.tasks.values()].filter((task) => !task.completed).length),
  };
}

/** How many notes and open tasks are parked, when any are. */
function countParked(index: WorkspaceIndex): Pick<DeckardStatsSnapshot, 'parked'> {
  const parked = index.parked;
  if (!parked || (parked.sections.size === 0 && parked.tasks.size === 0 && parked.files.size === 0)) {
    return {};
  }
  let openTasks = 0;
  parked.tasks.forEach((id) => {
    if (index.tasks.get(id)?.completed === false) {
      openTasks += 1;
    }
  });
  // A note is parked when it is parked whole, or holds a parked entry.
  const notes = new Set(parked.files);
  parked.sections.forEach((id) => {
    const section = index.sections.get(id);
    if (section) {
      notes.add(section.filePath);
    }
  });
  return { parked: { notes: notes.size, openTasks } };
}

/** How many of the names that open no note the Stats page lists. */
const MISSING_LINK_LIMIT = 50;

/** The names links write that open no note, most linked first. */
function listMissingLinkTargets(
  index: WorkspaceIndex,
): Pick<DeckardStatsSnapshot, 'missingLinkTargets' | 'missingLinkTargetCount'> {
  const missing = findMissingLinkTargets(index);
  return {
    missingLinkTargetCount: missing.length,
    missingLinkTargets: missing.slice(0, MISSING_LINK_LIMIT).map((target) => ({
      name: target.name,
      count: target.count,
      sources: target.sourcePaths.slice(0, 3).map((filePath) => noteTitle(filePath)),
      sourceCount: target.sourcePaths.length,
      creatable: getExtractedNoteFileName(target.name) !== undefined,
    })),
  };
}

/** How many of the tags that look alike the Stats page names. */
const LOOKALIKE_TAG_LIMIT = 12;

/** Tags that look like two spellings of one idea, the clearest pairs first. */
function findLookalikeTags(
  { candidates, total }: { candidates: TagMergeCandidate[]; total: number },
): Pick<DeckardStatsSnapshot, 'lookalikeTags' | 'lookalikeTagCount'> {
  return { lookalikeTags: candidates.slice(0, LOOKALIKE_TAG_LIMIT), lookalikeTagCount: total };
}

/** The bands of how often a tag is used: once, twice, 3–5, 6–10, 11–25, 26 or more. */
const TAG_USE_BANDS: readonly { label: string; min: number; max?: number }[] = [
  { label: 'Used once', min: 1, max: 1 },
  { label: 'Used twice', min: 2, max: 2 },
  { label: 'Used 3–5 times', min: 3, max: 5 },
  { label: 'Used 6–10 times', min: 6, max: 10 },
  { label: 'Used 11–25 times', min: 11, max: 25 },
  { label: 'Used 26 or more times', min: 26 },
];
/** How many of the tags used once Stats lists. */
const USED_ONCE_LIMIT = 100;

/**
 * How many tags are used how often, by the entries that carry them, and
 * the tags used once — the likeliest typos and one-offs — each with the tag
 * it looks like when there is one, so it can be merged there.
 */
export function createTagUsage(
  index: WorkspaceIndex,
  candidates: readonly TagMergeCandidate[] = findTagMergeCandidates(index, Number.MAX_SAFE_INTEGER).candidates,
): StatsTagUsage {
  const bands = TAG_USE_BANDS.map((band) => ({ ...band, count: 0 }));
  const once: TagInfo[] = [];
  index.tags.forEach((tag) => {
    if (tag.count < 1) {
      return;
    }
    const band = bands.find((candidate) => tag.count >= candidate.min && (candidate.max === undefined || tag.count <= candidate.max));
    if (band) {
      band.count += 1;
    }
    if (tag.count === 1) {
      once.push(tag);
    }
  });
  const lookalike = new Map<string, { key: string; label: string }>();
  candidates.forEach((candidate) => {
    if (!lookalike.has(candidate.sourceKey)) {
      lookalike.set(candidate.sourceKey, { key: candidate.targetKey, label: candidate.targetLabel });
    }
  });
  const usedOnce = once
    .sort((left, right) => baseCollator.compare(left.label, right.label))
    .slice(0, USED_ONCE_LIMIT)
    .map((tag) => {
      const like = lookalike.get(tag.key);
      return like ? { key: tag.key, label: tag.label, lookalike: like } : { key: tag.key, label: tag.label };
    });
  return { bands, usedOnce, usedOnceCount: once.length };
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
  const backlinks = getBacklinkIndex(index);
  const orphans = [...index.files.values()]
    .filter(
      (file) =>
        backlinks.toNote(file.filePath).length === 0 &&
        !isPeriodicNoteFile(file) &&
        // An archive is expected to be unlinked.
        !isParkedFile(index, file.filePath),
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
  now: number = Date.now(),
): DashboardTask {
  const due =
    !task.completed && task.dueAt !== undefined
      ? describeDueDate(task.dueAt, now, task.dueText)
      : undefined;
  return {
    task,
    renderedTitle: renderTaskTitle(task),
    titleTags: getTitleTags(task.tags, task.tagLabels, task.title),
    sectionHeading: task.sectionId
      ? sections.get(task.sectionId)?.heading
      : undefined,
    headingPath: (() => {
      const section = task.sectionId ? sections.get(task.sectionId) : undefined;
      return section ? getHeadingPath(section, sections) : [];
    })(),
    fileName: task.filePath.split('/').pop() ?? task.filePath,
    ...(due
      ? {
          dueLabel: due.label.charAt(0).toUpperCase() + due.label.slice(1),
          overdue: due.overdue,
          ...(due.stale ? { stale: true } : {}),
        }
      : {}),
    ...(task.steps ? { stepsLabel: describeSteps(task.steps) } : {}),
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
  sections?: ReadonlyMap<string, Section>,
): TagOverviewCard {
  return {
    id: section.id,
    ...(sections ? { headingPath: getHeadingPath(section, sections) } : {}),
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
  const rawContent = getFilePreamble(file);
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
  sectionKey: (section: Section) => NoteKey,
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
      matchesNoteWords(sectionKey(section), plainTerms),
    ) ||
    listFrontmatterOnlyFiles(index).some((file) =>
      matchesNoteWords(createFileKey(file), plainTerms),
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

/** What the note order reads, whether of a key or a drawn card. */
type SortableNote = Pick<
  TagOverviewCard,
  'heading' | 'filePath' | 'startLine' | 'createdAt' | 'updatedAt' | 'accessCount'
>;

function compareTagOverviewCards(
  left: SortableNote,
  right: SortableNote,
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

/**
 * What a note's own card shows. A note listed for its front matter tags shows
 * its body; one listed only because a search by link found a link above its
 * first heading shows the text above that heading, since each heading below
 * is an entry of its own.
 */
function getFilePreamble(file: ParsedFile): string {
  const body = getFrontmatterBody(file.content);
  const firstHeading = file.sections.find((section) => !section.isInline);
  if (file.frontmatterTags.length > 0 || !firstHeading) {
    return body;
  }
  const lines = file.content.split(/\r?\n/).slice(0, firstHeading.startLine - 1);
  return getFrontmatterBody(lines.join('\n')).trim();
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
  const pending = extras.pending?.trim();
  return {
    text: parsed.text,
    ...(pending ? { pending } : {}),
    terms: getTopLevelTerms(parsed),
    termsJoin: getTopLevelJoin(parsed),
    canAppend: canAppendTerm(parsed),
    facets: extras.facets ?? [],
    isAdvanced,
    diagnostics: pending ? parseQuery(pending).diagnostics : parsed.diagnostics,
    builder: toBuilderTree(parsed.node),
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
  now: number = Date.now(),
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

  // A week or a month says the days it covers, and a weekday the day it
  // is, so a value is chosen by what it means today.
  const weekStart = getQueryWeekStart();
  const span = (value: string): string => {
    const range = resolveDatePeriod(value, now, weekStart);
    if (!range) {
      return '';
    }
    return value.endsWith('-month')
      ? formatMonthName(range.start, now)
      : `${formatMonthDay(range.start)} to ${formatMonthDay(addDays(range.end, -1))}`;
  };
  const period = (value: string): QuerySuggestion => ({ value, label: value, detail: span(value) });
  const weekday = (value: string, direction: 'past' | 'future'): QuerySuggestion => {
    const date = parseDatePhrase(value, now, { direction })?.date;
    return { value, label: value, detail: date ? formatShortDay(date, now) : undefined };
  };
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dates: QuerySuggestion[] = [
    { value: 'today', label: 'today' },
    { value: 'yesterday', label: 'yesterday' },
    { value: '7d', label: '7d', detail: 'the last seven days' },
    { value: '30d', label: '30d', detail: 'the last thirty days' },
    { value: '90d', label: '90d', detail: 'the last ninety days' },
    period('this-week'),
    period('last-week'),
    period('this-month'),
    period('last-month'),
    ...WEEKDAYS.map((day) => weekday(day, 'past')),
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
    period('this-week'),
    period('next-week'),
    period('this-month'),
    period('next-month'),
    ...WEEKDAYS.map((day) => weekday(day, 'future')),
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
  const links = createLinkSuggestions(index);
  const folders: QuerySuggestion[] = collectFolders(filePaths)
    .slice(0, QUERY_PATH_SUGGESTION_LIMIT)
    .map((folder) => ({ value: folder, label: folder }));

  return {
    fields,
    aliases: { ...FIELD_ALIASES },
    operators: { ...QUERY_FIELD_OPERATORS },
    values: {
      tag: tags,
      link: links,
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
        { value: `has:${value}`, label: `has:${value}`, detail: describeHas(value, true) },
        { value: `no:${value}`, label: `no:${value}`, detail: describeHas(value, false) },
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

/** Upper bound on note names offered after `[[`. */
const QUERY_LINK_SUGGESTION_LIMIT = 200;
const linkSuggestions = new WeakMap<WorkspaceIndex, QuerySuggestion[]>();

/**
 * The notes a `[[` completes to, most linked first: each note's title, and
 * each alias its front matter gives it. `value` is the name without brackets,
 * which a builder row's value takes; the label is the link as typed.
 */
function createLinkSuggestions(index: WorkspaceIndex): QuerySuggestion[] {
  const cached = linkSuggestions.get(index);
  if (cached) {
    return cached;
  }
  const backlinks = getBacklinkIndex(index);
  const linkedFrom = (filePath: string): number =>
    new Set(backlinks.toNote(filePath).map((link) => link.sourcePath)).size;
  const candidates: Array<QuerySuggestion & { count: number }> = [];
  index.files.forEach((file, filePath) => {
    const title = noteTitle(filePath);
    const count = linkedFrom(filePath);
    candidates.push({
      value: title,
      label: `[[${title}]]`,
      detail: `Linked from ${count} ${count === 1 ? 'note' : 'notes'}`,
      count,
    });
    file.aliases?.forEach((alias) =>
      candidates.push({
        value: alias,
        label: `[[${alias}]]`,
        detail: `alias of ${title}`,
        count,
      }),
    );
  });
  const suggestions = candidates
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, QUERY_LINK_SUGGESTION_LIMIT)
    .map(({ value, label, detail }) => ({ value, label, detail }));
  linkSuggestions.set(index, suggestions);
  return suggestions;
}

/** Whole `is:` conditions, with what each finds. */
const IS_SUGGESTIONS: QuerySuggestion[] = [
  { value: 'is:open', label: 'is:open', detail: 'Open tasks' },
  { value: 'is:done', label: 'is:done', detail: 'Completed tasks' },
  { value: 'is:overdue', label: 'is:overdue', detail: 'Open tasks past their due date' },
  { value: 'is:due', label: 'is:due', detail: 'Open tasks due within seven days, overdue included' },
  { value: 'is:today', label: 'is:today', detail: 'Open tasks due today, or scheduled for today or earlier and started' },
  { value: 'is:needs-date', label: 'is:needs-date', detail: 'Open tasks more than 30 days past their due date' },
  { value: 'is:task', label: 'is:task', detail: 'Every task' },
  { value: 'is:note', label: 'is:note', detail: 'Note sections only, no tasks' },
  { value: 'is:blocked', label: 'is:blocked', detail: 'Open tasks waiting for a task that is still open' },
  { value: 'is:waiting', label: 'is:waiting', detail: 'Open tasks marked #status/waiting, or for someone else' },
  { value: 'is:available', label: 'is:available', detail: 'Open tasks you can start now: not blocked, started, not waiting or someday' },
  { value: 'is:blocking', label: 'is:blocking', detail: 'Open tasks an open task is waiting for' },
  { value: 'is:mine', label: 'is:mine', detail: 'Tasks for the person the "Me" setting names' },
  { value: 'is:assigned', label: 'is:assigned', detail: 'Tasks that name a person' },
  { value: 'is:unassigned', label: 'is:unassigned', detail: 'Tasks that name nobody' },
  { value: 'is:daily', label: 'is:daily', detail: 'Written in a daily note' },
  { value: 'is:periodic', label: 'is:periodic', detail: 'Written in a daily, weekly, or monthly note' },
  { value: 'is:parked', label: 'is:parked', detail: 'Notes and tasks that are parked' },
  { value: 'is:step', label: 'is:step', detail: 'Tasks written under another task' },
];

const HAS_SUGGESTIONS = [
  'due',
  'scheduled',
  'start',
  'done',
  'priority',
  'id',
  'dependsOn',
  'steps',
];

/** What `has:` and `no:` find, for each value they take. */
function describeHas(value: string, present: boolean): string {
  switch (value) {
    case 'priority':
      return present ? 'Tasks with a priority' : 'Tasks without a priority';
    case 'id':
      return present ? 'Tasks with an id (🆔) others can wait for' : 'Tasks without an id (🆔)';
    case 'dependsOn':
      return present ? 'Tasks that wait for another task (⛔)' : 'Tasks that wait for no other task';
    case 'steps':
      return present ? 'Tasks broken into steps' : 'Tasks with no steps';
    default:
      return present ? `Tasks with a ${value} date` : `Tasks without a ${value} date`;
  }
}

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
    case 'link':
      return 'A note the entry links to, as [[Atlas]] or [[Atlas#Decision]]; aliases count';
    case 'text':
      return 'Words in the note, task, or file body';
    case 'is':
      return 'is:open, is:done, is:overdue, is:due, is:today, is:needs-date, is:task, is:note, is:blocked, is:blocking, is:waiting, is:available, is:mine, is:assigned, is:unassigned, is:daily, is:periodic, is:parked, or is:step';
    case 'has':
      return 'has:due or no:due, and the same for scheduled, start, done, priority, id, dependsOn, and steps';
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
