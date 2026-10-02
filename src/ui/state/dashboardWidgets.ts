import { isParkedOnlyTag, mentionsParked, withoutParked } from '../../domain/index/parked';
import { stripTags } from '../../domain/markdown/parser';
import {
  countTagMatches,
  countTagPairMatches,
  evaluateQuery,
} from '../../domain/query/queryEvaluator';
import { parseQuery } from '../../domain/query/queryParser';
import { QueryContext } from '../../domain/query/queryContext';
import { formatLocalDate, listDailyNotes } from '../../domain/notes/periodicNotes';
import { createAgenda, selectAgendaTasks } from './agendaState';
import { createDashboardSavedFilters, getSavedFilterQuery, sortTags } from './dashboardState';
import { listQuietTags } from './peopleRecency';
import { rankRelatedNotes } from './relatedNotesRanking';
import { sortRelatedNotes } from '../../domain/ranking/relatedNotesOrder';
import { RelatedNotesRankingOptions } from '../../domain/ranking/relatedNotesContext';
import { collectFileTags } from '../../domain/ranking/relatedNotes';
import { resolvePin } from '../../domain/notes/pins';
import { pinKey } from '../../core/storage/preferencesSchema';
import { frecencyScore } from '../../domain/ranking/frecency';
import { getFileName } from '../../shared/paths';
import { createSearchPageSnapshot } from './searchPageState';
import { createQueryViewState, describeTagMatches } from './querySuggestions';
import { createDashboardTask, sortTasks } from './entryCards';
import { ResultPaging } from '../protocol/shared';
import {
  DashboardWidgetConfig,
  DashboardWidgetKind,
  PersistedPreferences,
  TagTitleDisplayMode,
  WorkspaceIndex,
} from '../../domain/model';
import { DashboardTryNext, DashboardWidget } from '../protocol/dashboard';

const DAY = 24 * 60 * 60 * 1000;
/** How many entries a tag needs before Home suggests it a hub note. */
const HUB_SUGGESTION_MINIMUM = 3;

/** What Home's widgets need beyond the index and preferences. */
export interface DashboardWidgetOptions {
  /**
   * The settings and moment Home is drawn in: what its searches find, how
   * its dates read, and how old its entries are.
   */
  queryContext: QueryContext;
  /** How far ahead the agenda widget looks, from `deckard.agenda.upcomingDays`. */
  upcomingDays: number;
  /** What the agenda widget lists, from `deckard.agenda.query`. */
  agendaQuery?: string;
  tagTitleDisplayMode: TagTitleDisplayMode;
  /** The note last open in an editor, which Home can rank by and pin. */
  sourceNotePath?: string;
  /** How Related Notes ranks, from its settings. */
  relatedNotes?: {
    enableKeywordLinks: boolean;
    ranking: RelatedNotesRankingOptions;
  };
  /** Try next's suggestion, which the host chooses. */
  tryNext?: DashboardTryNext;
}

/** Each widget's heading. A saved-search widget is named after its search. */
export const DASHBOARD_WIDGET_TITLES: Readonly<Record<DashboardWidgetKind, string>> = {
  search: 'Search',
  tasks: 'Tasks',
  agenda: 'Tasks view',
  favoriteTags: 'Favorite tags',
  topTags: 'Frequent tags',
  savedSearches: 'Saved searches',
  recentSearches: 'Recent searches',
  recentNotes: 'Recently opened',
  stats: 'Workspace',
  savedQuery: 'Saved search',
  todayNote: 'Today',
  quickAdd: 'Quick add',
  staleTasks: 'Stale tasks',
  relatedNotes: 'Related notes',
  tagPairs: 'Tags written together',
  unhubbedTags: 'Tags without a hub',
  newTags: 'New tags',
  quietPeople: 'Gone quiet',
  pinnedNotes: 'Pinned notes',
  tryNext: 'Try next',
};

/**
 * Builds what each of Home's widgets shows, in the order the reader
 * arranged them. A list widget lists at most its count, and says how many
 * there are in all.
 */
export function createDashboardWidgets(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  options: DashboardWidgetOptions,
): DashboardWidget[] {
  return preferences.dashboardWidgets.map((config) => {
    const { widget, paging } = createWidget({ index, preferences, options }, config);
    return paging ? { ...widget, paging } : widget;
  });
}

