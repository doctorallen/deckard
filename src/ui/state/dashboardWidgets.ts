import { stripTags } from '../../core/markdown/parser';
import {
  countTagMatches,
  countTagPairMatches,
  evaluateQuery,
} from '../../core/query/queryEvaluator';
import { parseQuery } from '../../core/query/queryParser';
import {
  DashboardWidget,
  DashboardWidgetConfig,
  DashboardWidgetKind,
  PersistedPreferences,
  ResultPaging,
  TagTitleDisplayMode,
  WorkspaceIndex,
} from '../../core/types';
import { formatLocalDate, listDailyNotes } from '../commands/dailyNote';
import { createAgenda } from './agendaState';
import {
  createDashboardSavedFilters,
  createDashboardTask,
  createQueryViewState,
  createSearchPageSnapshot,
  describeTagMatches,
  getFileName,
  getSavedFilterQuery,
  sortTags,
  sortTasks,
} from './dashboardState';
import { frecencyScore } from './frecency';
import {
  collectFileTags,
  rankRelatedNotes,
  RelatedNotesRankingOptions,
  sortRelatedNotes,
} from './relatedNotesRanking';

const DAY = 24 * 60 * 60 * 1000;
/** How many entries a tag needs before Home suggests it a hub note. */
const HUB_SUGGESTION_MINIMUM = 3;

/** What Home's widgets need beyond the index and preferences. */
export interface DashboardWidgetOptions {
  now: number;
  /** How far ahead the agenda widget looks, from `deckard.agenda.upcomingDays`. */
  upcomingDays: number;
  tagTitleDisplayMode: TagTitleDisplayMode;
  /** The note last open in an editor, which Home can rank by and pin. */
  sourceNotePath?: string;
  /** How Related Notes ranks, from its settings. */
  relatedNotes?: {
    enableKeywordLinks: boolean;
    ranking: RelatedNotesRankingOptions;
  };
}

/** Each widget's heading. A saved-search widget is named after its search. */
export const DASHBOARD_WIDGET_TITLES: Readonly<Record<DashboardWidgetKind, string>> = {
  search: 'Search',
  tasks: 'Tasks',
  agenda: 'Agenda',
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
  pinnedNotes: 'Pinned notes',
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
    // A paged widget works out its own paging while it takes its entries,
    // because only it knows how many it found.
    const paging: { value?: ResultPaging } = {};
    const widget = createWidget(index, preferences, options, config, paging);
    return paging.value ? { ...widget, paging: paging.value } : widget;
  });
}

