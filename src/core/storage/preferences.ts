import type { Disposable, Event } from '../../ports/events';
import type { KeyValueStore } from '../../ports/keyValueStore';

import type {
  DashboardColumnCount,
  DashboardMode,
  DashboardSearchField,
  DashboardWidgetConfig,
  PersistedPreferences,
  PinnedNote,
  RelatedNotesSortMode,
  RenderMode,
  SavedFilter,
  SearchPageSize,
  SearchPreview,
  TableSort,
  TagOverviewLayout,
  TagOverviewSortMode,
  TagSortMode,
  TaskBoardGroupBy,
  TaskColumnId,
  TaskLayout,
  TaskSortMode,
} from '../../domain/model/preferences';
import { DisplayService } from './preferencesDisplay';
import { FavoritesService } from './preferencesFavorites';
import { HomeWidgetsService } from './preferencesHomeWidgets';
import { PinsService } from './preferencesPins';
import { PreferencesRepository } from './preferencesRepository';
import { SavedSearchesService } from './preferencesSavedSearches';
import {
  carryLegacyIds,
  findChoiceFilePath,
  normalizePreferences,
  pinKey,
} from './preferencesSchema';
import { TagRenames } from './preferencesTagRenames';
import { TaskLayoutService } from './preferencesTaskLayout';
import { UsageService } from './preferencesUsage';

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

  /** The favorite tags and entities, and the custom order of each. */
  public readonly favorites: FavoritesService;
  /** What was opened and chosen, and when. */
  public readonly usage: UsageService;
  /** The task rank order, the task sort, and the Task Board's layout. */
  public readonly taskLayout: TaskLayoutService;
  /** Home's widgets and the Dashboard's view state. */
  public readonly homeWidgets: HomeWidgetsService;
  /** The notes pinned to Home. */
  public readonly pins: PinsService;
  /** Saved searches and recent searches. */
  public readonly savedSearches: SavedSearchesService;
  /** Sort modes, column counts, and the other presentation choices. */
  public readonly display: DisplayService;
  /** The cascade that moves what a renamed tag held to its new key. */
  public readonly tagRenames: TagRenames;

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
    const repository = new PreferencesRepository(state, workspaceState);
    this.repository = repository;
    this.favorites = new FavoritesService(repository);
    this.usage = new UsageService(repository);
    this.taskLayout = new TaskLayoutService(repository);
    this.homeWidgets = new HomeWidgetsService(repository);
    this.pins = new PinsService(repository);
    this.savedSearches = new SavedSearchesService(repository);
    this.display = new DisplayService(repository);
    this.tagRenames = new TagRenames(repository);
    this.onDidChange = repository.onDidChange;
    this.onDidRecordVisit = repository.onDidRecordVisit;
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

  /** See {@link FavoritesService.toggleFavorite}. */
  public toggleFavorite(tagKey: string): Promise<void> {
    return this.favorites.toggleFavorite(tagKey);
  }

  /** See {@link FavoritesService.toggleFavoriteEntity}. */
  public toggleFavoriteEntity(entityKey: string): Promise<void> {
    return this.favorites.toggleFavoriteEntity(entityKey);
  }

  /** See {@link DisplayService.setTagSortMode}. */
  public setTagSortMode(tagSortMode: TagSortMode): Promise<void> {
    return this.display.setTagSortMode(tagSortMode);
  }

  /** See {@link DisplayService.setEntitySortMode}. */
  public setEntitySortMode(entitySortMode: TagSortMode): Promise<void> {
    return this.display.setEntitySortMode(entitySortMode);
  }

  /** See {@link FavoritesService.setTagAccessOrder}. */
  public setTagAccessOrder(tagAccessOrder: string[]): Promise<void> {
    return this.favorites.setTagAccessOrder(tagAccessOrder);
  }

  /** See {@link FavoritesService.setEntityAccessOrder}. */
  public setEntityAccessOrder(entityAccessOrder: string[]): Promise<void> {
    return this.favorites.setEntityAccessOrder(entityAccessOrder);
  }

  /** See {@link FavoritesService.setTagAccessOrderAndFavorites}. */
  public setTagAccessOrderAndFavorites(
    tagAccessOrder: string[],
    favoriteTags: string[],
  ): Promise<void> {
    return this.favorites.setTagAccessOrderAndFavorites(tagAccessOrder, favoriteTags);
  }

  /** See {@link UsageService.recordTagAccess}. */
  public recordTagAccess(tagKey: string, now?: number): Promise<void> {
    return this.usage.recordTagAccess(tagKey, now);
  }

  /** See {@link UsageService.recordFindChoice}. */
  public recordFindChoice(input: string, key: string, now?: number): Promise<void> {
    return this.usage.recordFindChoice(input, key, now);
  }

  /** See {@link UsageService.recordRecentHeading}. */
  public recordRecentHeading(pin: PinnedNote): Promise<void> {
    return this.usage.recordRecentHeading(pin);
  }

  /** See {@link SavedSearchesService.removeRecentQuery}. */
  public removeRecentQuery(query: string): Promise<void> {
    return this.savedSearches.removeRecentQuery(query);
  }

  /** See {@link SavedSearchesService.recordRecentQuery}. */
  public recordRecentQuery(query: string): Promise<void> {
    return this.savedSearches.recordRecentQuery(query);
  }

  /** See {@link UsageService.recordEntityAccess}. */
  public recordEntityAccess(entityKey: string): Promise<void> {
    return this.usage.recordEntityAccess(entityKey);
  }

  /** See {@link TaskLayoutService.replaceTaskInOrder}. */
  public replaceTaskInOrder(previousId: string, nextId: string): Promise<void> {
    return this.taskLayout.replaceTaskInOrder(previousId, nextId);
  }

  /** See {@link TaskLayoutService.setTaskOrder}. */
  public setTaskOrder(taskOrder: string[]): Promise<void> {
    return this.taskLayout.setTaskOrder(taskOrder);
  }

  /** See {@link TaskLayoutService.setTaskSortMode}. */
  public setTaskSortMode(taskSortMode: TaskSortMode): Promise<void> {
    return this.taskLayout.setTaskSortMode(taskSortMode);
  }

  /** See {@link DisplayService.setDashboardColumns}. */
  public setDashboardColumns(
    section: 'tasks' | 'notes' | 'tags',
    columns: DashboardColumnCount,
  ): Promise<void> {
    return this.display.setDashboardColumns(section, columns);
  }

  /** See {@link TaskLayoutService.setTaskBoardLayout}. */
  public setTaskBoardLayout(taskBoardLayout: TaskLayout): Promise<void> {
    return this.taskLayout.setTaskBoardLayout(taskBoardLayout);
  }

  /** See {@link TaskLayoutService.setTaskBoardGroup}. */
  public setTaskBoardGroup(
    taskBoardGroup: TaskBoardGroupBy,
    namespace?: string,
  ): Promise<void> {
    return this.taskLayout.setTaskBoardGroup(taskBoardGroup, namespace);
  }

  /** See {@link TaskLayoutService.setTaskTableColumns}. */
  public setTaskTableColumns(columns: TaskColumnId[]): Promise<void> {
    return this.taskLayout.setTaskTableColumns(columns);
  }

  /** See {@link TaskLayoutService.setTaskTableSort}. */
  public setTaskTableSort(sort: TableSort | undefined): Promise<void> {
    return this.taskLayout.setTaskTableSort(sort);
  }

  /** See {@link HomeWidgetsService.setDashboardWidgets}. */
  public setDashboardWidgets(
    dashboardWidgets: readonly DashboardWidgetConfig[],
  ): Promise<void> {
    return this.homeWidgets.setDashboardWidgets(dashboardWidgets);
  }

  /** See {@link HomeWidgetsService.addSavedSearchWidget}. */
  public addSavedSearchWidget(filterId: string): Promise<'added' | 'present' | 'missing'> {
    return this.homeWidgets.addSavedSearchWidget(filterId);
  }

  /** See {@link HomeWidgetsService.resetDashboardWidgets}. */
  public resetDashboardWidgets(): Promise<void> {
    return this.homeWidgets.resetDashboardWidgets();
  }

  /** See {@link PinsService.pinNote}. */
  public pinNote(pin: PinnedNote): Promise<void> {
    return this.pins.pinNote(pin);
  }

  /** See {@link PinsService.unpinNote}. */
  public unpinNote(key: string): Promise<void> {
    return this.pins.unpinNote(key);
  }

  /** See {@link PinsService.isPinned}. */
  public isPinned(key: string): boolean {
    return this.pins.isPinned(key);
  }

  /** See {@link HomeWidgetsService.setDashboardMode}. */
  public setDashboardMode(mode: DashboardMode): Promise<void> {
    return this.homeWidgets.setDashboardMode(mode);
  }

  /** See {@link HomeWidgetsService.setDashboardSearch}. */
  public setDashboardSearch(field: DashboardSearchField, query: string): Promise<void> {
    return this.homeWidgets.setDashboardSearch(field, query);
  }

  /** See {@link DisplayService.setRenderMode}. */
  public setRenderMode(renderMode: RenderMode): Promise<void> {
    return this.display.setRenderMode(renderMode);
  }

  /** See {@link DisplayService.setTagOverviewSortMode}. */
  public setTagOverviewSortMode(tagOverviewSortMode: TagOverviewSortMode): Promise<void> {
    return this.display.setTagOverviewSortMode(tagOverviewSortMode);
  }

  /** See {@link DisplayService.setSearchPageSize}. */
  public setSearchPageSize(searchPageSize: SearchPageSize): Promise<void> {
    return this.display.setSearchPageSize(searchPageSize);
  }

  /** See {@link DisplayService.setSearchPreview}. */
  public setSearchPreview(searchPreview: SearchPreview): Promise<void> {
    return this.display.setSearchPreview(searchPreview);
  }

  /** See {@link DisplayService.setTagOverviewLayout}. */
  public setTagOverviewLayout(tagOverviewLayout: TagOverviewLayout): Promise<void> {
    return this.display.setTagOverviewLayout(tagOverviewLayout);
  }

  /** See {@link DisplayService.setRelatedNotesSortMode}. */
  public setRelatedNotesSortMode(relatedNotesSortMode: RelatedNotesSortMode): Promise<void> {
    return this.display.setRelatedNotesSortMode(relatedNotesSortMode);
  }

  /** See {@link DisplayService.setHideDailyNotes}. */
  public setHideDailyNotes(hide: boolean): Promise<void> {
    return this.display.setHideDailyNotes(hide);
  }

  /** See {@link DisplayService.setRelatedNotesPreviewLines}. */
  public setRelatedNotesPreviewLines(lines: 0 | 1 | 2): Promise<void> {
    return this.display.setRelatedNotesPreviewLines(lines);
  }

  /** See {@link UsageService.recordSectionAccess}. */
  public recordSectionAccess(
    sectionId: string,
    now?: number,
    options?: { quiet?: boolean },
  ): Promise<void> {
    return this.usage.recordSectionAccess(sectionId, now, options);
  }

  /** See {@link UsageService.carrySectionAccess}. */
  public carrySectionAccess(moved: ReadonlyMap<string, string>): Promise<void> {
    return this.usage.carrySectionAccess(moved);
  }

  /** See {@link SavedSearchesService.saveSavedFilter}. */
  public saveSavedFilter(name: string, tagKeys: string[]): Promise<SavedFilter | undefined> {
    return this.savedSearches.saveSavedFilter(name, tagKeys);
  }

  /** See {@link TagRenames.replaceTagKey}. */
  public replaceTagKey(sourceKey: string, targetKey: string): Promise<void> {
    return this.tagRenames.replaceTagKey(sourceKey, targetKey);
  }

  /** See {@link SavedSearchesService.saveSavedQueryFilter}. */
  public saveSavedQueryFilter(
    name: string,
    query: string,
    page?: 'taskBoard',
  ): Promise<SavedFilter | undefined> {
    return this.savedSearches.saveSavedQueryFilter(name, query, page);
  }

  /** See {@link SavedSearchesService.updateSavedFilter}. */
  public updateSavedFilter(
    id: string,
    name: string,
    tagKeys: string[],
  ): Promise<SavedFilter | undefined> {
    return this.savedSearches.updateSavedFilter(id, name, tagKeys);
  }

  /** See {@link SavedSearchesService.removeSavedFilter}. */
  public removeSavedFilter(id: string): Promise<void> {
    return this.savedSearches.removeSavedFilter(id);
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
