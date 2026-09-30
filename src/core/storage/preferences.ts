import type { Disposable, Event } from '../../ports/events';
import type { KeyValueStore } from '../../ports/keyValueStore';

import {
  DashboardColumnCount,
  DashboardMode,
  DashboardSearchField,
  DashboardViewState,
  DashboardWidgetConfig,
  PersistedPreferences,
  PinnedNote,
  RelatedNotesSortMode,
  RenderMode,
  SavedFilter,
  SearchPageSize,
  SearchPreview,
  TagOverviewLayout,
  TagOverviewSortMode,
  TableSort,
  TagSortMode,
  TaskBoardGroupBy,
  TaskColumnId,
  TaskLayout,
  TaskSortMode,
} from '../types';
import {
  areTagKeyListsEqual,
  bumped,
  carryLegacyIds,
  cloneSavedFilter,
  cloneWidgets,
  DEFAULT_DASHBOARD_WIDGETS,
  FIND_CHOICE_LIMIT,
  findChoiceFilePath,
  normalizeDashboardViewState,
  normalizeDashboardWidgets,
  normalizeFindInput,
  normalizePreferences,
  normalizeSavedFilterTagKeys,
  normalizeTableColumns,
  normalizeTableSort,
  PINNED_NOTE_LIMIT,
  pinKey,
  RECENT_HEADING_LIMIT,
  RECENT_QUERY_LIMIT,
  toggled,
  upsertById,
} from './preferencesSchema';
import { PreferencesRepository } from './preferencesRepository';

export {
  carryLegacyIds,
  DASHBOARD_WIDGET_COUNT_LIMIT,
  DASHBOARD_WIDGET_DAYS_LIMIT,
  DASHBOARD_WIDGET_DEFAULT_DAYS,
  DASHBOARD_WIDGET_KINDS,
  DEFAULT_DASHBOARD_WIDGETS,
  FIND_CHOICE_LIMIT,
  findChoiceFilePath,
  isDefaultHomeLayout,
  normalizeDashboardWidgets,
  normalizeFindInput,
  normalizePinnedNotes,
  PINNED_NOTE_LIMIT,
  pinKey,
  RECENT_HEADING_LIMIT,
  RECENT_QUERY_LIMIT,
} from './preferencesSchema';

/** What `findStale` reports: deliberate choices the index no longer backs. */
export interface StalePreferences {
  favoriteTags: string[];
  favoriteEntities: string[];
  pinnedNotes: PinnedNote[];
  savedFilters: SavedFilter[];
}

/**
 * Persists UI-only state without adding metadata to Markdown notes.
 *
 * Values are normalized at the boundary so old or malformed global state
 * cannot leak unsupported sort modes, duplicate IDs, or invalid access counts.
 */
export class PreferencesStore implements Disposable {
  private readonly repository: PreferencesRepository;

  /** Fires after each change is kept, with a copy of the whole blob. */
  public readonly onDidChange: Event<PersistedPreferences>;

  /**
   * Fires when a visit or a carried view count was kept quietly: only Home's
   * Recently opened needs to hear it.
   */
  public readonly onDidRecordVisit: Event<void>;

  /**
   * `workspaceState` carries the preferences that name workspace content. It
   * is left out when no folder is open, where there is no workspace to own
   * them and nothing to index; the store then reads and writes the
   * machine-wide blob alone, as it always did.
   */
  public constructor(state: KeyValueStore, workspaceState?: KeyValueStore) {
    this.repository = new PreferencesRepository(state, workspaceState);
    this.onDidChange = this.repository.onDidChange;
    this.onDidRecordVisit = this.repository.onDidRecordVisit;
  }

  /**
   * Writes a seed taken from the machine-wide store into the workspace, and
   * records that it has been handed over. Call once, after construction.
   */
  public initialize(): Promise<void> {
    return this.repository.initialize();
  }

  /** The blob as it stands, which the methods below read and never mutate. */
  private get preferences(): PersistedPreferences {
    return this.repository.current;
  }

  /**
   * Returns a defensive copy because callers use snapshots as freely mutable
   * view-model input while the store must keep its persisted state private.
   */
  public get value(): PersistedPreferences {
    return this.repository.snapshot();
  }

  /**
   * Toggles favorites without coupling tag presentation to note content.
   */
  public async toggleFavorite(tagKey: string): Promise<void> {
    await this.update({ favoriteTags: toggled(this.preferences.favoriteTags, tagKey) });
  }

