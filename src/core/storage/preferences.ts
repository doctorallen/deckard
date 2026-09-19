import * as vscode from 'vscode';

import {
  PersistedPreferences,
  DEFAULT_SEARCH_PAGE_SIZE,
  SearchPageSize,
  SEARCH_PAGE_SIZES,
  TagOverviewLayout,
  RelatedNotesSortMode,
  RenderMode,
  SavedFilter,
  TagOverviewSortMode,
  TagSortMode,
  TaskSortMode,
  DashboardColumnCount,
  DashboardMode,
  DashboardSearchField,
  DashboardViewState,
  DashboardWidgetConfig,
  DashboardWidgetKind,
  TaskBoardGroupBy,
  TaskFilter,
  TaskLayout,
} from '../types';

const preferencesKey = 'deckard.preferences';
const defaultPreferences: PersistedPreferences = {
  version: 1,
  favoriteTags: [],
  favoriteEntities: [],
  tagSortMode: 'alphabetical',
  entitySortMode: 'alphabetical',
  tagAccessOrder: [],
  tagAccessCounts: {},
  entityAccessOrder: [],
  entityAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank',
  dashboardTaskColumns: 1,
  dashboardNoteColumns: 1,
  dashboardTagColumns: 2,
  dashboardViewState: {
    mode: 'home',
    tagSearchQuery: '',
  },
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  searchPageSize: DEFAULT_SEARCH_PAGE_SIZE,
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [],
  taskBoardLayout: 'board',
  taskBoardGroup: 'status',
  taskBoardTaskFilter: 'active',
  tagAccessTimes: {},
  sectionAccessTimes: {},
  recentQueries: [],
  // Filled with DEFAULT_DASHBOARD_WIDGETS when preferences are read.
  dashboardWidgets: [],
};
/** Whether a stored value is one of the page sizes a search page offers. */
function isSearchPageSize(value: unknown): value is SearchPageSize {
  return (SEARCH_PAGE_SIZES as readonly unknown[]).includes(value);
}

/** How many recent searches are kept. */
export const RECENT_QUERY_LIMIT = 20;

/** The widgets Home starts with, and returns to on Reset. */
export const DEFAULT_DASHBOARD_WIDGETS: readonly DashboardWidgetConfig[] = [
  { id: 'search', kind: 'search', width: 'full' },
  { id: 'tasks', kind: 'tasks', width: 'half', count: 5, query: 'is:open' },
  { id: 'agenda', kind: 'agenda', width: 'half', count: 5 },
  { id: 'favoriteTags', kind: 'favoriteTags', width: 'half', count: 8 },
  { id: 'savedSearches', kind: 'savedSearches', width: 'half' },
];

/** The widgets Home can show, and whether a page may hold more than one. */
/**
 * What each kind of widget can do. `listed` widgets show a number of entries
 * and offer a count; of those, all but two can be paged through — the Agenda
 * counts each of its groups separately, and a saved search lists notes
 * beside tasks, so neither is one list for a page number to walk.
 */
export const DASHBOARD_WIDGET_KINDS: Readonly<
  Record<
    DashboardWidgetKind,
    { repeatable: boolean; listed: boolean; pageable?: false }
  >
> = {
  search: { repeatable: false, listed: false },
  tasks: { repeatable: true, listed: true },
  agenda: { repeatable: false, listed: true, pageable: false },
  favoriteTags: { repeatable: false, listed: true },
  topTags: { repeatable: false, listed: true },
  savedSearches: { repeatable: false, listed: false },
  recentSearches: { repeatable: false, listed: true },
  recentNotes: { repeatable: false, listed: true },
  stats: { repeatable: false, listed: false },
  savedQuery: { repeatable: true, listed: true, pageable: false },
  todayNote: { repeatable: false, listed: true },
  quickAdd: { repeatable: false, listed: false },
  staleTasks: { repeatable: false, listed: true },
  relatedNotes: { repeatable: false, listed: true },
  tagPairs: { repeatable: false, listed: true },
  unhubbedTags: { repeatable: false, listed: true },
  newTags: { repeatable: false, listed: true },
  quietPeople: { repeatable: false, listed: true },
  pinnedNotes: { repeatable: false, listed: true },
};

/** How many days back each widget that looks back starts at. */
export const DASHBOARD_WIDGET_DEFAULT_DAYS: Readonly<
  Partial<Record<DashboardWidgetKind, number>>
> = {
  staleTasks: 30,
  newTags: 14,
  quietPeople: 90,
};
/** The furthest back a widget can look, in days. */
export const DASHBOARD_WIDGET_DAYS_LIMIT = 365;
/** The most notes Home keeps pinned. */
export const PINNED_NOTE_LIMIT = 50;

/** The most entries a list widget can show. */
export const DASHBOARD_WIDGET_COUNT_LIMIT = 20;
const DASHBOARD_WIDGET_LIMIT = 30;
const DASHBOARD_WIDGET_QUERY_LIMIT = 2000;

/**
 * Persists UI-only state without adding metadata to Markdown notes.
 *
 * Values are normalized at the boundary so old or malformed global state
 * cannot leak unsupported sort modes, duplicate IDs, or invalid access counts.
 */
