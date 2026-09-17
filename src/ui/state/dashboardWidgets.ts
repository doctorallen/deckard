import { stripTags } from '../../core/markdown/parser';
import { evaluateQuery } from '../../core/query/queryEvaluator';
import { parseQuery } from '../../core/query/queryParser';
import {
  DashboardWidget,
  DashboardWidgetConfig,
  DashboardWidgetKind,
  PersistedPreferences,
  TagTitleDisplayMode,
  WorkspaceIndex,
} from '../../core/types';
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

/** What Home's widgets need beyond the index and preferences. */
export interface DashboardWidgetOptions {
  now: number;
  /** How far ahead the agenda widget looks, from `deckard.agenda.upcomingDays`. */
  upcomingDays: number;
  tagTitleDisplayMode: TagTitleDisplayMode;
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
  return preferences.dashboardWidgets.map((config) =>
    createWidget(index, preferences, options, config),
  );
}

function createWidget(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  options: DashboardWidgetOptions,
  config: DashboardWidgetConfig,
): DashboardWidget {
  const widget: DashboardWidget = {
    ...config,
    title: DASHBOARD_WIDGET_TITLES[config.kind],
  };
  const count = config.count ?? 5;
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
        tasks: tasks
          .slice(0, count)
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
        tags: favorites.slice(0, count).map((tag) => ({
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
        tags: ranked.slice(0, count).map(({ tag }) => ({
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
        queries: queries.slice(0, count),
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
      return { ...widget, total: notes.length, notes: notes.slice(0, count) };
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
  }
}