/** What building one widget reads: the index and preferences, Home's options, and the widget's own config. */
interface WidgetBuild {
  index: WorkspaceIndex;
  preferences: PersistedPreferences;
  options: DashboardWidgetOptions;
  config: DashboardWidgetConfig;
  /** The widget as configured, with its heading, which each builder adds to. */
  widget: DashboardWidget;
  /** How many entries the widget lists, or a page holds. */
  count: number;
  /** The entries the widget shows: its first `count`, or the page it is on. */
  take: <T>(entries: readonly T[]) => T[];
}

/** Builds one kind of widget. */
type WidgetBuilder = (build: WidgetBuild) => DashboardWidget;

/**
 * Builds one widget, with the paging it worked out while it took its
 * entries, when it is paged; only the widget knows how many it found.
 */
function createWidget(
  { index, preferences, options }: Pick<WidgetBuild, 'index' | 'preferences' | 'options'>,
  config: DashboardWidgetConfig,
): { widget: DashboardWidget; paging?: ResultPaging } {
  const count = config.count ?? 5;
  let paging: ResultPaging | undefined;
  const take = <T,>(entries: readonly T[]): T[] => {
    const page = takePage(entries, config, count);
    if (page.paging) {
      paging = page.paging;
    }
    return page.entries;
  };
  const widget = WIDGET_BUILDERS[config.kind]({
    index,
    preferences,
    options,
    config,
    widget: { ...config, title: DASHBOARD_WIDGET_TITLES[config.kind] },
    count,
    take,
  });
  return paging ? { widget, paging } : { widget };
}

/**
 * The entries a widget shows: its first few, or one page of them, with the
 * page it is on.
 *
 * A page number is clamped rather than refused, because the entries move
 * under it — a task completed elsewhere shortens the list while its last
 * page is open, and the reader should find the last page there.
 */
function takePage<T>(
  entries: readonly T[],
  config: DashboardWidgetConfig,
  count: number,
): { entries: T[]; paging?: ResultPaging } {
  if (!config.paged) {
    return { entries: entries.slice(0, count) };
  }
  const pageCount = Math.max(Math.ceil(entries.length / count), 1);
  const page = Math.min(Math.max(Math.trunc(config.page ?? 1), 1), pageCount);
  const start = (page - 1) * count;
  return {
    entries: entries.slice(start, start + count),
    paging: { page, size: count, pageCount, total: entries.length },
  };
}

/** The search box, with the query bar's state for an empty search. */
function buildSearchWidget({ index, preferences, options, widget }: WidgetBuild): DashboardWidget {
  return {
    ...widget,
    searchState: createQueryViewState({
      index,
      parsed: parseQuery(''),
      matchCounts: { notes: 0, tasks: 0 },
      isAdvanced: true,
      recentQueries: preferences.recentQueries ?? [],
      queryContext: options.queryContext,
    }),
  };
}

/** The tasks a widget's search finds, or every task, sorted as the reader sorts them; a search that does not parse says why and lists none. */
function buildTasksWidget({ index, preferences, options, config, widget, take }: WidgetBuild): DashboardWidget {
  const query = config.query ?? '';
  const parsed = parseQuery(query);
  if (query.trim() && !parsed.node) {
    return {
      ...widget,
      tasks: [],
      total: 0,
      error: parsed.diagnostics[0]?.message ?? 'This search does not parse.',
    };
  }
  // A list of things to do: parked tasks stay out unless it asks for them.
  const found = parsed.node
    ? evaluateQuery(index, parsed.node, options.queryContext).tasks
    : [...index.tasks.values()];
  const tasks = sortTasks(
    mentionsParked(parsed.node) ? found : withoutParked(found, index),
    preferences.taskOrder,
    preferences.taskSortMode,
  );
  return {
    ...widget,
    total: tasks.length,
    tasks: take(tasks)
      .map((task) => createDashboardTask(task, index.sections, options.queryContext)),
  };
}

