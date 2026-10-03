import type { SavedFilter } from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import {
  areTagKeyListsEqual,
  cloneSavedFilter,
  normalizeSavedFilterTagKeys,
  RECENT_QUERY_LIMIT,
  upsertById,
} from './preferencesSchema';

/**
 * A new saved filter's id: opaque, and unique enough that two saved in the
 * same millisecond do not collide.
 */
function createSavedFilterId(): string {
  return `filter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The searches a reader saved, as tag sets or as queries, and the searches
 * they ran lately. A saved search is a deliberate choice: pruning never
 * removes one.
 */
export class SavedSearchesService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

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

    const savedFilters = this.repository.current.savedFilters;
    const existing = savedFilters.find((filter) =>
      areTagKeyListsEqual(filter.tagKeys, normalizedTagKeys),
    );
    const savedFilter: SavedFilter = {
      id: existing?.id ?? createSavedFilterId(),
      name: normalizedName,
      tagKeys: normalizedTagKeys,
    };
    await this.repository.update({ savedFilters: upsertById(savedFilters, savedFilter) });
    return cloneSavedFilter(savedFilter);
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
    const savedFilters = this.repository.current.savedFilters;
    const existing = savedFilters.find(
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
    await this.repository.update({ savedFilters: upsertById(savedFilters, savedFilter) });
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
    const savedFilters = this.repository.current.savedFilters;
    const existing = savedFilters.find(
      (filter) => filter.id === id,
    );
    if (!existing) {
      return undefined;
    }

    const matchingFilter = savedFilters.find(
      (filter) =>
        filter.id !== id &&
        areTagKeyListsEqual(filter.tagKeys, normalizedTagKeys),
    );
    const savedFilter: SavedFilter = {
      id,
      name: normalizedName,
      tagKeys: normalizedTagKeys,
    };
    await this.repository.update({
      savedFilters: savedFilters
        .filter((filter) => filter.id !== matchingFilter?.id)
        .map((filter) => (filter.id === id ? savedFilter : filter)),
    });
    return cloneSavedFilter(savedFilter);
  }

  /**
   * Removes a saved filter by its opaque stable ID, and the Home widget
   * that showed it.
   */
  public async removeSavedFilter(id: string): Promise<void> {
    if (!id) {
      return;
    }
    const current = this.repository.current;
    await this.repository.update({
      savedFilters: current.savedFilters.filter(
        (filter) => filter.id !== id,
      ),
      dashboardWidgets: current.dashboardWidgets.filter(
        (widget) => widget.kind !== 'savedQuery' || widget.filterId !== id,
      ),
    });
  }

  /**
   * Keeps a search at the front of the recent list, without duplicates.
   */
  public async recordRecentQuery(query: string): Promise<void> {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }
    const kept = this.repository.current.recentQueries;
    const recentQueries = [
      normalized,
      ...(kept ?? []).filter(
        (existing) => existing !== normalized,
      ),
    ].slice(0, RECENT_QUERY_LIMIT);
    if (JSON.stringify(recentQueries) !== JSON.stringify(kept)) {
      await this.repository.update({ recentQueries });
    }
  }

  /** Takes one search off the recent list. */
  public async removeRecentQuery(query: string): Promise<void> {
    const kept = this.repository.current.recentQueries ?? [];
    const recentQueries = kept.filter(
      (existing) => existing !== query.trim(),
    );
    if (recentQueries.length !== kept.length) {
      await this.repository.update({ recentQueries });
    }
  }
}
