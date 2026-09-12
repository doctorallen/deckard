import * as vscode from 'vscode';

import {
  PersistedPreferences,
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
  TaskFilter,
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
  dashboardNoteSortMode: 'alphabetical',
  dashboardViewState: {
    mode: 'tasks',
    taskFilter: 'active',
    selectedTaskTags: [],
    selectedNoteTags: [],
    taskSearchQuery: '',
    noteSearchQuery: '',
    tagSearchQuery: '',
    taskTagQuery: '',
    noteTagQuery: '',
  },
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [],
};

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
   * Increments usage counts so access sorting reflects actual navigation.
   */
  public async recordTagAccess(tagKey: string): Promise<void> {
    const tagAccessCounts = {
      ...this.preferences.tagAccessCounts,
      [tagKey]: (this.preferences.tagAccessCounts[tagKey] ?? 0) + 1,
    };
    await this.update({ tagAccessCounts });
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

  public async setDashboardNoteSortMode(
    dashboardNoteSortMode: TagOverviewSortMode,
  ): Promise<void> {
    await this.update({ dashboardNoteSortMode });
  }

  public async setDashboardMode(mode: DashboardMode): Promise<void> {
    await this.updateDashboardViewState({ mode });
  }

  public async setDashboardTaskFilter(taskFilter: TaskFilter): Promise<void> {
    await this.updateDashboardViewState({ taskFilter });
  }

  public async setDashboardTaskTags(selectedTaskTags: string[]): Promise<void> {
    await this.updateDashboardViewState({ selectedTaskTags });
  }

  public async setDashboardNoteTags(selectedNoteTags: string[]): Promise<void> {
    await this.updateDashboardViewState({ selectedNoteTags });
  }

  public async setDashboardSearch(
    field: DashboardSearchField,
    query: string,
  ): Promise<void> {
    const fieldMap: Record<DashboardSearchField, keyof DashboardViewState> = {
      tasks: 'taskSearchQuery',
      notes: 'noteSearchQuery',
      tags: 'tagSearchQuery',
      taskTags: 'taskTagQuery',
      noteTags: 'noteTagQuery',
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
  public async recordSectionAccess(sectionId: string): Promise<void> {
    const sectionAccessCounts = {
      ...this.preferences.sectionAccessCounts,
      [sectionId]: (this.preferences.sectionAccessCounts[sectionId] ?? 0) + 1,
    };
    await this.update({ sectionAccessCounts });
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
    const savedFilters = this.preferences.savedFilters.flatMap((filter) => {
      const tagKeys = filter.tagKeys.filter((tagKey) => validTags.has(tagKey));
      return tagKeys.length >= 2
        ? [{ ...filter, tagKeys: normalizeSavedFilterTagKeys(tagKeys) }]
        : [];
    });
    await this.update({
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
      taskOrder: this.preferences.taskOrder.filter((taskId) =>
        validTasks.has(taskId),
      ),
      sectionAccessCounts,
      entityAccessOrder: this.preferences.entityAccessOrder.filter(
        (entityKey) => validEntities?.has(entityKey) ?? true,
      ),
      entityAccessCounts: Object.fromEntries(
        Object.entries(this.preferences.entityAccessCounts).filter(
          ([entityKey]) => validEntities?.has(entityKey) ?? true,
        ),
      ),
      savedFilters,
    });
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
  const dashboardNoteSortMode = value?.dashboardNoteSortMode;
  const dashboardViewState = value?.dashboardViewState;
  const renderMode = value?.renderMode;
  const tagOverviewSortMode = value?.tagOverviewSortMode;
  const tagOverviewLayout = value?.tagOverviewLayout;
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
    dashboardNoteSortMode:
      dashboardNoteSortMode === 'created' ||
      dashboardNoteSortMode === 'updated' ||
      dashboardNoteSortMode === 'access'
        ? dashboardNoteSortMode
        : 'alphabetical',
    dashboardViewState: normalizeDashboardViewState(dashboardViewState),
    renderMode: renderMode === 'html' ? 'html' : 'markdown',
    tagOverviewSortMode:
      tagOverviewSortMode === 'created' ||
      tagOverviewSortMode === 'updated' ||
      tagOverviewSortMode === 'access'
        ? tagOverviewSortMode
        : 'alphabetical',
    tagOverviewLayout: tagOverviewLayout === 'split' ? 'split' : 'tabs',
    relatedNotesSortMode:
      relatedNotesSortMode === 'newest' ||
      relatedNotesSortMode === 'oldest' ||
      relatedNotesSortMode === 'access'
        ? relatedNotesSortMode
        : 'tags',
    sectionAccessCounts: normalizeAccessCounts(value?.sectionAccessCounts),
    savedFilters: normalizeSavedFilters(value?.savedFilters),
  };
}

function isDashboardColumnCount(
  value: unknown,
): value is DashboardColumnCount {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function normalizeDashboardViewState(
  value: Partial<DashboardViewState> | undefined,
): DashboardViewState {
  const mode = value?.mode;
  const taskFilter = value?.taskFilter;
  return {
    mode:
      mode === 'notes' || mode === 'browse'
        ? mode
        : 'tasks',
    taskFilter:
      taskFilter === 'all' ||
      taskFilter === 'completed'
        ? taskFilter
        : 'active',
    selectedTaskTags: uniqueStrings(value?.selectedTaskTags),
    selectedNoteTags: uniqueStrings(value?.selectedNoteTags),
    taskSearchQuery: normalizeSearchQuery(value?.taskSearchQuery),
    noteSearchQuery: normalizeSearchQuery(value?.noteSearchQuery),
    tagSearchQuery: normalizeSearchQuery(value?.tagSearchQuery),
    taskTagQuery: normalizeSearchQuery(value?.taskTagQuery),
    noteTagQuery: normalizeSearchQuery(value?.noteTagQuery),
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
    const tagSet = tagKeys.join('\u0000');
    if (
      !name ||
      tagKeys.length < 2 ||
      seenIds.has(value.id) ||
      seenTagSets.has(tagSet)
    ) {
      return [];
    }
    seenIds.add(value.id);
    seenTagSets.add(tagSet);
    return [{ id: value.id, name, tagKeys }];
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
    dashboardViewState: {
      ...value.dashboardViewState,
      selectedTaskTags: [...value.dashboardViewState.selectedTaskTags],
      selectedNoteTags: [...value.dashboardViewState.selectedNoteTags],
    },
    sectionAccessCounts: { ...value.sectionAccessCounts },
    savedFilters: value.savedFilters.map(cloneSavedFilter),
  };
}