/** The Tasks view in brief: its groups with their first tasks, and lines for what was done today and what needs a new date. */
function buildAgendaWidget({ index, options, widget, count }: WidgetBuild): DashboardWidget {
  const groups = createAgenda(index, options.queryContext, {
    tasks: selectAgendaTasks(index, options.agendaQuery ?? '', options.queryContext).tasks,
    upcomingDays: options.upcomingDays,
    doneToday: true,
  });
  // What needs a new date is a line under the list, not a group in it.
  const needsNewDate =
    groups.find((group) => group.id === 'needsdate')?.entries.length ?? 0;
  const doneToday =
    groups.find((group) => group.id === 'donetoday')?.entries.length ?? 0;
  const listed = groups.filter(
    (group) => group.id !== 'needsdate' && group.id !== 'donetoday',
  );
  const scope = options.agendaQuery?.trim();
  return {
    ...widget,
    total: listed.reduce((sum, group) => sum + group.entries.length, 0),
    ...(doneToday > 0 ? { doneToday } : {}),
    ...(needsNewDate > 0
      ? {
          needsNewDate,
          needsNewDateQuery: scope ? `(${scope}) AND is:needs-date` : 'is:needs-date',
        }
      : {}),
    agenda: listed.map((group) => ({
      id: group.id,
      label: group.label,
      count: group.entries.length,
      tasks: group.entries
        .slice(0, count)
        .map((entry) => createDashboardTask(entry.task, index.sections, options.queryContext)),
    })),
  };
}

/** The reader's favorite tags, in the order the tag list sorts them. */
function buildFavoriteTagsWidget({ index, preferences, widget, take }: WidgetBuild): DashboardWidget {
  const favorites = sortTags(index.tags.values(), preferences).filter(
    (tag) => tag.isFavorite,
  );
  return {
    ...widget,
    total: favorites.length,
    tags: take(favorites).map((tag) => ({
      key: tag.key,
      label: tag.label,
      detail: describeTagMatches(index, tag.key),
    })),
  };
}

/** The tags opened most often and most lately. */
function buildTopTagsWidget({ index, preferences, options, widget, take }: WidgetBuild): DashboardWidget {
  const ranked = [...index.tags.values()]
    .map((tag) => ({
      tag,
      score: frecencyScore(
        preferences.tagAccessCounts[tag.key] ?? 0,
        preferences.tagAccessTimes?.[tag.key],
        options.queryContext.now,
      ),
    }))
    .filter((entry) => (preferences.tagAccessCounts[entry.tag.key] ?? 0) > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.tag.label.localeCompare(right.tag.label),
    );
  return {
    ...widget,
    total: ranked.length,
    tags: take(ranked).map(({ tag }) => ({
      key: tag.key,
      label: tag.label,
      detail: describeTagMatches(index, tag.key),
    })),
  };
}

/** The reader's saved searches, all of them. */
function buildSavedSearchesWidget({ index, preferences, widget }: WidgetBuild): DashboardWidget {
  const savedFilters = createDashboardSavedFilters(index, preferences);
  return { ...widget, total: savedFilters.length, savedFilters };
}

/** The searches run last. */
function buildRecentSearchesWidget({ preferences, widget, take }: WidgetBuild): DashboardWidget {
  const queries = preferences.recentQueries ?? [];
  return {
    ...widget,
    total: queries.length,
    queries: take(queries),
  };
}

/** The sections opened last, latest first, leaving out any the index no longer has. */
function buildRecentNotesWidget({ index, preferences, widget, take }: WidgetBuild): DashboardWidget {
  const notes = Object.entries(preferences.sectionAccessTimes ?? {})
    .sort((left, right) => right[1] - left[1])
    .flatMap(([sectionId]) => {
      const section = index.sections.get(sectionId);
      if (!section) {
        return [];
      }
      const fileName = getFileName(section.filePath) ?? section.filePath;
      return [
        {
          filePath: section.filePath,
          line: section.startLine,
          title: stripTags(section.heading).trim() || fileName,
          detail: fileName,
        },
      ];
    });
  return { ...widget, total: notes.length, notes: take(notes) };
}

/** The workspace in six numbers: notes, files, open tasks, tasks, tags, and namespaced tags. */
function buildStatsWidget({ index, widget }: WidgetBuild): DashboardWidget {
  const frontmatterNotes = [...index.files.values()].filter(
    (file) => file.sections.length === 0 && file.frontmatterTags.length > 0,
  ).length;
  const tasks = [...index.tasks.values()];
  return {
    ...widget,
    stats: [
      { label: 'Notes', value: index.sections.size + frontmatterNotes },
      { label: 'Files', value: index.files.size },
      { label: 'Open tasks', value: tasks.filter((task) => !task.completed).length },
      { label: 'Tasks', value: tasks.length },
      { label: 'Tags', value: index.tags.size },
      { label: 'Namespaced tags', value: index.entities.size },
    ],
  };
}