  public async toggleFavoriteEntity(entityKey: string): Promise<void> {
    await this.update({ favoriteEntities: toggled(this.preferences.favoriteEntities, entityKey) });
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
    const tagAccessCounts = bumped(this.preferences.tagAccessCounts, tagKey);
    const tagAccessTimes = {
      ...this.preferences.tagAccessTimes,
      [tagKey]: now,
    };
    await this.update({ tagAccessCounts, tagAccessTimes });
  }

  /**
   * Keeps a search at the front of the recent list, without duplicates.
   */
  /**
   * Remembers the result chosen for what was typed, so Find can offer it
   * first the next time the start of it is typed.
   */
  public async recordFindChoice(input: string, key: string, now = Date.now()): Promise<void> {
    const typed = normalizeFindInput(input);
    if (!typed) {
      return;
    }
    const choices = this.preferences.findChoices ?? [];
    const existing = choices.find((choice) => choice.input === typed && choice.key === key);
    const next = [
      { input: typed, key, count: (existing?.count ?? 0) + 1, at: now },
      ...choices.filter((choice) => choice !== existing),
    ];
    await this.update({ findChoices: next.slice(0, FIND_CHOICE_LIMIT) }, true);
  }

  /** Remembers a heading Capture or Move to… went under, newest first. */
  public async recordRecentHeading(pin: PinnedNote): Promise<void> {
    const key = pinKey(pin);
    const recentHeadings = [
      pin,
      ...(this.preferences.recentHeadings ?? []).filter((each) => pinKey(each) !== key),
    ].slice(0, RECENT_HEADING_LIMIT);
    await this.update({ recentHeadings }, true);
  }