export class PreferencesStore implements vscode.Disposable {
  private readonly changeEmitter =
    new vscode.EventEmitter<PersistedPreferences>();
  private preferences: PersistedPreferences;
  private updateQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly state: vscode.Memento) {
    this.preferences = normalizePreferences(
      state.get<Partial<PersistedPreferences>>(preferencesKey),
    );
  }

  public readonly onDidChange = this.changeEmitter.event;

  /**
   * Returns a defensive copy because callers use snapshots as freely mutable
   * view-model input while the store must keep its persisted state private.
   */
  public get value(): PersistedPreferences {
    return clonePreferences(this.preferences);
  }

  /**
   * Toggles favorites without coupling tag presentation to note content.
   */
  public async toggleFavorite(tagKey: string): Promise<void> {
    const favorites = new Set(this.preferences.favoriteTags);
    if (favorites.has(tagKey)) {
      favorites.delete(tagKey);
    } else {
      favorites.add(tagKey);
    }
    await this.update({ favoriteTags: [...favorites] });
  }

  public async toggleFavoriteEntity(entityKey: string): Promise<void> {
    const favorites = new Set(this.preferences.favoriteEntities);
    if (favorites.has(entityKey)) {
      favorites.delete(entityKey);
    } else {
      favorites.add(entityKey);
    }
    await this.update({ favoriteEntities: [...favorites] });
  }

  /**
   * Selects the tag ordering policy used by dashboard snapshots.
   */
  public async setTagSortMode(tagSortMode: TagSortMode): Promise<void> {
    await this.update({ tagSortMode });
  }

  public async setEntitySortMode(entitySortMode: TagSortMode): Promise<void> {
    await this.update({ entitySortMode });
  }

  /**
   * Stores custom tag order as a de-duplicated sequence of canonical keys.
   */
  public async setTagAccessOrder(tagAccessOrder: string[]): Promise<void> {
    await this.update({ tagAccessOrder: [...new Set(tagAccessOrder)] });
  }

  public async setEntityAccessOrder(
    entityAccessOrder: string[],
  ): Promise<void> {
    await this.update({ entityAccessOrder: [...new Set(entityAccessOrder)] });
  }

  /**
   * Applies a drag reorder and favorite membership atomically.
   *
   * One persistence event keeps the dashboard from rendering an intermediate
   * order with stale favorite grouping.
   */
  public async setTagAccessOrderAndFavorites(
    tagAccessOrder: string[],
    favoriteTags: string[],
  ): Promise<void> {
    await this.update({
      tagAccessOrder: [...new Set(tagAccessOrder)],
      favoriteTags: [...new Set(favoriteTags)],
    });
  }

  /**
   * Increments usage counts so access sorting reflects actual navigation, and
   * notes the time so recently opened tags rank first in search.
   */
  public async recordTagAccess(tagKey: string, now = Date.now()): Promise<void> {
    const tagAccessCounts = {
      ...this.preferences.tagAccessCounts,
      [tagKey]: (this.preferences.tagAccessCounts[tagKey] ?? 0) + 1,
    };
    const tagAccessTimes = {
      ...this.preferences.tagAccessTimes,
      [tagKey]: now,
    };
    await this.update({ tagAccessCounts, tagAccessTimes });
  }

  /**
   * Keeps a search at the front of the recent list, without duplicates.
   */
  public async recordRecentQuery(query: string): Promise<void> {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }
    const recentQueries = [
      normalized,
      ...(this.preferences.recentQueries ?? []).filter(
        (existing) => existing !== normalized,
      ),
    ].slice(0, RECENT_QUERY_LIMIT);
    if (
      JSON.stringify(recentQueries) !==
      JSON.stringify(this.preferences.recentQueries)
    ) {
      await this.update({ recentQueries });
    }
  }

  public async recordEntityAccess(entityKey: string): Promise<void> {
    const entityAccessCounts = {
      ...this.preferences.entityAccessCounts,
      [entityKey]: (this.preferences.entityAccessCounts[entityKey] ?? 0) + 1,
    };
    await this.update({ entityAccessCounts });
  }

  /**
   * Stores custom task order independently of date-based task sorting.
   */
  /**
   * Keeps a task's place in the rank order when Deckard's own edit rewrites
   * its line. A task's id comes from the text after its checkbox, so stamping
   * a done date on it, or taking one off again, makes it a new task to
   * anything keyed by id, and it would fall to the end of a ranked list.
   */
  public async replaceTaskInOrder(
    previousId: string,
    nextId: string,
  ): Promise<void> {
    const index = this.preferences.taskOrder.indexOf(previousId);
    if (index < 0 || previousId === nextId) {
      return;
    }
    const taskOrder = [...this.preferences.taskOrder];
    taskOrder[index] = nextId;
    await this.update({ taskOrder: [...new Set(taskOrder)] });
  }

  public async setTaskOrder(taskOrder: string[]): Promise<void> {
    await this.update({ taskOrder: [...new Set(taskOrder)] });
  }

  /**
   * Selects rank, creation-date, or update-date task ordering.
   */
  public async setTaskSortMode(taskSortMode: TaskSortMode): Promise<void> {
    await this.update({ taskSortMode });
  }

  /**
   * Persists the independent task and tag grid widths for every Dashboard.
   */
  public async setDashboardColumns(
    section: 'tasks' | 'notes' | 'tags',
    columns: DashboardColumnCount,
  ): Promise<void> {
    await this.update(
      section === 'tasks'
        ? { dashboardTaskColumns: columns }
        : section === 'notes'
          ? { dashboardNoteColumns: columns }
          : { dashboardTagColumns: columns },
    );
  }

  /**
   * Shows the Task Board's tasks as a list or as columns.
   */
  public async setTaskBoardLayout(taskBoardLayout: TaskLayout): Promise<void> {
    await this.update({ taskBoardLayout });
  }

  public async setTaskBoardGroup(
    taskBoardGroup: TaskBoardGroupBy,
  ): Promise<void> {
    await this.update({ taskBoardGroup });
  }

  public async setTaskBoardTaskFilter(
    taskBoardTaskFilter: TaskFilter,
  ): Promise<void> {
    await this.update({ taskBoardTaskFilter });
  }

  /**
   * Replaces Home's widgets. Widgets the store cannot use are dropped, as
   * they are when read back.
   */
  public async setDashboardWidgets(
    dashboardWidgets: readonly DashboardWidgetConfig[],
  ): Promise<void> {
    await this.update({
      dashboardWidgets: normalizeDashboardWidgets(dashboardWidgets),
    });
  }

  public async resetDashboardWidgets(): Promise<void> {
    await this.update({ dashboardWidgets: cloneWidgets(DEFAULT_DASHBOARD_WIDGETS) });
  }

  /** Pins a note to Home, after the notes pinned before it. */
  public async pinNote(filePath: string): Promise<void> {
    const pinnedNotes = this.preferences.pinnedNotes ?? [];
    if (pinnedNotes.includes(filePath) || pinnedNotes.length >= PINNED_NOTE_LIMIT) {
      return;
    }
    await this.update({ pinnedNotes: [...pinnedNotes, filePath] });
  }

  public async unpinNote(filePath: string): Promise<void> {
    await this.update({
      pinnedNotes: (this.preferences.pinnedNotes ?? []).filter(
        (candidate) => candidate !== filePath,
      ),
    });
  }

  public async setDashboardMode(mode: DashboardMode): Promise<void> {
    await this.updateDashboardViewState({ mode });
  }

  public async setDashboardSearch(
    field: DashboardSearchField,
    query: string,
  ): Promise<void> {
    const fieldMap: Record<DashboardSearchField, keyof DashboardViewState> = {
      tags: 'tagSearchQuery',
    };
    await this.updateDashboardViewState({ [fieldMap[field]]: query });
  }

  private async updateDashboardViewState(
    changes: Partial<DashboardViewState>,
  ): Promise<void> {
    await this.update({
      dashboardViewState: normalizeDashboardViewState({
        ...this.preferences.dashboardViewState,
        ...changes,
      }),
    });
  }

  /**
   * Persists whether tag overview bodies should show source or rendered output.
   */
  public async setRenderMode(renderMode: RenderMode): Promise<void> {
    await this.update({ renderMode });
  }

  /**
   * Selects the ordering policy for entries in a tag overview.
   */
  public async setTagOverviewSortMode(
    tagOverviewSortMode: TagOverviewSortMode,
  ): Promise<void> {
    await this.update({ tagOverviewSortMode });
  }

  /**
   * Selects how many results a search page shows at a time, which is kept so
   * the next page opens the way the last one was left.
   */
  public async setSearchPageSize(
    searchPageSize: SearchPageSize,
  ): Promise<void> {
    await this.update({ searchPageSize });
  }

  /**
   * Selects whether overview entries use tabs or a split layout.
   */
  public async setTagOverviewLayout(
    tagOverviewLayout: TagOverviewLayout,
  ): Promise<void> {
    await this.update({ tagOverviewLayout });
  }

  /**
   * Selects the ordering policy for entries in Related Notes.
   */
  public async setRelatedNotesSortMode(
    relatedNotesSortMode: RelatedNotesSortMode,
  ): Promise<void> {
    await this.update({ relatedNotesSortMode });
  }

  /**
   * Increments section usage counts for the overview's access sort.
   */
  public async recordSectionAccess(
    sectionId: string,
    now = Date.now(),
  ): Promise<void> {
    const sectionAccessCounts = {
      ...this.preferences.sectionAccessCounts,
      [sectionId]: (this.preferences.sectionAccessCounts[sectionId] ?? 0) + 1,
    };
    const sectionAccessTimes = {
      ...this.preferences.sectionAccessTimes,
      [sectionId]: now,
    };
    await this.update({ sectionAccessCounts, sectionAccessTimes });
  }

  /**
   * Saves a named multi-tag filter, replacing the existing filter for its
   * canonical tag set so the same overview never creates a duplicate.
   */
  public async saveSavedFilter(
    name: string,
    tagKeys: string[],
  ): Promise<SavedFilter | undefined> {
    const normalizedName = name.trim();
    const normalizedTagKeys = normalizeSavedFilterTagKeys(tagKeys);
    if (!normalizedName || normalizedTagKeys.length < 2) {
      return undefined;
    }

    const existing = this.preferences.savedFilters.find((filter) =>
      areTagKeyListsEqual(filter.tagKeys, normalizedTagKeys),
    );
    const savedFilter: SavedFilter = {
      id: existing?.id ?? createSavedFilterId(),
      name: normalizedName,
      tagKeys: normalizedTagKeys,
    };
    await this.update({
      savedFilters: existing
        ? this.preferences.savedFilters.map((filter) =>
            filter.id === existing.id ? savedFilter : filter,
          )
        : [...this.preferences.savedFilters, savedFilter],
    });
    return cloneSavedFilter(savedFilter);
  }

  /**
   * Moves everything held under a renamed or merged tag to its new key, so
   * favorites, ranking, Dashboard selections, and saved views follow the tag.
   */
  public async replaceTagKey(
    sourceKey: string,
    targetKey: string,
  ): Promise<void> {
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      return;
    }
    const replaceKeys = (keys: readonly string[]): string[] => [
      ...new Set(keys.map((key) => (key === sourceKey ? targetKey : key))),
    ];
    const moveCount = (
      counts: Record<string, number>,
    ): Record<string, number> => {
      const { [sourceKey]: moved, ...rest } = counts;
      return moved === undefined
        ? rest
        : { ...rest, [targetKey]: (rest[targetKey] ?? 0) + moved };
    };
    const { [sourceKey]: movedTime, ...tagAccessTimes } =
      this.preferences.tagAccessTimes ?? {};
    // A tag renamed to a new name is no newer than it was; merged into a tag
    // that exists, it takes that tag's time.
    const firstSeen = this.preferences.tagFirstSeen;
    const movedFirstSeen = firstSeen?.[sourceKey];

    await this.update({
      favoriteTags: replaceKeys(this.preferences.favoriteTags),
      favoriteEntities: replaceKeys(this.preferences.favoriteEntities),
      tagAccessOrder: replaceKeys(this.preferences.tagAccessOrder),
      entityAccessOrder: replaceKeys(this.preferences.entityAccessOrder),
      tagAccessCounts: moveCount(this.preferences.tagAccessCounts),
      entityAccessCounts: moveCount(this.preferences.entityAccessCounts),
      tagAccessTimes:
        movedTime === undefined
          ? tagAccessTimes
          : {
              ...tagAccessTimes,
              [targetKey]: Math.max(movedTime, tagAccessTimes[targetKey] ?? 0),
            },
      ...(firstSeen && movedFirstSeen !== undefined
        ? {
            tagFirstSeen: {
              ...firstSeen,
              [targetKey]: firstSeen[targetKey] ?? movedFirstSeen,
            },
          }
        : {}),
      dashboardWidgets: this.preferences.dashboardWidgets.map((widget) =>
        widget.query
          ? { ...widget, query: replaceTagInQuery(widget.query, sourceKey, targetKey) }
          : widget,
      ),
      // A tag-set view needs two tags; a query view keeps its own text.
      savedFilters: this.preferences.savedFilters.flatMap((filter) => {
        if (filter.query || !filter.tagKeys.includes(sourceKey)) {
          return [filter];
        }
        const tagKeys = normalizeSavedFilterTagKeys(
          replaceKeys(filter.tagKeys),
        );
        return tagKeys.length >= 2 ? [{ ...filter, tagKeys }] : [];
      }),
    });
  }

  /**
   * Saves a named advanced query, replacing the existing filter that already
   * stores the same query text.
   */
  public async saveSavedQueryFilter(
    name: string,
    query: string,
    page?: 'taskBoard',
  ): Promise<SavedFilter | undefined> {
    const normalizedName = name.trim();
    const normalizedQuery = query.trim();
    if (!normalizedName || !normalizedQuery) {
      return undefined;
    }

    // The same search saved on the Task Board is a different view, since it
    // reopens there.
    const existing = this.preferences.savedFilters.find(
      (filter) =>
        filter.query?.trim() === normalizedQuery && filter.page === page,
    );
    const savedFilter: SavedFilter = {
      id: existing?.id ?? createSavedFilterId(),
      name: normalizedName,
      tagKeys: [],
      query: normalizedQuery,
      ...(page ? { page } : {}),
    };
    await this.update({
      savedFilters: existing
        ? this.preferences.savedFilters.map((filter) =>
            filter.id === existing.id ? savedFilter : filter,
          )
        : [...this.preferences.savedFilters, savedFilter],
    });
    return cloneSavedFilter(savedFilter);
  }

  /**
   * Updates one saved filter when its stable ID still identifies a valid entry.
   */
  public async updateSavedFilter(
    id: string,
    name: string,
    tagKeys: string[],
  ): Promise<SavedFilter | undefined> {
    const normalizedName = name.trim();
    const normalizedTagKeys = normalizeSavedFilterTagKeys(tagKeys);
    if (!id || !normalizedName || normalizedTagKeys.length < 2) {
      return undefined;
    }
    const existing = this.preferences.savedFilters.find(
      (filter) => filter.id === id,
    );
    if (!existing) {
      return undefined;
    }

    const matchingFilter = this.preferences.savedFilters.find(
      (filter) =>
        filter.id !== id &&
        areTagKeyListsEqual(filter.tagKeys, normalizedTagKeys),
    );
    const savedFilter: SavedFilter = {
      id,
      name: normalizedName,
      tagKeys: normalizedTagKeys,
    };
    await this.update({
      savedFilters: this.preferences.savedFilters
        .filter((filter) => filter.id !== matchingFilter?.id)
        .map((filter) => (filter.id === id ? savedFilter : filter)),
    });
    return cloneSavedFilter(savedFilter);
  }

  /**
   * Removes a saved filter by its opaque stable ID.
   */
  public async removeSavedFilter(id: string): Promise<void> {
    if (!id) {
      return;
    }
    await this.update({
      savedFilters: this.preferences.savedFilters.filter(
        (filter) => filter.id !== id,
      ),
      dashboardWidgets: this.preferences.dashboardWidgets.filter(
        (widget) => widget.kind !== 'savedQuery' || widget.filterId !== id,
      ),
    });
  }

  /**
   * Removes state for deleted index entries so preferences do not grow forever.
   */
  public async prune(
    validTagKeys: Iterable<string>,
    validTaskIds: Iterable<string>,
    validSectionIds?: Iterable<string>,
    validEntityKeys?: Iterable<string>,
    validFilePaths?: Iterable<string>,
    now = Date.now(),
  ): Promise<void> {
    const validTags = new Set(validTagKeys);
    const validTasks = new Set(validTaskIds);
    const validSections = validSectionIds
      ? new Set(validSectionIds)
      : undefined;
    const validEntities = validEntityKeys
      ? new Set(validEntityKeys)
      : undefined;
    const sectionAccessCounts = validSectionIds
      ? Object.fromEntries(
          Object.entries(this.preferences.sectionAccessCounts).filter(
            ([sectionId]) => validSections?.has(sectionId) ?? false,
          ),
        )
      : this.preferences.sectionAccessCounts;
    const tagAccessCounts = Object.fromEntries(
      Object.entries(this.preferences.tagAccessCounts).filter(([tagKey]) =>
        validTags.has(tagKey),
      ),
    );
    const tagAccessTimes = Object.fromEntries(
      Object.entries(this.preferences.tagAccessTimes ?? {}).filter(([tagKey]) =>
        validTags.has(tagKey),
      ),
    );
    const sectionAccessTimes = validSections
      ? Object.fromEntries(
          Object.entries(this.preferences.sectionAccessTimes ?? {}).filter(
            ([sectionId]) => validSections.has(sectionId),
          ),
        )
      : this.preferences.sectionAccessTimes;
    const savedFilters = this.preferences.savedFilters.flatMap((filter) => {
      // A saved query can name tags that do not exist yet, or none at all, so
      // only tag-set filters are pruned against the index.
      if (filter.query) {
        return [filter];
      }
      const tagKeys = filter.tagKeys.filter((tagKey) => validTags.has(tagKey));
      return tagKeys.length >= 2
        ? [{ ...filter, tagKeys: normalizeSavedFilterTagKeys(tagKeys) }]
        : [];
    });
    const savedFilterIds = new Set(savedFilters.map((filter) => filter.id));
    // Every tag in the first index is known; a tag seen after that is new
    // from the moment it is seen, until it is gone again.
    const previousFirstSeen = this.preferences.tagFirstSeen;
    const tagFirstSeen = Object.fromEntries(
      [...validTags].map((tagKey) => [
        tagKey,
        previousFirstSeen ? (previousFirstSeen[tagKey] ?? now) : 0,
      ]),
    );
    const validFiles = validFilePaths ? new Set(validFilePaths) : undefined;
    const changes: Partial<PersistedPreferences> = {
      dashboardWidgets: this.preferences.dashboardWidgets.filter(
        (widget) =>
          widget.kind !== 'savedQuery' ||
          (widget.filterId !== undefined && savedFilterIds.has(widget.filterId)),
      ),
      favoriteTags: this.preferences.favoriteTags.filter((tagKey) =>
        validTags.has(tagKey),
      ),
      favoriteEntities: this.preferences.favoriteEntities.filter(
        (entityKey) => validEntities?.has(entityKey) ?? true,
      ),
      tagAccessOrder: this.preferences.tagAccessOrder.filter((tagKey) =>
        validTags.has(tagKey),
      ),
      tagAccessCounts,
      tagAccessTimes,
      taskOrder: this.preferences.taskOrder.filter((taskId) =>
        validTasks.has(taskId),
      ),
      sectionAccessCounts,
      sectionAccessTimes,
      entityAccessOrder: this.preferences.entityAccessOrder.filter(
        (entityKey) => validEntities?.has(entityKey) ?? true,
      ),
      entityAccessCounts: Object.fromEntries(
        Object.entries(this.preferences.entityAccessCounts).filter(
          ([entityKey]) => validEntities?.has(entityKey) ?? true,
        ),
      ),
      savedFilters,
      tagFirstSeen,
      pinnedNotes: (this.preferences.pinnedNotes ?? []).filter(
        (filePath) => validFiles?.has(filePath) ?? true,
      ),
    };
    // Every index update prunes, and it rarely removes anything. Writing
    // anyway would make every view that follows preferences refresh twice.
    if (this.hasChanges(changes)) {
      await this.update(changes);
    }
  }

  private hasChanges(changes: Partial<PersistedPreferences>): boolean {
    return (
      Object.keys(changes) as Array<keyof PersistedPreferences>
    ).some(
      (key) =>
        JSON.stringify(changes[key]) !== JSON.stringify(this.preferences[key]),
    );
  }

  /**
   * Releases the event source owned by this store.
   */
  public dispose(): void {
    this.changeEmitter.dispose();
  }

  /**
   * Normalizes, persists, and broadcasts one state transition.
   */
  private async update(changes: Partial<PersistedPreferences>): Promise<void> {
    this.preferences = normalizePreferences({
      ...this.preferences,
      ...changes,
    });
    const nextPreferences = clonePreferences(this.preferences);
    const persist = async (): Promise<void> => {
      await this.state.update(preferencesKey, nextPreferences);
      this.changeEmitter.fire(clonePreferences(nextPreferences));
    };
    const queuedUpdate = this.updateQueue.then(persist, persist);
    this.updateQueue = queuedUpdate;
    await queuedUpdate;
  }
}

