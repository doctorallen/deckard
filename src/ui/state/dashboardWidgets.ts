import { isWatchableNamespace, widgetNamespace } from '../../domain/dashboard/widgetCatalog';
import { isOpenTask } from '../../domain/tasks/taskStatuses';
import { collectTagProgress, describeTagProgress, TagProgress } from '../../domain/tasks/tagProgress';
import { isParkedOnlyTag, mentionsParked, withoutParked } from '../../domain/index/parked';
import { stripTags } from '../../domain/markdown/parser';
import { evaluateQuery } from '../../domain/query/queryEvaluator';
import { parseQuery } from '../../domain/query/queryParser';
import { parseWorkspaceQuery } from '../../domain/types/typeQueryFields';
import { QueryContext } from '../../domain/query/queryContext';
import { UPCOMING_DAYS } from '../../domain/tasks/agendaGroups';
import { formatLocalDate, listDailyNotes } from '../../domain/notes/periodicNotes';
import { createAgenda, selectAgendaTasks } from './agendaState';
import { createDashboardSavedFilters, getSavedFilterQuery, sortTags } from './dashboardState';
import { isInNamespace, listQuietTags } from './peopleRecency';
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
  WorkspaceIndex,
} from '../../domain/model';
import { DashboardTryNext, DashboardWidget } from '../protocol/dashboard';

const DAY = 24 * 60 * 60 * 1000;

/** What Home's widgets need beyond the index and preferences. */
export interface DashboardWidgetOptions {
  /**
   * The settings and moment Home is drawn in: what its searches find, how
   * its dates read, and how old its entries are.
   */
  queryContext: QueryContext;
  /** What the agenda widget lists, from `deckard.tasks.viewQuery`. */
  agendaQuery?: string;
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
  savedQuery: 'Saved search',
  todayNote: 'Today',
  quietPeople: 'Gone quiet',
  progress: 'Progress',
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

/**
 * The tasks a widget's search finds, or every task, in the widget's own
 * sort or else the Task Board's; a search that does not parse says why and
 * lists none.
 */
function buildTasksWidget({ index, preferences, options, config, widget, take }: WidgetBuild): DashboardWidget {
  const query = config.query ?? '';
  const parsed = parseWorkspaceQuery(index, query);
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
    config.sort ?? preferences.taskSortMode,
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
    upcomingDays: UPCOMING_DAYS,
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
function buildSavedSearchesWidget({ index, preferences, options, widget }: WidgetBuild): DashboardWidget {
  const savedFilters = createDashboardSavedFilters(index, preferences, options.queryContext.entityNamespaceAliases);
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

/** People and other tags not written for the widget's days, with the namespaces its gear offers. */
function buildQuietPeopleWidget({ index, options, config, widget, take }: WidgetBuild): DashboardWidget {
  const quiet = listQuietTags(index, options.queryContext.now, config.days ?? 90, {
    namespace: config.namespace,
    noOpenTasks: config.noOpenTasks,
  });
  return {
    ...widget,
    namespaces: listWidgetNamespaces(index, 'person'),
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

/**
 * What a namespace widget's gear offers: every namespace the index holds
 * that the host keeps as the one to list, and the kind's default, so a
 * choice is never silently dropped.
 */
function listWidgetNamespaces(index: WorkspaceIndex, fallback: string): string[] {
  return [
    ...new Set(
      [...index.entities.values()].map((entity) => String(entity.kind).toLowerCase()),
    ),
    fallback,
  ]
    .filter((name, at, all) => all.indexOf(name) === at && isWatchableNamespace(name))
    .sort();
}

/**
 * Each tag of the widget's namespace that finds a task, with how far along
 * its tasks are: the unfinished first, those with overdue tasks before the
 * rest, then by the next due date; the finished last.
 */
function buildProgressWidget({ index, options, config, widget, take }: WidgetBuild): DashboardWidget {
  const namespace = widgetNamespace(config);
  const { now, taskPolicy, dateFormats } = options.queryContext;
  const keys = new Set(
    [...index.tags.keys()].filter((key) => isInNamespace(key, namespace) && !isParkedOnlyTag(index, key)),
  );
  const rows = [...collectTagProgress(index, now, keys, taskPolicy)]
    .map(([key, progress]) => ({ tag: index.tags.get(key), progress }))
    .flatMap((row) => (row.tag ? [{ tag: row.tag, progress: row.progress }] : []))
    .sort((left, right) => compareProgress(left.progress, right.progress) || left.tag.label.localeCompare(right.tag.label));
  return {
    ...widget,
    namespaces: listWidgetNamespaces(index, namespace),
    total: rows.length,
    tags: take(rows).map(({ tag, progress }) => ({
      key: tag.key,
      label: tag.label,
      detail: describeTagProgress(progress, now, taskPolicy, dateFormats),
      progress: { done: progress.done, total: progress.total },
    })),
  };
}

/** The order Progress lists tags in: unfinished first, overdue among them first, then soonest due. */
function compareProgress(left: TagProgress, right: TagProgress): number {
  const finished = (progress: TagProgress): number => (progress.done === progress.total ? 1 : 0);
  // A task long past due wants attention as an overdue one does.
  const overdue = (progress: TagProgress): number => (progress.overdue > 0 || progress.needsDate > 0 ? 0 : 1);
  const nextDue = (progress: TagProgress): number => progress.nextDue?.dueAt ?? Number.MAX_SAFE_INTEGER;
  return finished(left) - finished(right) || overdue(left) - overdue(right) || nextDue(left) - nextDue(right);
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
  savedQuery: buildSavedQueryWidget,
  todayNote: buildTodayNoteWidget,
  quietPeople: buildQuietPeopleWidget,
  progress: buildProgressWidget,
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
        .filter(isOpenTask)
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