/** A saved search's first notes and open tasks, as its search page finds them; a search since deleted says it is missing. */
function buildSavedQueryWidget({ index, preferences, options, config, widget, count }: WidgetBuild): DashboardWidget {
  const filter = preferences.savedFilters.find(
    (candidate) => candidate.id === config.filterId,
  );
  if (!filter) {
    return { ...widget, missing: true, notes: [], tasks: [], total: 0 };
  }
  const query = getSavedFilterQuery(filter);
  const page = createSearchPageSnapshot(index, preferences, query, {
    tagTitleDisplayMode: options.tagTitleDisplayMode,
    queryContext: options.queryContext,
    // A widget takes its own few entries off the top of the whole
    // result, so its own count, not the reader's page size, is the page.
    pageSize: count,
  });
  return {
    ...widget,
    title: filter.name,
    savedQuery: query,
    ...(filter.page ? { savedPage: filter.page } : {}),
    noteTotal: page.notePaging?.total ?? page.sections.length,
    notes: page.sections.slice(0, count).map((card) => {
      const fileName = getFileName(card.filePath) ?? card.filePath;
      return {
        filePath: card.filePath,
        line: card.startLine,
        title: stripTags(card.heading).trim() || fileName,
        detail: fileName,
      };
    }),
    total: page.taskCounts.active,
    tasks: page.tasks.slice(0, count),
  };
}

/** Today's daily note and its open tasks. */
function buildTodayNoteWidget({ index, options, widget, take }: WidgetBuild): DashboardWidget {
  const today = findTodayNote(index, options.queryContext.now);
  return {
    ...widget,
    today: today.summary,
    total: today.tasks.length,
    tasks: take(today.tasks)
      .map((task) => createDashboardTask(task, index.sections, options.queryContext)),
  };
}

/** Quick add, which writes into today's daily note and needs only what it says about it. */
function buildQuickAddWidget({ index, options, widget }: WidgetBuild): DashboardWidget {
  const today = findTodayNote(index, options.queryContext.now);
  return { ...widget, today: today.summary };
}

/** Open tasks in notes not changed for the widget's days, oldest first. */
function buildStaleTasksWidget({ index, options, config, widget, take }: WidgetBuild): DashboardWidget {
  // A task is as old as the note it is in, as the note dates itself.
  const cutoff = options.queryContext.now - (config.days ?? 30) * DAY;
  const stale = withoutParked([...index.tasks.values()], index)
    .flatMap((task) => {
      const updatedAt =
        index.files.get(task.filePath)?.updatedAt ?? task.updatedAt;
      return !task.completed && updatedAt !== undefined && updatedAt < cutoff
        ? [{ task, updatedAt }]
        : [];
    })
    .sort(
      (left, right) =>
        left.updatedAt - right.updatedAt ||
        left.task.filePath.localeCompare(right.task.filePath) ||
        left.task.lineNumber - right.task.lineNumber,
    );
  return {
    ...widget,
    total: stale.length,
    tasks: take(stale)
      .map(({ task }) => createDashboardTask(task, index.sections, options.queryContext)),
  };
}

/** The notes related to the source note, by shared tags; none without a source note. */
function buildRelatedNotesWidget({ index, options, widget, take }: WidgetBuild): DashboardWidget {
  const filePath = options.sourceNotePath;
  const file = filePath ? index.files.get(filePath) : undefined;
  if (!filePath || !file) {
    return { ...widget, total: 0, notes: [] };
  }
  const settings = options.relatedNotes ?? {
    enableKeywordLinks: true,
    ranking: {},
  };
  const ranked = sortRelatedNotes(
    rankRelatedNotes({
      index,
      activeFilePath: filePath,
      activeFile: file,
      activeTags: collectFileTags(file),
      enableKeywordLinks: settings.enableKeywordLinks,
      tagTitleDisplayMode: 'separate',
      ranking: { ...settings.ranking, now: options.queryContext.now },
    }),
    'tags',
    {},
  );
  return {
    ...widget,
    sourceNote: describeNote(index, filePath),
    total: ranked.length,
    notes: take(ranked).map((note) => ({
      filePath: note.filePath,
      line: note.sourceLine,
      title: stripTags(note.title).trim() || note.fileName,
      detail: [note.fileName]
        .concat(note.matchedTags.map((tag) => tag.label))
        .join(' · '),
    })),
  };
}

/** Tags written together, most often first. */
function buildTagPairsWidget({ index, widget, take }: WidgetBuild): DashboardWidget {
  const pairs = listTagPairs(index);
  return { ...widget, total: pairs.length, tagPairs: take(pairs) };
}