/**
 * Reconstructs a valid preference shape from persisted or legacy state.
 */
function normalizePreferences(
  value: Partial<PersistedPreferences> | undefined,
): PersistedPreferences {
  const tagSortMode = value?.tagSortMode;
  const entitySortMode = value?.entitySortMode;
  const taskSortMode = value?.taskSortMode;
  const dashboardTaskColumns = value?.dashboardTaskColumns;
  const dashboardNoteColumns = value?.dashboardNoteColumns;
  const dashboardTagColumns = value?.dashboardTagColumns;
  const dashboardViewState = value?.dashboardViewState;
  const renderMode = value?.renderMode;
  const tagOverviewSortMode = value?.tagOverviewSortMode;
  const tagOverviewLayout = value?.tagOverviewLayout;
  const searchPageSize = value?.searchPageSize;
  const relatedNotesSortMode = value?.relatedNotesSortMode;

  return {
    version: 1,
    favoriteTags: uniqueStrings(value?.favoriteTags),
    favoriteEntities: uniqueStrings(value?.favoriteEntities),
    tagSortMode:
      tagSortMode === 'count' ||
      tagSortMode === 'access' ||
      tagSortMode === 'custom'
        ? tagSortMode
        : 'alphabetical',
    entitySortMode:
      entitySortMode === 'count' ||
      entitySortMode === 'access' ||
      entitySortMode === 'custom'
        ? entitySortMode
        : 'alphabetical',
    tagAccessOrder: uniqueStrings(value?.tagAccessOrder),
    tagAccessCounts: normalizeAccessCounts(value?.tagAccessCounts),
    entityAccessOrder: uniqueStrings(value?.entityAccessOrder),
    entityAccessCounts: normalizeAccessCounts(value?.entityAccessCounts),
    taskOrder: uniqueStrings(value?.taskOrder),
    taskSortMode:
      taskSortMode === 'created' || taskSortMode === 'updated'
        ? taskSortMode
        : 'rank',
    dashboardTaskColumns: isDashboardColumnCount(dashboardTaskColumns)
      ? dashboardTaskColumns
      : 1,
    dashboardNoteColumns: isDashboardColumnCount(dashboardNoteColumns)
      ? dashboardNoteColumns
      : 1,
    dashboardTagColumns: isDashboardColumnCount(dashboardTagColumns)
      ? dashboardTagColumns
      : 2,
    dashboardViewState: normalizeDashboardViewState(dashboardViewState),
    renderMode: renderMode === 'html' ? 'html' : 'markdown',
    tagOverviewSortMode:
      tagOverviewSortMode === 'created' ||
      tagOverviewSortMode === 'updated' ||
      tagOverviewSortMode === 'access'
        ? tagOverviewSortMode
        : 'alphabetical',
    tagOverviewLayout: tagOverviewLayout === 'split' ? 'split' : 'tabs',
    searchPageSize: isSearchPageSize(searchPageSize)
      ? searchPageSize
      : DEFAULT_SEARCH_PAGE_SIZE,
    relatedNotesSortMode:
      relatedNotesSortMode === 'newest' ||
      relatedNotesSortMode === 'oldest' ||
      relatedNotesSortMode === 'access'
        ? relatedNotesSortMode
        : 'tags',
    sectionAccessCounts: normalizeAccessCounts(value?.sectionAccessCounts),
    savedFilters: normalizeSavedFilters(value?.savedFilters),
    taskBoardLayout: value?.taskBoardLayout === 'list' ? 'list' : 'board',
    taskBoardGroup:
      value?.taskBoardGroup === 'priority' || value?.taskBoardGroup === 'due'
        ? value.taskBoardGroup
        : 'status',
    taskBoardTaskFilter:
      value?.taskBoardTaskFilter === 'all' ||
      value?.taskBoardTaskFilter === 'completed'
        ? value.taskBoardTaskFilter
        : 'active',
    tagAccessTimes: normalizeAccessTimes(value?.tagAccessTimes),
    sectionAccessTimes: normalizeAccessTimes(value?.sectionAccessTimes),
    recentQueries: uniqueStrings(
      (Array.isArray(value?.recentQueries) ? value.recentQueries : [])
        .filter((query): query is string => typeof query === 'string')
        .map((query) => query.trim()),
    ).slice(0, RECENT_QUERY_LIMIT),
    // Preferences saved before Home had widgets start with its defaults.
    dashboardWidgets: Array.isArray(value?.dashboardWidgets)
      ? normalizeDashboardWidgets(value.dashboardWidgets)
      : cloneWidgets(DEFAULT_DASHBOARD_WIDGETS),
    // Left out until the first index is seen, which marks every tag known.
    ...(typeof value?.tagFirstSeen === 'object' && value.tagFirstSeen !== null
      ? { tagFirstSeen: normalizeFirstSeenTimes(value.tagFirstSeen) }
      : {}),
    pinnedNotes: uniqueStrings(value?.pinnedNotes).slice(0, PINNED_NOTE_LIMIT),
  };
}

