import {
  isParkedFile,
  isParkedSection,
  isParkedTask,
  parkedLast,
} from '../../domain/index/parked';
import { countTaskProgress, isOpenTask } from '../../domain/tasks/taskStatuses';
import { correctQueryText, getPlainTextTerms, getTextWords } from '../../domain/query/queryEdit';
import { evaluateQuery, QueryResults } from '../../domain/query/queryEvaluator';
import { QueryContext } from '../../domain/query/queryContext';
import { EntityNamespaceAliases } from '../../domain/markdown/parser';
import { collectQueryTagKeys, getQueryNarrowedTag, getQueryTagIntersection, quoteValue } from '../../domain/query/queryFormat';
import { parseQuery } from '../../domain/query/queryParser';
import { ParsedQuery } from '../../domain/query/queryTypes';
import { noteTitle } from '../../domain/index/backlinks';
import { getFileName } from '../../shared/paths';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { buildBlockExcerpt } from '../../domain/markdown/blockExcerpt';
import {
  baseCollator,
  compareTagOverviewCards,
  createDashboardTask,
  createFileOverviewCard,
  getFileEntryTitle,
  getFileCardLines,
  createTagOverviewCard,
  createTagOverviewHub,
  getSectionBody,
  sortTasks,
} from './entryCards';
import {
  fileIncludesTag,
  getSharedTagAssociations,
  sectionIncludesTag,
  taskIncludesTag,
} from './tagMatching';
import { createQueryViewState } from './querySuggestions';
import { findTagLookalikes } from '../../domain/ranking/tagHygiene';
import { pinKey } from '../../core/storage/preferencesSchema';
import { createPinForLine } from '../../domain/notes/pins';
import { buildSearchFacets, SearchFacetValue } from '../../domain/search/facets';
import { DashboardTask, ResultPaging, TagOverviewCard } from '../protocol/shared';
import { SearchPageEntity, SearchPageSnapshot, SearchPageTagNotes, SearchResultGroup } from '../protocol/searchPage';
import { findTagFacet, GROUP_ITEM_LIMIT, groupResults } from './searchGroups';
import { countGroup, groupByHeading, type HeadingGroup } from './headingGroups';
import { computeTagProgress, describeTagProgress } from '../../domain/tasks/tagProgress';
import { linkProgressParts } from './progressLinks';
import { isEntrySection } from '../../domain/markdown/noteEntries';
import { getEntryLineMap, getEntryTextOf, getFileEntryLines, isFileEntry } from '../../domain/index/noteEntryIndex';
import { stripTags } from '../../domain/markdown/parser';
import { isTaskItemLine } from '../../domain/markdown/listNesting';
import {
  Entity,
  SearchPreview,
  ParsedFile,
  PersistedPreferences,
  SEARCH_PAGE_SIZES,
  Section,
  TagInfo,
  Task,
  TagAssociation,
  QueryFacet,
  WorkspaceIndex,
} from '../../domain/model';
import { collectTagParts } from '../../domain/tasks/tagParts';
import { formatProgressCount } from '../../domain/tasks/progressCount';
import { readNoteBody } from './notePageState';

/**
 * A search page: what one search finds, sorted, paged, and drawn as cards
 * and task rows, with a tag's own page when the search is one tag, the tags
 * to refine by, and a corrected search when nothing was found.
 */

/**
 * Notes tagged in their front matter that are entries of their own: one with
 * no headings, or one that owns an untagged heading, as a whole note does
 * (noteEntries.ts). Each lists as one note.
 */
export function listFrontmatterOnlyFiles(index: WorkspaceIndex): ParsedFile[] {
  return [...index.files.values()].filter(isFileEntry);
}

