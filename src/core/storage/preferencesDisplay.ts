import type {
  DashboardColumnCount,
  PersistedPreferences,
  RelatedNotesSortMode,
  RenderMode,
  SearchPageSize,
  SearchPreview,
  SearchHierarchy,
  TagOverviewLayout,
  TagOverviewSortMode,
  TagSortMode,
} from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';

/** Which stored column count each Dashboard section reads. */
const DASHBOARD_COLUMN_KEYS = {
  tasks: 'dashboardTaskColumns',
  notes: 'dashboardNoteColumns',
  tags: 'dashboardTagColumns',
} as const satisfies Record<string, keyof PersistedPreferences>;

/**
 * How Deckard shows what it lists: sort modes, column counts, render
 * modes, page sizes, and the Related Notes options. These are presentation,
 * the same in any workspace, so they stay machine-wide and nothing prunes
 * them.
 */
export class DisplayService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /**
   * Selects the tag ordering policy used by dashboard snapshots.
   */
  public async setTagSortMode(tagSortMode: TagSortMode): Promise<void> {
    await this.repository.update({ tagSortMode });
  }

  /** Selects how the entity list is ordered, as the tag list's mode does. */
  public async setEntitySortMode(entitySortMode: TagSortMode): Promise<void> {
    await this.repository.update({ entitySortMode });
  }

  /**
   * Persists the independent task and tag grid widths for every Dashboard.
   */
  public async setDashboardColumns(
    section: keyof typeof DASHBOARD_COLUMN_KEYS,
    columns: DashboardColumnCount,
  ): Promise<void> {
    await this.repository.update({ [DASHBOARD_COLUMN_KEYS[section]]: columns });
  }

  /**
   * Persists whether tag overview bodies should show source or rendered output.
   */
  public async setRenderMode(renderMode: RenderMode): Promise<void> {
    await this.repository.update({ renderMode, renderModeChosen: true });
  }

  /**
   * Selects the ordering policy for entries in a tag overview.
   */
  public async setTagOverviewSortMode(
    tagOverviewSortMode: TagOverviewSortMode,
  ): Promise<void> {
    await this.repository.update({ tagOverviewSortMode });
  }

  /**
   * Selects how many results a search page shows at a time, which is kept so
   * the next page opens the way the last one was left.
   */
  public async setSearchPageSize(
    searchPageSize: SearchPageSize,
  ): Promise<void> {
    await this.repository.update({ searchPageSize });
  }

  /** Selects whether a search page groups its results under Refine's tags. */
  public async setSearchHierarchy(searchHierarchy: SearchHierarchy): Promise<void> {
    await this.repository.update({ searchHierarchy: searchHierarchy === 'tags' ? 'tags' : undefined });
  }

  /** Selects how much of each result a search page shows. */
  public async setSearchPreview(searchPreview: SearchPreview): Promise<void> {
    await this.repository.update({ searchPreview });
  }

  /**
   * Selects whether overview entries use tabs or a split layout.
   */
  public async setTagOverviewLayout(
    tagOverviewLayout: TagOverviewLayout,
  ): Promise<void> {
    await this.repository.update({ tagOverviewLayout });
  }

  /**
   * Selects the ordering policy for entries in Related Notes.
   */
  public async setRelatedNotesSortMode(
    relatedNotesSortMode: RelatedNotesSortMode,
  ): Promise<void> {
    await this.repository.update({ relatedNotesSortMode });
  }

  /**
   * Leaves daily, weekly, and monthly notes out of Related Notes and Linked
   * from, or lets them back in.
   */
  public async setHideDailyNotes(hide: boolean): Promise<void> {
    await this.repository.update({ hideDailyNotes: hide ? true : undefined });
  }

  /** How many lines of each Related Notes result's excerpt to show: 0, 1, or 2. */
  public async setRelatedNotesPreviewLines(lines: 0 | 1 | 2): Promise<void> {
    await this.repository.update({ relatedNotesPreviewLines: lines === 1 ? undefined : lines });
  }
}