/**
 * Keeps only widgets Home can draw: a known kind, a unique id, one of the
 * two widths, and options that kind uses, within their bounds. A kind that
 * cannot repeat keeps its first widget.
 */
export function normalizeDashboardWidgets(
  values: readonly unknown[],
): DashboardWidgetConfig[] {
  const ids = new Set<string>();
  const kinds = new Set<DashboardWidgetKind>();
  const widgets: DashboardWidgetConfig[] = [];
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const candidate = value as Partial<Record<keyof DashboardWidgetConfig, unknown>>;
    const kind = candidate.kind;
    if (typeof kind !== 'string' || !Object.hasOwn(DASHBOARD_WIDGET_KINDS, kind)) {
      continue;
    }
    const widgetKind = kind as DashboardWidgetKind;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const traits = DASHBOARD_WIDGET_KINDS[widgetKind];
    if (
      !id ||
      id.length > 64 ||
      ids.has(id) ||
      (!traits.repeatable && kinds.has(widgetKind))
    ) {
      continue;
    }
    const widget: DashboardWidgetConfig = {
      id,
      kind: widgetKind,
      width: candidate.width === 'full' ? 'full' : 'half',
    };
    if (traits.listed) {
      const count = candidate.count;
      widget.count =
        typeof count === 'number' && Number.isInteger(count)
          ? Math.min(DASHBOARD_WIDGET_COUNT_LIMIT, Math.max(1, count))
          : 5;
    }
    // Only a widget that lists one kind of entry can be paged: the Agenda
    // counts its groups separately, and a saved search lists notes beside
    // tasks, so one page number would not say which list it meant.
    if (traits.listed && traits.pageable !== false) {
      if (candidate.paged === true) {
        widget.paged = true;
        const page = candidate.page;
        widget.page =
          typeof page === 'number' && Number.isInteger(page) && page > 0
            ? Math.min(DASHBOARD_WIDGET_PAGE_LIMIT, page)
            : 1;
      }
    }
    if (widgetKind === 'tasks') {
      widget.query =
        typeof candidate.query === 'string' &&
        candidate.query.length <= DASHBOARD_WIDGET_QUERY_LIMIT
          ? candidate.query.trim()
          : 'is:open';
    }
    const defaultDays = DASHBOARD_WIDGET_DEFAULT_DAYS[widgetKind];
    if (defaultDays !== undefined) {
      const days = candidate.days;
      widget.days =
        typeof days === 'number' && Number.isInteger(days)
          ? Math.min(DASHBOARD_WIDGET_DAYS_LIMIT, Math.max(1, days))
          : defaultDays;
    }
    if (widgetKind === 'savedQuery') {
      if (typeof candidate.filterId !== 'string' || !candidate.filterId) {
        continue;
      }
      widget.filterId = candidate.filterId;
    }
    ids.add(id);
    kinds.add(widgetKind);
    widgets.push(widget);
    if (widgets.length >= DASHBOARD_WIDGET_LIMIT) {
      break;
    }
  }
  return widgets;
}