/** Options for a search page's projection. */
export interface SearchPageOptions {
  /** The search the page was opened with, which Clear returns to. */
  originQuery?: string;
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
  /** Which page of each list to carry, 1-based and clamped. */
  notePage?: number;
  taskPage?: number;
  /** The settings and moment the search is evaluated, and its dates worded, in. */
  queryContext: QueryContext;
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
  options: SearchPageOptions,
): SearchPageSnapshot {
  const text = queryText.trim();
  const page = evaluateSearchPage(index, text, options);
  const { parsed, preview, tagKeys, results, viaHub } = page;
  // Every match is sorted and counted by a key, which costs nothing to
  // build; only the page being shown is drawn. Rendering, the heading path,
  // and the pin lookup ran for every match before, so an empty search of a
  // large workspace rendered every entry to show thirty.
  const sectionKey = (section: Section): NoteKey =>
    createSectionKey(section, preferences.sectionAccessCounts);
  const ranked = rankNoteKeys(index, preferences, page, sectionKey);
  const pageSize =
    options.pageSize ??
    (options.paged === false ? undefined : preferences.searchPageSize);
  const notePaging = createPaging(ranked.length, pageSize, options.notePage);
  const markVia = <T extends object>(item: T, id: string): T =>
    viaHub.has(id) ? { ...item, via: 'hubLink' as const } : item;
  const sections = drawNoteCards(index, preferences, {
    keys: takePage(ranked, notePaging),
    page,
    markVia,
  });
  const tasks = parkedLast(
    sortTasks([...results.tasks], preferences.taskOrder, preferences.taskSortMode),
    (task) => isParkedTask(index, task.id),
  );
  const taskPaging = createPaging(tasks.length, pageSize, options.taskPage);
  // Only a search that found nothing is worth correcting: results answer the
  // search as it was typed, and offering a different one beside them would
  // argue with what the reader can already see.
  const suggestion =
    ranked.length === 0 && tasks.length === 0
      ? suggestWorkingSearch(index, { text, parsed, sectionKey, options })
      : undefined;
  const facets = buildPageFacets(index, page, text, options);
  const drawTask = (task: Task) =>
    markParked(
      markVia(createDashboardTask(task, index.sections, options.queryContext), task.id),
      isParkedTask(index, task.id),
    );
  const groups = drawHierarchy(index, preferences.searchHierarchy, {
    facets,
    page,
    ranked,
    tasks,
    drawTask,
    drawNotes: (keys) => drawNoteCards(index, preferences, { keys, page, markVia, withoutTasks: true }),
  });

  return {
    ...buildTagPageBlock(index, preferences, page, options.queryContext),
    query: createQueryViewState({
      index,
      parsed,
      matchCounts: { notes: ranked.length, tasks: tasks.length },
      isAdvanced: true,
      recentQueries: preferences.recentQueries ?? [],
      facets,
      queryContext: options.queryContext,
    }),
    ...(suggestion ? { suggestion } : {}),
    ...(preview.length > 0 ? { draftWords: preview } : {}),
    originQuery: options.originQuery?.trim() ?? '',
    savedViewName: findSavedViewName(preferences.savedFilters, tagKeys, parsed),
    sections,
    notePaging,
    tasks: takePage(tasks, taskPaging).map(drawTask),
    taskPaging,
    taskCounts: countTasks(tasks),
    pageSizes: SEARCH_PAGE_SIZES,
    ...(groups ? { groups } : {}),
    renderMode: preferences.renderMode,
    preview: preferences.searchPreview,
    sortMode: preferences.tagOverviewSortMode,
    layout: preferences.tagOverviewLayout,
    hierarchy: preferences.searchHierarchy ?? 'off',
    noteColumns: preferences.dashboardNoteColumns,
    taskColumns: preferences.dashboardTaskColumns,
  };
}

/**
 * The search with its misspellings corrected, when that finds something. A
 * word the notes contain somewhere may still sit in no note that satisfies
 * the rest of the search, so the correction is run before it is offered: a
 * second dead end would help nobody.
 */
