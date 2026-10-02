import { EntityNamespaceAliases, getEntityNamespace } from '../../domain/markdown/parser';
import { QueryContext } from '../../domain/query/queryContext';
import { parseQuery } from '../../domain/query/queryParser';
import { createAgenda, normalizeAgendaQuery, selectAgendaTasks } from './agendaState';
import { baseCollator } from './entryCards';
import { resolveQueryTags } from './querySuggestions';
import { listFrontmatterOnlyFiles } from './searchPageState';
import {
  Entity,
  PersistedPreferences,
  TagInfo,
  Task,
  TagTitleDisplayMode,
  TagReference,
  WorkspaceIndex,
} from '../../domain/model';
import { DashboardSavedFilter, DashboardSnapshot, TaskGlance } from '../protocol/dashboard';

/** What the dashboard model is projected from. */
export interface DashboardSnapshotOptions {
  index: WorkspaceIndex;
  preferences: PersistedPreferences;
  selectedTag?: string;
  /** How a tag in a title is drawn; inline by default. */
  tagTitleDisplayMode?: TagTitleDisplayMode;
  /** The Tasks view's search, which the task glance counts within. */
  agendaQuery?: string;
  /** The settings and moment the task counts are taken in. */
  queryContext: QueryContext;
}

/**
 * The namespace the Tags tab shows a tag under, read as the index reads an
 * entity's kind (getEntityKind, through the parser's getEntityNamespace):
 * aliases resolved, as `#organization/acme` is `org`, and lowercased. The
 * page used to read the key's namespace itself, as written, so a key the
 * parser reads another way was grouped and named apart from its entity.
 * An @ tag is a person's, as its entity is.
 */
function readDashboardTagNamespace(tag: TagReference): string {
  return tag.key.startsWith('@') ? 'person' : (getEntityNamespace(tag) ?? '');
}

/**
 * Projects one consistent dashboard model from the index and UI-only state,
 * its task counts taken in `queryContext`.
 */
export function createDashboardSnapshot({
  index,
  preferences,
  selectedTag,
  tagTitleDisplayMode = 'inline',
  agendaQuery,
  queryContext,
}: DashboardSnapshotOptions): DashboardSnapshot {
  return {
    taskGlance: createTaskGlance(index, agendaQuery ?? '', queryContext),
    // The page reads a tag's name, count, and heart; the entry lists each
    // one carried ran to megabytes in a large workspace and were never read.
    tags: sortTags(index.tags.values(), preferences).map((tag) => ({
      key: tag.key,
      label: tag.label,
      count: tag.count,
      isFavorite: tag.isFavorite,
      namespace: readDashboardTagNamespace(tag),
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
    savedFilters: createDashboardSavedFilters(index, preferences, queryContext.entityNamespaceAliases),
    widgetConfig: preferences.dashboardWidgets.map((widget) => ({ ...widget })),
  };
}

/**
 * Home's tiles, counted as the Tasks view and the status bar count: Overdue
 * and Today are its groups, and Open every open task the agenda's search
 * lists. Each search is scoped by that search too, so the tile's number and
 * the page it opens say the same thing. Today is the context's.
 */
export function createTaskGlance(
  index: WorkspaceIndex,
  agendaQuery: string,
  context: QueryContext,
): TaskGlance {
  const selected = selectAgendaTasks(index, agendaQuery, context);
  const groups = createAgenda(index, context, { tasks: selected.tasks, upcomingDays: 1 });
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
 * The saved views, with their tags resolved against the index, a saved
 * query's through `entityNamespaceAliases` as the index read the notes. A
 * saved query keeps its place even when the tags it names are not in the
 * index yet; a saved tag set needs two tags that still exist.
 */
export function createDashboardSavedFilters(
  index: WorkspaceIndex,
  preferences: PersistedPreferences,
  entityNamespaceAliases?: EntityNamespaceAliases,
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
          tags: resolveQueryTags(index, parseQuery(filter.query), entityNamespaceAliases),
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

/**
 * Orders entities with favorites first, then by the reader's chosen mode:
 * count, access, or their own order, with the name as the tie-breaker. The
 * entities are copied, so the index is left as it was.
 */
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
