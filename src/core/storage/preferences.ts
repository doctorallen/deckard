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
import { PreferencesMaintenance, type StalePreferences } from './preferencesMaintenance';
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

export type { PruneIndex, PruneKeys, StalePreferences } from './preferencesMaintenance';

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
  /** Pruning against the index, the stale-choice check, and restoring a copy. */
  public readonly maintenance: PreferencesMaintenance;

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
    this.maintenance = new PreferencesMaintenance(repository);
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
   * See {@link PreferencesMaintenance.pruneKeys}, which takes the same keys
   * by name; `PreferencesMaintenance.prune` takes the index snapshot itself.
   */
  public prune(
    validTagKeys: Iterable<string>,
    validTaskIds: Iterable<string>,
    validSectionIds?: Iterable<string>,
    validEntityKeys?: Iterable<string>,
    validFilePaths?: Iterable<string>,
    now?: number,
  ): Promise<void> {
    return this.maintenance.pruneKeys(
      {
        tags: validTagKeys,
        tasks: validTaskIds,
        sections: validSectionIds,
        entities: validEntityKeys,
        files: validFilePaths,
      },
      now,
    );
  }

  /** See {@link PreferencesMaintenance.findStale}. */
  public findStale(
    validTagKeys: Iterable<string>,
    validEntityKeys: Iterable<string>,
    validFilePaths: Iterable<string>,
  ): StalePreferences {
    return this.maintenance.findStale(validTagKeys, validEntityKeys, validFilePaths);
  }

  /** See {@link PreferencesMaintenance.removeStale}. */
  public removeStale(stale: StalePreferences): Promise<void> {
    return this.maintenance.removeStale(stale);
  }

  /** See {@link PreferencesMaintenance.importPreferences}. */
  public importPreferences(value: PersistedPreferences): Promise<void> {
    return this.maintenance.importPreferences(value);
  }

  /**
   * Releases the event sources owned by this store.
   */
  public dispose(): void {
    this.repository.dispose();
  }
}