function suggestWorkingSearch(
  index: WorkspaceIndex,
  { text, parsed, sectionKey, options }: {
    text: string;
    parsed: ParsedQuery;
    sectionKey: (section: Section) => NoteKey;
    options: SearchPageOptions;
  },
): string | undefined {
  const corrected = suggestSearch(text, parsed, options.suggestWords);
  return corrected !== undefined && findsSomething(index, corrected, sectionKey, options.queryContext)
    ? corrected
    : undefined;
}

/**
 * What Refine offers: under Tags, the tags associated with a search of tags,
 * else those its results carry; and the other facets of what it found.
 */
function buildPageFacets(index: WorkspaceIndex, page: SearchPageResults, text: string, options: SearchPageOptions): QueryFacet[] {
  const { parsed, tagKeys, results } = page;
  if (!parsed.node) {
    return [];
  }
  const related =
    tagKeys
      ? createRelatedFacetValues(index, tagKeys, results)
      : undefined;
  return buildSearchFacets(index, results, text, { related, now: options.queryContext.now });
}

/** What either hierarchy draws its groups from. */
interface HierarchySource {
  facets: readonly QueryFacet[];
  page: SearchPageResults;
  ranked: readonly NoteKey[];
  tasks: readonly Task[];
  drawNotes: (keys: readonly NoteKey[]) => TagOverviewCard[];
  drawTask: (task: Task) => DashboardTask;
}

/** The hierarchy the reader chose, by tag or by heading; nothing with it off. */
function drawHierarchy(index: WorkspaceIndex, mode: PersistedPreferences['searchHierarchy'], source: HierarchySource): SearchResultGroup[] | undefined {
  if (mode === 'tags') {
    return drawResultGroups(index, source);
  }
  return mode === 'headings' ? drawHeadingGroups(index, source) : undefined;
}

/**
 * The hierarchy by heading: each level draws its own first notes and tasks
 * and counts everything inside it, its parts' tasks among them for its bar.
 * A part narrows the search to itself within its project: the tags of the
 * levels above it with its own.
 */
function drawHeadingGroups(index: WorkspaceIndex, { page, ranked, tasks, drawNotes, drawTask }: HierarchySource): SearchResultGroup[] {
  const searched = new Set(
    collectQueryTagKeys(page.parsed.node).map((key) => resolveIndexedTagKey(index.tags, key) ?? key),
  );
  const draw = (group: HeadingGroup<NoteKey>, above: string | undefined): SearchResultGroup => {
    const counted = countGroup(group);
    const clause = group.key && above ? `(${above} AND ${group.key})` : group.key;
    const inner = above && group.key ? `${above} AND ${group.key}` : group.key;
    return {
      ...(group.key ? { tag: { label: group.label, clause, facetId: 'tags' as const } } : {}),
      notes: drawNotes(group.notes.slice(0, GROUP_ITEM_LIMIT)),
      noteCount: counted.notes,
      tasks: group.tasks.slice(0, GROUP_ITEM_LIMIT).map(drawTask),
      taskCount: counted.tasks,
      doneCount: counted.done,
      progressTotal: counted.counted,
      ...(group.children.length
        ? { children: group.children.map((child) => draw(child, inner)), ownNoteCount: group.notes.length, ownTaskCount: group.tasks.length }
        : {}),
    };
  };
  return groupByHeading(index, searched, ranked, tasks).map((group) => draw(group, undefined));
}

/**
 * The hierarchy by tag: each group drawing its first notes and tasks and
 * counting all of them, the done tasks among them for its bar.
 */
function drawResultGroups(index: WorkspaceIndex, { facets, ranked, tasks, drawNotes, drawTask }: HierarchySource): SearchResultGroup[] {
  return groupResults(index, findTagFacet(facets), ranked, tasks).map((group) => ({
    ...(group.value && group.facetId
      ? { tag: { label: group.value.label, clause: group.value.clause, facetId: group.facetId } }
      : {}),
    notes: drawNotes(group.notes.slice(0, GROUP_ITEM_LIMIT)),
    noteCount: group.notes.length,
    tasks: group.tasks.slice(0, GROUP_ITEM_LIMIT).map(drawTask),
    taskCount: group.tasks.length,
    ...withProgress(group.tasks),
  }));
}