/**
 * The furthest page a widget may be left on. A page number is clamped to the
 * pages it actually has when it is drawn; this only keeps a stored number
 * from being unreasonable.
 */
const DASHBOARD_WIDGET_PAGE_LIMIT = 10000;

function cloneWidgets(
  widgets: readonly DashboardWidgetConfig[],
): DashboardWidgetConfig[] {
  return widgets.map((widget) => ({ ...widget }));
}

/**
 * A search with one tag renamed where it stands as a whole tag, leaving the
 * rest of what was written alone.
 */
function replaceTagInQuery(
  query: string,
  sourceKey: string,
  targetKey: string,
): string {
  const escaped = sourceKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return query.replace(
    new RegExp(`(^|[\\s(=:-])${escaped}(?=$|[\\s)])`, 'gi'),
    (_match, prefix: string) => `${prefix}${targetKey}`,
  );
}

/**
 * Keeps only positive, finite timestamps.
 */
/** First-seen times, where 0 marks a tag known before times were kept. */
function normalizeFirstSeenTimes(
  values: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, time]) =>
        key.length > 0 && typeof time === 'number' && Number.isFinite(time) && time >= 0,
    ),
  );
}

function normalizeAccessTimes(
  values: Record<string, number> | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(
      typeof values === 'object' && values !== null ? values : {},
    ).filter(
      ([key, time]) =>
        key.length > 0 && typeof time === 'number' && Number.isFinite(time) && time > 0,
    ),
  );
}