function createWidget(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  options: DashboardWidgetOptions,
  config: DashboardWidgetConfig,
  paging: { value?: ResultPaging },
): DashboardWidget {
  const widget: DashboardWidget = {
    ...config,
    title: DASHBOARD_WIDGET_TITLES[config.kind],
  };
  const count = config.count ?? 5;
  /**
   * The entries a widget shows: its first few, or one page of them.
   *
   * A page number is clamped rather than refused, because the entries move
   * under it — a task completed elsewhere shortens the list while its last
   * page is open, and the reader should find the last page there.
   */
  const take = <T,>(entries: readonly T[]): T[] => {
    if (!config.paged) {
      return entries.slice(0, count);
    }
    const pageCount = Math.max(Math.ceil(entries.length / count), 1);
    const page = Math.min(Math.max(Math.trunc(config.page ?? 1), 1), pageCount);
    paging.value = { page, size: count, pageCount, total: entries.length };
    const start = (page - 1) * count;
    return entries.slice(start, start + count);
  };
  switch (config.kind) {
    case 'search':
      return {
        ...widget,
        searchState: createQueryViewState(
          index,
          parseQuery(''),
          { notes: 0, tasks: 0 },
          true,
          preferences.recentQueries ?? [],
        ),
      };
    case 'tasks': {
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
      const tasks = sortTasks(
        parsed.node
          ? evaluateQuery(index, parsed.node).tasks
          : [...index.tasks.values()],
        preferences.taskOrder,
        preferences.taskSortMode,
      );
      return {
        ...widget,
        total: tasks.length,
        tasks: take(tasks)
          .map((task) => createDashboardTask(task, index.sections)),
      };
    }
    case 'agenda': {
      const groups = createAgenda(index, options.now, options.upcomingDays);
      return {
        ...widget,
        total: groups.reduce((sum, group) => sum + group.entries.length, 0),
        agenda: groups.map((group) => ({
          id: group.id,
          label: group.label,
          count: group.entries.length,
          tasks: group.entries
            .slice(0, count)
            .map((entry) => createDashboardTask(entry.task, index.sections)),
        })),
      };
    }
    case 'favoriteTags': {
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
    case 'topTags': {
      const ranked = [...index.tags.values()]
        .map((tag) => ({
          tag,
          score: frecencyScore(
            preferences.tagAccessCounts[tag.key] ?? 0,
            preferences.tagAccessTimes?.[tag.key],
            options.now,
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
    case 'savedSearches': {
      const savedFilters = createDashboardSavedFilters(index, preferences);
      return { ...widget, total: savedFilters.length, savedFilters };
    }
    case 'recentSearches': {
      const queries = preferences.recentQueries ?? [];
      return {
        ...widget,
        total: queries.length,
        queries: take(queries),
      };
    }
    case 'recentNotes': {
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
    case 'stats': {
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
          { label: 'Entities', value: index.entities.size },
        ],
      };
    }
    case 'savedQuery': {
      const filter = preferences.savedFilters.find(
        (candidate) => candidate.id === config.filterId,
      );
      if (!filter) {
        return { ...widget, missing: true, notes: [], tasks: [], total: 0 };
      }
      const query = getSavedFilterQuery(filter);
      const page = createSearchPageSnapshot(index, preferences, query, {
        taskFilter: 'active',
        tagTitleDisplayMode: options.tagTitleDisplayMode,
        now: options.now,
        // A widget takes its own few entries off the top of the whole
        // result, so it is not the reader's page size that decides what it
        // has to choose from.
        paged: false,
      });
      return {
        ...widget,
        title: filter.name,
        savedQuery: query,
        ...(filter.page ? { savedPage: filter.page } : {}),
        noteTotal: page.sections.length,
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
    case 'todayNote':
    case 'quickAdd': {
      const today = findTodayNote(index, options.now);
      if (config.kind === 'quickAdd') {
        return { ...widget, today: today.summary };
      }
      return {
        ...widget,
        today: today.summary,
        total: today.tasks.length,
        tasks: take(today.tasks)
          .map((task) => createDashboardTask(task, index.sections)),
      };
    }
    case 'staleTasks': {
      // A task is as old as the note it is in, as the note dates itself.
      const cutoff = options.now - (config.days ?? 30) * DAY;
      const stale = [...index.tasks.values()]
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
          .map(({ task }) => createDashboardTask(task, index.sections)),
      };
    }
    case 'relatedNotes': {
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
        rankRelatedNotes(
          index,
          filePath,
          file,
          collectFileTags(file),
          settings.enableKeywordLinks,
          'separate',
          undefined,
          settings.ranking,
        ),
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
    case 'tagPairs': {
      const pairs = listTagPairs(index);
      return { ...widget, total: pairs.length, tagPairs: take(pairs) };
    }
    case 'unhubbedTags': {
      const tags = [...index.tags.values()]
        .filter(
          (tag) =>
            !tag.hubFilePaths?.length && tag.count >= HUB_SUGGESTION_MINIMUM,
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
    case 'newTags': {
      const cutoff = options.now - (config.days ?? 14) * DAY;
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
          detail: `${describeAge(options.now, seenAt)} · ${describeTagMatches(index, tag.key)}`,
        })),
      };
    }
    case 'pinnedNotes': {
      const pinned = (preferences.pinnedNotes ?? []).filter((filePath) =>
        index.files.has(filePath),
      );
      const source = options.sourceNotePath;
      return {
        ...widget,
        total: pinned.length,
        notes: take(pinned)
          .map((filePath) => describeNote(index, filePath)),
        ...(source && index.files.has(source)
          ? {
              sourceNote: describeNote(index, source),
              sourcePinned: pinned.includes(source),
            }
          : {}),
      };
    }
  }
}

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

/** How long ago a time was, in whole days. */
function describeAge(now: number, time: number): string {
  const days = Math.floor((now - time) / DAY);
  return days <= 0
    ? 'First seen today'
    : days === 1
      ? 'First seen yesterday'
      : `First seen ${days} days ago`;
}