/** How far along a group's tasks are: how many are done, of all but the cancelled ones. */
function withProgress(tasks: readonly Task[]): Pick<SearchResultGroup, 'doneCount' | 'progressTotal'> {
  const { done, total } = countTaskProgress(tasks);
  return { doneCount: done, progressTotal: total };
}

/** How many of the tasks there are in all, open, and completed. */
function countTasks(tasks: readonly Task[]): SearchPageSnapshot['taskCounts'] {
  return {
    all: tasks.length,
    active: tasks.filter(isOpenTask).length,
    completed: tasks.filter((task) => task.completed).length,
  };
}

/** An item marked as parked, when it is, for the page to draw it after the rest. */
function markParked<T extends object>(item: T, parked: boolean): T {
  return parked ? { ...item, parked: true } : item;
}

/** Whether a note key's entry, a section or a front-matter-only note, is parked. */
function isParkedKey(index: WorkspaceIndex, key: NoteKey): boolean {
  return key.section ? isParkedSection(index, key.section.id) : isParkedFile(index, key.filePath);
}

/**
 * Every note the search lists, as keys in the reader's sort order. A search
 * of plain words matches each note's title, file name, body, and tags; any
 * other search lists what it found, the tag's hub note aside, since the hub
 * is drawn above the list. Parked results are kept, after the rest, so the
 * page before them is the unparked ones whatever the sort.
 */
function rankNoteKeys(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  { drafted, results, hubFile }: SearchPageResults,
  sectionKey: (section: Section) => NoteKey,
): NoteKey[] {
  const plainTerms = getPlainTextTerms(drafted.node);
  const keys = plainTerms
    ? [
        ...[...index.sections.values()].filter(isEntrySection).map(sectionKey),
        ...listFrontmatterOnlyFiles(index).map(createFileKey),
      ].filter((key) => matchesNoteWords(index, key, plainTerms))
    : [
        ...results.sections
          .filter((section) => section.filePath !== hubFile?.filePath)
          .map(sectionKey),
        ...results.files
          .filter((file) => file.filePath !== hubFile?.filePath)
          .map(createFileKey),
      ];
  return parkedLast(
    keys.sort((left, right) =>
      compareTagOverviewCards(left, right, preferences.tagOverviewSortMode),
    ),
    (key) => isParkedKey(index, key),
  );
}

/**
 * The page of note cards being shown, each marked as linked through the hub
 * or parked, with its preview drawn around the words searched for and those
 * being typed.
 */