function isDashboardColumnCount(
  value: unknown,
): value is DashboardColumnCount {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function normalizeDashboardViewState(
  value: Partial<DashboardViewState> | undefined,
): DashboardViewState {
  // Tasks moved to the Task Board and searches to their own pages, so a
  // Dashboard left on either opens on Home.
  return {
    mode: value?.mode === 'browse' ? 'browse' : 'home',
    tagSearchQuery: normalizeSearchQuery(value?.tagSearchQuery),
  };
}

function normalizeSearchQuery(value: string | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Removes duplicate and empty identifiers before they reach ordering logic.
 */
function uniqueStrings(values: readonly unknown[] | undefined): string[] {
  return [
    ...new Set(
      (Array.isArray(values) ? values : []).filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    ),
  ];
}

/**
 * Keeps only finite-looking persisted counters accepted by the preference API.
 */
function normalizeAccessCounts(
  values: Record<string, number> | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(
      ([key, count]) => key.length > 0 && Number.isInteger(count) && count >= 0,
    ),
  );
}

/**
 * Ensures filters remain valid version-one preference data, even when read
 * from an old or manually modified global-state value.
 */
function normalizeSavedFilters(values: SavedFilter[] | undefined): SavedFilter[] {
  const seenTagSets = new Set<string>();
  const seenIds = new Set<string>();
  return (values ?? []).flatMap((value) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.id !== 'string' ||
      !value.id.trim() ||
      typeof value.name !== 'string'
    ) {
      return [];
    }
    const name = value.name.trim();
    const tagKeys = normalizeSavedFilterTagKeys(value.tagKeys);
    const query =
      typeof value.query === 'string' && value.query.trim()
        ? value.query.trim()
        : undefined;
    // A saved view is identified by its query when it has one and by its tag
    // set otherwise, so the two kinds never collide.
    const page = query && value.page === 'taskBoard' ? value.page : undefined;
    const identity = query
      ? `query\u0000${page ?? ''}\u0000${query}`
      : `tags\u0000${tagKeys.join('\u0000')}`;
    if (
      !name ||
      (!query && tagKeys.length < 2) ||
      seenIds.has(value.id) ||
      seenTagSets.has(identity)
    ) {
      return [];
    }
    seenIds.add(value.id);
    seenTagSets.add(identity);
    return query
      ? [{ id: value.id, name, tagKeys, query, ...(page ? { page } : {}) }]
      : [{ id: value.id, name, tagKeys }];
  });
}