/** Tags used often enough to want a hub note that have none, busiest first. */
function buildUnhubbedTagsWidget({ index, widget, take }: WidgetBuild): DashboardWidget {
  const tags = [...index.tags.values()]
    .filter(
      (tag) =>
        !tag.hubFilePaths?.length &&
        tag.count >= HUB_SUGGESTION_MINIMUM &&
        !isParkedOnlyTag(index, tag.key),
    )
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
  return {
    ...widget,
    total: tags.length,
    tags: take(tags).map((tag) => ({
      key: tag.key,
      label: tag.label,
      detail: describeTagMatches(index, tag.key),
    })),
  };
}

/** Tags first seen within the widget's days, newest first. */
function buildNewTagsWidget({ index, preferences, options, config, widget, take }: WidgetBuild): DashboardWidget {
  const cutoff = options.queryContext.now - (config.days ?? 14) * DAY;
  const firstSeen = preferences.tagFirstSeen ?? {};
  const tags = [...index.tags.values()]
    .flatMap((tag) => {
      const seenAt = firstSeen[tag.key];
      return seenAt !== undefined && seenAt > 0 && seenAt >= cutoff
        ? [{ tag, seenAt }]
        : [];
    })
    .sort(
      (left, right) =>
        right.seenAt - left.seenAt ||
        left.tag.label.localeCompare(right.tag.label),
    );
  return {
    ...widget,
    total: tags.length,
    tags: take(tags).map(({ tag, seenAt }) => ({
      key: tag.key,
      label: tag.label,
      detail: `${describeAge(options.queryContext.now, seenAt)} · ${describeTagMatches(index, tag.key)}`,
    })),
  };
}

/** People and other tags not written for the widget's days, with the namespaces its gear offers. */
function buildQuietPeopleWidget({ index, options, config, widget, take }: WidgetBuild): DashboardWidget {
  const quiet = listQuietTags(index, options.queryContext.now, config.days ?? 90, {
    namespace: config.namespace,
    noOpenTasks: config.noOpenTasks,
  });
  return {
    ...widget,
    // What the gear offers: every namespace the index holds.
    namespaces: [
      ...new Set(
        [...index.entities.values()].map((entity) => String(entity.kind).toLowerCase()),
      ),
      'person',
    ]
      .filter((name, at, all) => all.indexOf(name) === at)
      .sort(),
    total: quiet.length,
    tags: take(quiet).map((person) => ({
      key: person.tag.key,
      label: person.tag.label,
      detail: `${describeLastWritten(options.queryContext.now, person.lastWrittenAt)} · ${
        person.openTasks === 0
          ? describeTagMatches(index, person.tag.key)
          : `${person.openTasks} open ${person.openTasks === 1 ? 'task' : 'tasks'}`
      }`,
    })),
  };
}

/** The pinned notes, each resolved against the index. */
function buildPinnedNotesWidget({ index, preferences, widget, take }: WidgetBuild): DashboardWidget {
  // A pin names an entry, so each row is resolved against the index: the
  // heading it was put on, or the note when that heading is gone.
  const pinned = (preferences.pinnedNotes ?? []).flatMap((pin) => {
    const resolved = resolvePin(index, pin);
    return resolved ? [{ ...resolved, pinKey: pinKey(pin) }] : [];
  });
  return { ...widget, total: pinned.length, notes: take(pinned) };
}

/** Try next's suggestion, when the host chose one. */
function buildTryNextWidget({ options, widget }: WidgetBuild): DashboardWidget {
  return options.tryNext ? { ...widget, tryNext: options.tryNext } : widget;
}

/** Each widget kind's builder. */
const WIDGET_BUILDERS: { readonly [K in DashboardWidgetKind]: WidgetBuilder } = {
  search: buildSearchWidget,
  tasks: buildTasksWidget,
  agenda: buildAgendaWidget,
  favoriteTags: buildFavoriteTagsWidget,
  topTags: buildTopTagsWidget,
  savedSearches: buildSavedSearchesWidget,
  recentSearches: buildRecentSearchesWidget,
  recentNotes: buildRecentNotesWidget,
  stats: buildStatsWidget,
  savedQuery: buildSavedQueryWidget,
  todayNote: buildTodayNoteWidget,
  quickAdd: buildQuickAddWidget,
  staleTasks: buildStaleTasksWidget,
  relatedNotes: buildRelatedNotesWidget,
  tagPairs: buildTagPairsWidget,
  unhubbedTags: buildUnhubbedTagsWidget,
  newTags: buildNewTagsWidget,
  quietPeople: buildQuietPeopleWidget,
  pinnedNotes: buildPinnedNotesWidget,
  tryNext: buildTryNextWidget,
};