function drawNoteCards(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  { keys, page, markVia, withoutTasks }: {
    keys: readonly NoteKey[];
    page: SearchPageResults;
    markVia: <T extends object>(item: T, id: string) => T;
    /** Leave the task lines out of each card, when the tasks are listed beside it. */
    withoutTasks?: boolean;
  },
): TagOverviewCard[] {
  // Which entries are pinned, so a card's menu offers pinning or unpinning
  // rather than one word that is wrong half the time.
  const pinnedKeys = new Set(
    (preferences.pinnedNotes ?? []).map((pin) => pinKey(pin)),
  );
  // Cards are copied as they are marked, so their line maps are kept by id.
  const cardLines = new Map<string, CardLines>();
  const cardFor = (section: Section): TagOverviewCard => {
    const card = createTagOverviewCard(section, {
      sectionAccessCounts: preferences.sectionAccessCounts,
      pinned:
        pinnedKeys.size > 0 &&
        pinnedKeys.has(
          pinKey(
            createPinForLine(index, section.filePath, section.startLine) ?? {
              filePath: section.filePath,
            },
          ),
        ),
      sections: index.sections,
      content: getEntryTextOf(index, section),
    });
    const lineMap = getEntryLineMap(index, section);
    if (lineMap) {
      // The card's body drops the heading line, and a blank one after it.
      const dropped = lineMap.length - card.rawContent.split(/\r?\n/).length;
      cardLines.set(card.id, { map: lineMap.slice(Math.max(0, dropped)), entryId: section.id });
    }
    return card;
  };
  const snippetWords = [...new Set([...getTextWords(page.drafted.node), ...page.preview])]
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 2);
  // A front-matter note draws its own lines, never a heading that is a note
  // of its own, and maps each to where it is written, as an entry's card does.
  const fileCardFor = (file: ParsedFile): TagOverviewCard => {
    const { lines, titleId } = getFileCardLines(file, getFileEntryLines(index, file));
    const card = createFileOverviewCard(file, lines);
    cardLines.set(card.id, { map: lines, entryId: titleId ?? '' });
    return card;
  };
  return keys.map((key) => {
    const drawn = key.section ? cardFor(key.section) : fileCardFor(key.file as ParsedFile);
    const card = withoutTasks ? dropTaskLines(drawn, cardLines) : drawn;
    return withPreview(
      markParked(markVia(card, key.section ? key.section.id : card.filePath), isParkedKey(index, key)),
      preferences.searchPreview,
      snippetWords,
      cardLines.get(card.id),
    );
  });
}

/**
 * A card without its task lines, for the hierarchy, which lists the tasks
 * under the card with their progress, so the card would only repeat them.
 * Its line map follows, so a snippet still opens where its words are.
 */
function dropTaskLines(card: TagOverviewCard, cardLines: Map<string, CardLines>): TagOverviewCard {
  const texts = card.rawContent.split(/\r?\n/);
  const kept = cardLines.get(card.id);
  const map = kept?.map ?? texts.map((_text, at) => ({ line: card.startLine + 1 + at }));
  const lines = texts
    .map((text, at) => ({ text, place: map[at] ?? { line: card.startLine + 1 + at } }))
    .filter(({ text }) => !isTaskItemLine(text))
    // A run of blank lines a list leaves behind reads as one.
    .filter(({ text }, at, all) => text.trim() !== '' || (at > 0 && all[at - 1].text.trim() !== ''));
  while (lines.length && !lines[lines.length - 1].text.trim()) {
    lines.pop();
  }
  while (lines.length && !lines[0].text.trim()) {
    lines.shift();
  }
  cardLines.set(card.id, { map: lines.map(({ place }) => place), entryId: kept?.entryId ?? '' });
  const rawContent = lines.map(({ text }) => text).join('\n');
  return { ...card, rawContent, bodyTokens: buildBlockExcerpt(rawContent) };
}

/**
 * On a tag's page, what the page draws of the tag, its entity, and its hub
 * note, with the tag's lookalikes, its hub-link count, and its plain-word
 * mentions; nothing for any other search. Their lists of entries ran to
 * thousands of ids a page never reads, so only what is drawn is sent.
 */
function buildTagPageBlock(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  { focusTag, filtered, hubFile, viaHub, hubTitle, parsed }: SearchPageResults,
  context: QueryContext,
): Pick<SearchPageSnapshot, 'tag' | 'entity' | 'hub' | 'tagPage'> {
  if (!focusTag) {
    return {};
  }
  const entity = index.entities.get(focusTag.key);
  return {
    tag: {
      key: focusTag.key,
      label: focusTag.label,
      count: focusTag.count,
      isFavorite: preferences.favoriteTags.includes(focusTag.key),
      ...(focusTag.hubFilePaths?.length ? { hubFilePaths: [...focusTag.hubFilePaths] } : {}),
    },
    ...(entity ? { entity: slimEntity(entity) } : {}),
    ...(hubFile
      ? {
          hub: {
            ...createTagOverviewHub(hubFile, focusTag.hubFilePaths?.slice(1) ?? []),
            // Drawn as the note page draws it, its query blocks run.
            ...readNoteBody(index, hubFile.filePath, { queryContext: context }),
          },
        }
      : {}),
    tagPage: {
      ...(filtered ? { filtered } : {}),
      lookalikes: findTagLookalikes(index, focusTag.key),
      hubLinkCount: viaHub.size,
      ...(hubTitle ? { hubTitle } : {}),
      ...describeTagProgressLine(index, focusTag.key, context, parsed.text),
      ...describeTagParts(index, focusTag.key, context, parsed.text),
      ...describeTagMentions(index, focusTag, context),
    },
  };
}