  /** Takes one search off the recent list. */
  public async removeRecentQuery(query: string): Promise<void> {
    const recentQueries = (this.preferences.recentQueries ?? []).filter(
      (existing) => existing !== query.trim(),
    );
    if (recentQueries.length !== (this.preferences.recentQueries ?? []).length) {
      await this.update({ recentQueries });
    }
  }

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
    const entityAccessCounts = bumped(this.preferences.entityAccessCounts, entityKey);
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
    namespace?: string,
  ): Promise<void> {
    await this.update(
      taskBoardGroup === 'tag' && namespace
        ? { taskBoardGroup, taskBoardGroupNamespace: namespace.toLowerCase() }
        : { taskBoardGroup },
    );
  }

  /** Chooses the table layout's columns; the title is always among them. */
  public async setTaskTableColumns(columns: TaskColumnId[]): Promise<void> {
    await this.update({ taskTableColumns: normalizeTableColumns(columns) });
  }

  /** Sorts the table layout by a column, or by nothing: the rank order. */
  public async setTaskTableSort(sort: TableSort | undefined): Promise<void> {
    await this.update({ taskTableSort: normalizeTableSort(sort) });
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

  /**
   * Adds a Home widget listing what a saved search finds, unless Home
   * already has one for it. Says which, or that there is no such search.
   */
  public async addSavedSearchWidget(filterId: string): Promise<'added' | 'present' | 'missing'> {
    if (!this.preferences.savedFilters.some((filter) => filter.id === filterId)) {
      return 'missing';
    }
    const widgets = this.preferences.dashboardWidgets;
    if (widgets.some((widget) => widget.kind === 'savedQuery' && widget.filterId === filterId)) {
      return 'present';
    }
    await this.setDashboardWidgets([
      ...widgets,
      {
        id: `savedQuery-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        kind: 'savedQuery',
        width: 'half',
        count: 5,
        filterId,
      },
    ]);
    return 'added';
  }

  public async resetDashboardWidgets(): Promise<void> {
    await this.update({ dashboardWidgets: cloneWidgets(DEFAULT_DASHBOARD_WIDGETS) });
  }

  /** Pins a note to Home, after the notes pinned before it. */
  public async pinNote(pin: PinnedNote): Promise<void> {
    const pinnedNotes = this.preferences.pinnedNotes ?? [];
    if (
      pinnedNotes.some((candidate) => pinKey(candidate) === pinKey(pin)) ||
      pinnedNotes.length >= PINNED_NOTE_LIMIT
    ) {
      return;
    }
    await this.update({ pinnedNotes: [...pinnedNotes, pin] });
  }

  /** Unpins the pin a row names, by the key `pinKey` writes for it. */
  public async unpinNote(key: string): Promise<void> {
    await this.update({
      pinnedNotes: (this.preferences.pinnedNotes ?? []).filter(
        (candidate) => pinKey(candidate) !== key,
      ),
    });
  }

  /** Whether something is already pinned, by its key. */
  public isPinned(key: string): boolean {
    return (this.preferences.pinnedNotes ?? []).some(
      (candidate) => pinKey(candidate) === key,
    );
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
    await this.update({ renderMode, renderModeChosen: true });
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

  /** Selects how much of each result a search page shows. */
  public async setSearchPreview(searchPreview: SearchPreview): Promise<void> {
    await this.update({ searchPreview });
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
   * Leaves daily, weekly, and monthly notes out of Related Notes and Linked
   * from, or lets them back in.
   */
  public async setHideDailyNotes(hide: boolean): Promise<void> {
    await this.update({ hideDailyNotes: hide ? true : undefined });
  }

  /** How many lines of each Related Notes result's excerpt to show: 0, 1, or 2. */
  public async setRelatedNotesPreviewLines(lines: 0 | 1 | 2): Promise<void> {
    await this.update({ relatedNotesPreviewLines: lines === 1 ? undefined : lines });
  }

  /**
   * Increments section usage counts for the overview's access sort.
   */
  public async recordSectionAccess(
    sectionId: string,
    now = Date.now(),
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    const sectionAccessCounts = bumped(this.preferences.sectionAccessCounts, sectionId);
    const sectionAccessTimes = {
      ...this.preferences.sectionAccessTimes,
      [sectionId]: now,
    };
    await this.update({ sectionAccessCounts, sectionAccessTimes }, options.quiet === true);
  }

  /**
   * Moves view counts and times from ids that are gone to the new id of the
   * same heading, summing counts and keeping the later time, in one quiet
   * write. A heading's id changes when a line above it does.
   */
  public async carrySectionAccess(moved: ReadonlyMap<string, string>): Promise<void> {
    const counts = { ...this.preferences.sectionAccessCounts };
    const times = { ...(this.preferences.sectionAccessTimes ?? {}) };
    let changed = false;
    moved.forEach((to, from) => {
      if (from === to || (counts[from] === undefined && times[from] === undefined)) {
        return;
      }
      if (counts[from] !== undefined) {
        counts[to] = (counts[to] ?? 0) + counts[from];
        delete counts[from];
      }
      if (times[from] !== undefined) {
        times[to] = Math.max(times[to] ?? 0, times[from]);
        delete times[from];
      }
      changed = true;
    });
    if (changed) {
      await this.update({ sectionAccessCounts: counts, sectionAccessTimes: times }, true);
    }
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
    await this.update({ savedFilters: upsertById(this.preferences.savedFilters, savedFilter) });
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
    await this.update({ savedFilters: upsertById(this.preferences.savedFilters, savedFilter) });
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
    const validFilePathSet = validFilePaths
      ? new Set(validFilePaths)
      : undefined;
    // Pruning is a garbage collection, and it may only run against an index
    // that is authoritative about what exists. An index holding nothing is
    // not evidence that every tag, note and task was deleted: it is what a
    // window with no folder open reports, which is the state VS Code is in
    // while a VSIX is installed from the Extensions view.
    //
    // A workspace whose notes really were all deleted keeps its preferences
    // instead. They are small, and they come back into use the moment a note
    // does.
    if (
      validTags.size === 0 &&
      validTasks.size === 0 &&
      (validSections?.size ?? 0) === 0 &&
      (validEntities?.size ?? 0) === 0 &&
      (validFilePathSet?.size ?? 0) === 0
    ) {
      return;
    }
    // Ids were widened in 1.23. What was kept under an old id is carried to
    // the new id of the same entry before anything is pruned, so task order
    // and view counts survive the upgrade.
    const current = carryLegacyIds(this.preferences, validTasks, validSections);
    const sectionAccessCounts = validSectionIds
      ? Object.fromEntries(
          Object.entries(current.sectionAccessCounts).filter(
            ([sectionId]) => validSections?.has(sectionId) ?? false,
          ),
        )
      : current.sectionAccessCounts;
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
          Object.entries(current.sectionAccessTimes ?? {}).filter(
            ([sectionId]) => validSections.has(sectionId),
          ),
        )
      : current.sectionAccessTimes;
    // Every tag in the first index is known; a tag seen after that is new
    // from the moment it is seen, until it is gone again.
    const previousFirstSeen = this.preferences.tagFirstSeen;
    const tagFirstSeen = Object.fromEntries(
      [...validTags].map((tagKey) => [
        tagKey,
        previousFirstSeen ? (previousFirstSeen[tagKey] ?? now) : 0,
      ]),
    );
    // Only what Deckard derived is collected here: counts, orders, times,
    // and when a tag was first seen. A favorite, a pin, a saved search and a
    // Home widget were each chosen on purpose, and an index that no longer
    // mentions one is not a reason to throw it away — it is a reason to say
    // so and let the reader decide. `findStale` finds them; the Tidy command
    // asks.
    // A choice whose note or tag is gone is forgotten with it.
    const findChoices = this.preferences.findChoices?.filter((choice) => {
      const filePath = findChoiceFilePath(choice.key);
      if (filePath !== undefined) {
        return validFilePathSet?.has(filePath) ?? true;
      }
      return choice.key.startsWith('tag:') ? validTags.has(choice.key.slice(4)) : true;
    });
    const recentHeadings = this.preferences.recentHeadings?.filter(
      (pin) => validFilePathSet?.has(pin.filePath) ?? true,
    );
    const changes: Partial<PersistedPreferences> = {
      ...(findChoices ? { findChoices } : {}),
      ...(recentHeadings ? { recentHeadings } : {}),
      tagAccessOrder: this.preferences.tagAccessOrder.filter((tagKey) =>
        validTags.has(tagKey),
      ),
      tagAccessCounts,
      tagAccessTimes,
      taskOrder: current.taskOrder.filter((taskId) => validTasks.has(taskId)),
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
      tagFirstSeen,
    };
    // Every index update prunes, and it rarely removes anything. Writing
    // anyway would make every view that follows preferences refresh twice.
    if (this.hasChanges(changes)) {
      await this.update(changes);
    }
  }

  /**
   * The deliberate choices that point at nothing the index has any more: a
   * favorite whose tag is gone, a pin whose note is gone, a tag-set search
   * left with fewer than two of its tags. Nothing here is removed by Deckard
   * on its own; the Tidy command shows the list and asks.
   *
   * A saved query is never stale: it can name tags that do not exist yet.
   */
  public findStale(
    validTagKeys: Iterable<string>,
    validEntityKeys: Iterable<string>,
    validFilePaths: Iterable<string>,
  ): StalePreferences {
    const validTags = new Set(validTagKeys);
    const validEntities = new Set(validEntityKeys);
    const validFiles = new Set(validFilePaths);
    return {
      favoriteTags: this.preferences.favoriteTags.filter(
        (tagKey) => !validTags.has(tagKey),
      ),
      favoriteEntities: this.preferences.favoriteEntities.filter(
        (entityKey) => !validEntities.has(entityKey),
      ),
      pinnedNotes: (this.preferences.pinnedNotes ?? []).filter(
        (pin) => !validFiles.has(pin.filePath),
      ),
      savedFilters: this.preferences.savedFilters.filter(
        (filter) =>
          !filter.query &&
          filter.tagKeys.filter((tagKey) => validTags.has(tagKey)).length < 2,
      ),
    };
  }

  /** Removes what `findStale` found, once a reader has agreed to it. */
  public async removeStale(stale: StalePreferences): Promise<void> {
    const tags = new Set(stale.favoriteTags);
    const entities = new Set(stale.favoriteEntities);
    const pins = new Set(stale.pinnedNotes.map(pinKey));
    const filters = new Set(stale.savedFilters.map((filter) => filter.id));
    if (!tags.size && !entities.size && !pins.size && !filters.size) {
      return;
    }
    await this.update({
      favoriteTags: this.preferences.favoriteTags.filter((key) => !tags.has(key)),
      favoriteEntities: this.preferences.favoriteEntities.filter(
        (key) => !entities.has(key),
      ),
      pinnedNotes: (this.preferences.pinnedNotes ?? []).filter(
        (pin) => !pins.has(pinKey(pin)),
      ),
      savedFilters: this.preferences.savedFilters.filter(
        (filter) => !filters.has(filter.id),
      ),
      // A widget that showed a removed search leaves Home with it.
      dashboardWidgets: this.preferences.dashboardWidgets.filter(
        (widget) =>
          widget.kind !== 'savedQuery' ||
          widget.filterId === undefined ||
          !filters.has(widget.filterId),
      ),
    });
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
   * Releases the event sources owned by this store.
   */
  public dispose(): void {
    this.repository.dispose();
  }

  /**
   * Stores a change. A quiet one is kept without telling every open page,
   * since a visit recorded on each note switch would redraw them all; only
   * `onDidRecordVisit` hears of it.
   */
  private update(
    changes: Partial<PersistedPreferences>,
    quiet = false,
  ): Promise<void> {
    return this.repository.update(changes, quiet);
  }

  /**
   * Replaces everything this store holds with a blob read back from an
   * export or a copy Deckard kept. It is normalized on the way in, so a file
   * from an older Deckard, or one that was edited by hand, cannot leave the
   * store holding a shape the views do not expect.
   */
  public async importPreferences(value: PersistedPreferences): Promise<void> {
    await this.update(normalizePreferences(value));
  }
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

function createSavedFilterId(): string {
  return `filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