/** Today's daily note, when there is one, and its open tasks. */
function findTodayNote(index: WorkspaceIndex, now: number) {
  const date = formatLocalDate(new Date(now));
  const note = listDailyNotes(index).find((entry) => entry.date === date);
  const tasks = note
    ? (index.files.get(note.filePath)?.tasks ?? [])
        .map((task) => index.tasks.get(task.id) ?? task)
        .filter((task) => !task.completed)
    : [];
  return {
    tasks,
    summary: {
      date,
      ...(note ? { filePath: note.filePath } : {}),
      openTaskCount: tasks.length,
    },
  };
}

/** A note by its top heading, or its name, and the folder it is in. */
function describeNote(index: WorkspaceIndex, filePath: string) {
  const file = index.files.get(filePath);
  const heading = file?.sections.find((section) => !section.isInline);
  const fileName = getFileName(filePath) ?? filePath;
  const folder = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : '';
  return {
    filePath,
    line: 1,
    title: (heading ? stripTags(heading.heading).trim() : '') || fileName,
    detail: folder ? `${fileName} · ${folder}` : fileName,
  };
}

/**
 * Every two tags an entry carries together, most often first, counted the way
 * a search for both counts.
 *
 * This used to count only tags written on one line, which is the strongest
 * case and a rare one: in a workspace where tags are written under headings,
 * every pair tied at one and the list came out alphabetical. Counting the
 * entries a search for both finds ranks them, and makes the number beside a
 * pair the number the row opens.
 *
 * Tags written together nearly every time they are written may be one idea
 * under two names, which is what the overlap says.
 */
function listTagPairs(index: WorkspaceIndex) {
  const tagCounts = countTagMatches(index);
  const entriesFor = (tagKey: string): number => {
    const count = tagCounts.get(tagKey);
    return count ? count.notes + count.tasks : 0;
  };
  const pairs: Array<NonNullable<DashboardWidget['tagPairs']>[number]> = [];
  for (const pair of countTagPairMatches(index)) {
    const first = index.tags.get(pair.tags[0]);
    const second = index.tags.get(pair.tags[1]);
    const count = pair.notes + pair.tasks;
    if (!first || !second || count <= 0) {
      continue;
    }
    const rarer = Math.min(entriesFor(first.key), entriesFor(second.key));
    const overlap = rarer > 0 ? Math.min(1, count / rarer) : 0;
    pairs.push({
      tags: [
        { key: first.key, label: first.label },
        { key: second.key, label: second.label },
      ],
      count,
      overlap,
      detail: `${describeEntryCount(pair)} carry both; that is ${Math.round(overlap * 100)}% of the rarer tag's entries`,
    });
  }
  return pairs.sort(
    (left, right) =>
      right.count - left.count ||
      right.overlap - left.overlap ||
      left.tags[0].label.localeCompare(right.tags[0].label) ||
      left.tags[1].label.localeCompare(right.tags[1].label),
  );
}

/** "8 notes", "3 notes and 1 task", for what a pair was counted over. */
function describeEntryCount(pair: { notes: number; tasks: number }): string {
  const parts: string[] = [];
  if (pair.notes > 0) {
    parts.push(`${pair.notes} note${pair.notes === 1 ? '' : 's'}`);
  }
  if (pair.tasks > 0) {
    parts.push(`${pair.tasks} task${pair.tasks === 1 ? '' : 's'}`);
  }
  return parts.join(' and ') || 'Nothing';
}

/** How long ago a name was last written, in whole days. */
function describeLastWritten(now: number, time: number): string {
  const days = Math.floor((now - time) / DAY);
  if (days <= 0) {
    return 'Written today';
  }
  if (days === 1) {
    return 'Written yesterday';
  }
  return days < 365
    ? `Written ${days} days ago`
    : `Written ${Math.floor(days / 365)} ${Math.floor(days / 365) === 1 ? 'year' : 'years'} ago`;
}

/** How long ago a time was, in whole days. */
function describeAge(now: number, time: number): string {
  const days = Math.floor((now - time) / DAY);
  if (days <= 0) {
    return 'First seen today';
  }
  return days === 1 ? 'First seen yesterday' : `First seen ${days} days ago`;
}