/** Whether two searches are the same words, their spacing aside. */
function sameSearch(left: string, right: string): boolean {
  const words = (text: string): string => text.trim().replace(/\s+/g, ' ');
  return words(left) === words(right);
}

/**
 * How far along a tag's tasks are, for its page's progress line, always the
 * whole tag's whatever the search narrows it to; nothing for a tag that
 * finds no task.
 */
function describeTagProgressLine(
  index: WorkspaceIndex,
  tagKey: string,
  context: QueryContext,
  searched: string,
): Pick<SearchPageTagNotes, 'progress'> {
  const progress = computeTagProgress(index, tagKey, context.now, context.taskPolicy);
  if (!progress) {
    return {};
  }
  return {
    progress: {
      done: progress.done,
      total: progress.total,
      overdue: progress.overdue,
      label: describeTagProgress(progress, context.now, context.taskPolicy, context.dateFormats),
      // The tasks progress counts: neither steps nor parked ones. The part
      // whose search is the page's is on, and the way back to the tag.
      parts: linkProgressParts(progress, context, (terms) => `${tagKey} ${terms} -is:step -is:parked`, 'the tag’s').map((part) =>
        part.query && sameSearch(part.query, searched) ? { ...part, active: true as const } : part,
      ),
    },
  };
}

/**
 * A tag's parts, for its page's Parts line: the tags on the headings nested
 * under its own, each with its progress and the search that narrows the page
 * to it, that part on while the page is narrowed to it. Nothing for a tag
 * with no tagged heading under it.
 */
function describeTagParts(
  index: WorkspaceIndex,
  tagKey: string,
  context: QueryContext,
  searched: string,
): Pick<SearchPageTagNotes, 'parts'> {
  const parts = collectTagParts(index, tagKey, context.now, context.taskPolicy);
  if (!parts.length) {
    return {};
  }
  return {
    parts: parts.map((part) => {
      const query = `${tagKey} AND ${part.key}`;
      return {
        text: `${part.label} ${formatProgressCount(part.progress.done, part.progress.total)}`,
        query,
        tip: `Narrow the page to ${part.label}`,
        ...(sameSearch(query, searched) ? { active: true as const } : {}),
      };
    }),
  };
}

/**
 * The saved view the search on screen is, by name: for two or more tags
 * joined by AND, a view saved as those tags or as this query; otherwise one
 * saved as this query.
 */