function normalizeSavedFilterTagKeys(tagKeys: unknown): string[] {
  if (!Array.isArray(tagKeys)) {
    return [];
  }
  return [
    ...new Set(
      tagKeys
        .filter(
          (tagKey): tagKey is string =>
            typeof tagKey === 'string' && tagKey.trim().length > 0,
        )
        .map((tagKey) => tagKey.trim()),
    ),
  ].sort();
}

function areTagKeyListsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

function createSavedFilterId(): string {
  return `filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneSavedFilter(value: SavedFilter): SavedFilter {
  return { ...value, tagKeys: [...value.tagKeys] };
}

/**
 * Clones nested arrays and records so a snapshot cannot mutate stored state.
 */
function clonePreferences(value: PersistedPreferences): PersistedPreferences {
  return {
    ...value,
    favoriteTags: [...value.favoriteTags],
    favoriteEntities: [...value.favoriteEntities],
    tagAccessOrder: [...value.tagAccessOrder],
    tagAccessCounts: { ...value.tagAccessCounts },
    entityAccessOrder: [...value.entityAccessOrder],
    entityAccessCounts: { ...value.entityAccessCounts },
    taskOrder: [...value.taskOrder],
    dashboardViewState: { ...value.dashboardViewState },
    sectionAccessCounts: { ...value.sectionAccessCounts },
    savedFilters: value.savedFilters.map(cloneSavedFilter),
    tagAccessTimes: { ...value.tagAccessTimes },
    sectionAccessTimes: { ...value.sectionAccessTimes },
    recentQueries: [...(value.recentQueries ?? [])],
    dashboardWidgets: cloneWidgets(value.dashboardWidgets),
  };
}
