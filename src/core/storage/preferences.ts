import * as vscode from 'vscode';

import {
  PersistedPreferences,
  RenderMode,
  TagOverviewSortMode,
  TagSortMode,
  TaskSortMode,
} from '../types';

const preferencesKey = 'deckard.preferences';
const defaultPreferences: PersistedPreferences = {
  version: 1,
  favoriteTags: [],
  tagSortMode: 'alphabetical',
  tagAccessOrder: [],
  tagAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank',
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  sectionAccessCounts: {},
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

  /**
   * Selects the tag ordering policy used by dashboard snapshots.
   */
  public async setTagSortMode(tagSortMode: TagSortMode): Promise<void> {
    await this.update({ tagSortMode });
  }

  /**
   * Stores custom tag order as a de-duplicated sequence of canonical keys.
   */
  public async setTagAccessOrder(tagAccessOrder: string[]): Promise<void> {
    await this.update({ tagAccessOrder: [...new Set(tagAccessOrder)] });
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
   * Removes state for deleted index entries so preferences do not grow forever.
   */
  public async prune(
    validTagKeys: Iterable<string>,
    validTaskIds: Iterable<string>,
    validSectionIds?: Iterable<string>,
  ): Promise<void> {
    const validTags = new Set(validTagKeys);
    const validTasks = new Set(validTaskIds);
    const validSections = validSectionIds
      ? new Set(validSectionIds)
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
    await this.update({
      favoriteTags: this.preferences.favoriteTags.filter((tagKey) =>
        validTags.has(tagKey),
      ),
      tagAccessOrder: this.preferences.tagAccessOrder.filter((tagKey) =>
        validTags.has(tagKey),
      ),
      tagAccessCounts,
      taskOrder: this.preferences.taskOrder.filter((taskId) =>
        validTasks.has(taskId),
      ),
      sectionAccessCounts,
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
    await this.state.update(preferencesKey, this.preferences);
    this.changeEmitter.fire(this.value);
  }
}

/**
 * Reconstructs a valid preference shape from persisted or legacy state.
 */
function normalizePreferences(
  value: Partial<PersistedPreferences> | undefined,
): PersistedPreferences {
  const tagSortMode = value?.tagSortMode;
  const taskSortMode = value?.taskSortMode;
  const renderMode = value?.renderMode;
  const tagOverviewSortMode = value?.tagOverviewSortMode;

  return {
    version: 1,
    favoriteTags: uniqueStrings(value?.favoriteTags),
    tagSortMode:
      tagSortMode === 'count' ||
      tagSortMode === 'access' ||
      tagSortMode === 'custom'
        ? tagSortMode
        : 'alphabetical',
    tagAccessOrder: uniqueStrings(value?.tagAccessOrder),
    tagAccessCounts: normalizeAccessCounts(value?.tagAccessCounts),
    taskOrder: uniqueStrings(value?.taskOrder),
    taskSortMode:
      taskSortMode === 'created' || taskSortMode === 'updated'
        ? taskSortMode
        : 'rank',
    renderMode: renderMode === 'html' ? 'html' : 'markdown',
    tagOverviewSortMode:
      tagOverviewSortMode === 'created' ||
      tagOverviewSortMode === 'updated' ||
      tagOverviewSortMode === 'access'
        ? tagOverviewSortMode
        : 'alphabetical',
    sectionAccessCounts: normalizeAccessCounts(value?.sectionAccessCounts),
  };
}

/**
 * Removes duplicate and empty identifiers before they reach ordering logic.
 */
function uniqueStrings(values: string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? []).filter(
        (value) => typeof value === 'string' && value.length > 0,
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
 * Clones nested arrays and records so a snapshot cannot mutate stored state.
 */
function clonePreferences(value: PersistedPreferences): PersistedPreferences {
  return {
    ...value,
    favoriteTags: [...value.favoriteTags],
    tagAccessOrder: [...value.tagAccessOrder],
    tagAccessCounts: { ...value.tagAccessCounts },
    taskOrder: [...value.taskOrder],
    sectionAccessCounts: { ...value.sectionAccessCounts },
  };
}