function findSavedViewName(
  savedFilters: PersistedPreferences['savedFilters'],
  tagKeys: readonly string[] | undefined,
  parsed: ParsedQuery,
): string | undefined {
  return tagKeys && tagKeys.length >= 2
    ? findMatchingSavedViewName(savedFilters, tagKeys) ??
        findMatchingSavedQueryName(savedFilters, parsed)
    : findMatchingSavedQueryName(savedFilters, parsed);
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
  context: QueryContext,
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
  const found = evaluateQuery(index, parseQuery(query).node, context);
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
  /** Set when the search narrows its one tag with other terms rather than being the tag alone. */
  filtered?: boolean;
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
 * without carrying the tag; the hub notes' own entries stay out of that,
 * as they are the hub.
 */
export function evaluateSearchPage(
  index: WorkspaceIndex,
  queryText: string,
  options: Pick<SearchPageOptions, 'previewWords' | 'queryContext'>,
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
  const { tagKeys, focusTag, filtered } = resolveFocusTag(index, parsed, options.queryContext.entityNamespaceAliases);
  const hubPaths = focusTag?.hubFilePaths ?? [];
  const hubFile = hubPaths.length ? index.files.get(hubPaths[0]) : undefined;

  const results: QueryResults = drafted.node
    ? evaluateQuery(index, drafted.node, options.queryContext)
    : {
        sections: [...index.sections.values()].filter(isEntrySection),
        tasks: [...index.tasks.values()],
        files: listFrontmatterOnlyFiles(index),
      };
  const viaHub = new Set<string>();
  // What links to the hub is the tag's plain page's alone: a filter's terms
  // would not narrow it.
  if (!hubFile || filtered || !drafted.node) {
    return { parsed, drafted, preview, tagKeys, focusTag, ...(filtered ? { filtered } : {}), hubFile, results, viaHub };
  }
  const hubs = new Set(hubPaths);
  const links = hubPaths
    .map((filePath) => `link = [[${noteTitle(filePath)}]]`)
    .join(' OR ');
  const linking = evaluateQuery(
    index,
    parseQuery(preview.length > 0 ? `(${links}) ${preview.join(' ')}` : links).node,
    options.queryContext,
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

/** Whether one tag is a part of another: written on a heading under one that carries it (tagParts.ts). */
function isPartOf(index: WorkspaceIndex, project: string, part: string): boolean {
  return collectTagParts(index, project, Date.now()).some((found) => found.key === part);
}

/**
 * The tag a search is the page of: a search of one tag, or one that narrows
 * one tag with other terms, `filtered`, so the hub and the progress stay
 * while it narrows. With the search's tags, when it is only tags.
 */
function resolveFocusTag(
  index: WorkspaceIndex,
  parsed: ParsedQuery,
  aliases: EntityNamespaceAliases | undefined,
): { tagKeys?: string[]; focusTag?: TagInfo; filtered: boolean } {
  const tagKeys = resolveQueryTagIntersection(index, parsed, aliases);
  if (tagKeys) {
    // A project narrowed to one of its parts, from its page's Parts line,
    // stays the project's page, narrowed.
    if (tagKeys.length === 2 && isPartOf(index, tagKeys[0], tagKeys[1])) {
      return { tagKeys, focusTag: index.tags.get(tagKeys[0]), filtered: true };
    }
    return { tagKeys, focusTag: tagKeys.length === 1 ? index.tags.get(tagKeys[0]) : undefined, filtered: false };
  }
  const narrowed = getQueryNarrowedTag(parsed.node);
  const focusKey = narrowed ? resolveIndexedTagKey(index.tags, narrowed, aliases) : undefined;
  const focusTag = focusKey ? index.tags.get(focusKey) : undefined;
  return { focusTag, filtered: focusTag !== undefined };
}

/**
 * The canonical keys of a search made only of tags joined by AND, each of
 * which is in the index, or undefined for any other search. A tag is read
 * through `entityNamespaceAliases`, the workspace's when the caller has them
 * (the built-in ones otherwise), as the index read the notes.
 */
export function resolveQueryTagIntersection(
  index: WorkspaceIndex,
  parsed: ParsedQuery,
  entityNamespaceAliases?: EntityNamespaceAliases,
): string[] | undefined {
  const intersection = getQueryTagIntersection(parsed.node);
  if (!intersection || intersection.length === 0) {
    return undefined;
  }
  const tagKeys: string[] = [];
  for (const tagKey of intersection) {
    const canonical = resolveIndexedTagKey(index.tags, tagKey, entityNamespaceAliases);
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
  cardLines?: CardLines,
): TagOverviewCard {
  const lines = card.rawContent.split(/\r?\n/);
  const start = preview === 'lines' && words.length > 0 ? findSnippetStart(lines, words) : undefined;
  const snippet = start === undefined ? undefined : createSnippet(card, lines, start, cardLines);
  const long =
    lines.length > PREVIEW_LINES ||
    card.rawContent.length > PREVIEW_CHARACTERS ||
    snippet !== undefined;
  return { ...card, ...(snippet ? { snippet } : {}), ...(long ? { long } : {}) };
}

/**
 * A card's body from the line holding a searched word. A note's text skips
 * its headings with tags of their own, so its lines are mapped back to where
 * each is written, and to the untagged heading it is under.
 */
function createSnippet(
  card: TagOverviewCard,
  lines: readonly string[],
  start: number,
  cardLines: CardLines | undefined,
): NonNullable<TagOverviewCard['snippet']> {
  const mapped = cardLines?.map[start];
  const ownedHeading = mapped?.part && mapped.part.id !== cardLines?.entryId ? stripTags(mapped.part.heading).trim() : undefined;
  const rawContent = lines.slice(start).join('\n');
  return {
    rawContent,
    bodyTokens: buildBlockExcerpt(rawContent),
    line: mapped?.line ?? card.startLine + 1 + start,
    ...(ownedHeading ? { heading: ownedHeading } : {}),
  };
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

/** A section as a note key, titled as its card would be and counted by how often it was opened. */
function createSectionKey(
  section: Section,
  sectionAccessCounts: Record<string, number>,
): NoteKey {
  return {
    section,
    heading: section.heading,
    filePath: section.filePath,
    startLine: section.startLine,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    accessCount: sectionAccessCounts[section.id] ?? 0,
  };
}

/** A front-matter-only note as a note key, titled by its file name. */
function createFileKey(file: ParsedFile): NoteKey {
  return {
    file,
    heading: getFileEntryTitle(file),
    filePath: file.filePath,
    startLine: 1,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    accessCount: 0,
  };
}

/** Where each line of a card's body is written, for a note read through its untagged headings. */
interface CardLines {
  /** Each line's place in its note, and the heading it is under, when one is. */
  map: ReadonlyArray<{ line: number; part?: Section }>;
  entryId: string;
}

/** What a search's plain words are matched against, once per entry. */
const noteWordText = new WeakMap<Section | ParsedFile, string>();

/**
 * Whether a note has every word in its title, file name, body, or tags, the
 * same places the page matches words while they are typed.
 */
function matchesNoteWords(index: WorkspaceIndex, key: NoteKey, words: readonly string[]): boolean {
  const owner = (key.section ?? key.file) as Section | ParsedFile;
  let body = noteWordText.get(owner);
  if (body === undefined) {
    body = (
      key.section
        ? [
            getSectionBody(getEntryTextOf(index, key.section)),
            ...key.section.tags.map((tag) => key.section?.tagLabels[tag] ?? `#${tag}`),
          ]
        : [
            // Its own lines: a word under a heading that is a note of its own finds that note.
            getFileEntryLines(index, key.file as ParsedFile).map((line) => line.text).join('\n'),
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

/** The saved view made of exactly these tags, in any order, by name. */
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
  context: QueryContext,
): boolean {
  const parsed = parseQuery(text);
  if (!parsed.node) {
    return false;
  }
  const results = evaluateQuery(index, parsed.node, context);
  if (results.tasks.length > 0) {
    return true;
  }
  const plainTerms = getPlainTextTerms(parsed.node);
  if (!plainTerms) {
    return results.sections.length > 0 || results.files.length > 0;
  }
  return (
    [...index.sections.values()].filter(isEntrySection).some((section) =>
      matchesNoteWords(index, sectionKey(section), plainTerms),
    ) ||
    listFrontmatterOnlyFiles(index).some((file) =>
      matchesNoteWords(index, createFileKey(file), plainTerms),
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
