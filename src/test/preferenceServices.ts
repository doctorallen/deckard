// The preferences a suite or a harness hands to what it tests, built as the
// extension builds them where it starts: one repository over the suite's own
// stores, and each service over it, so nothing one suite keeps reaches another.
import type { KeyValueStore } from '../ports/keyValueStore';
import type { PreferenceServices } from '../core/storage/preferences';
import { DisplayService } from '../core/storage/preferencesDisplay';
import { FavoritesService } from '../core/storage/preferencesFavorites';
import { HomeWidgetsService } from '../core/storage/preferencesHomeWidgets';
import { PreferencesMaintenance } from '../core/storage/preferencesMaintenance';
import { PinsService } from '../core/storage/preferencesPins';
import { PreferencesRepository } from '../core/storage/preferencesRepository';
import { SavedSearchesService } from '../core/storage/preferencesSavedSearches';
import { TagRenames } from '../core/storage/preferencesTagRenames';
import { TaskLayoutService } from '../core/storage/preferencesTaskLayout';
import { UsageService } from '../core/storage/preferencesUsage';

/** Every preference service, and the repository that keeps what they change. */
export interface TestPreferences extends PreferenceServices {
  /** What the services write through; a suite disposes of it, or seeds it with `initialize`. */
  repository: PreferencesRepository;
}

/**
 * The whole set over `state`, and over `workspaceState` when the suite
 * stands in for a window with a folder open. The services are made in the
 * order the extension makes them; nothing is written until a suite changes
 * something or calls `repository.initialize()`.
 */
export function createPreferences(
  state: KeyValueStore,
  workspaceState?: KeyValueStore,
): TestPreferences {
  const repository = new PreferencesRepository(state, workspaceState);
  return {
    repository,
    reader: repository,
    favorites: new FavoritesService(repository),
    usage: new UsageService(repository),
    taskLayout: new TaskLayoutService(repository),
    homeWidgets: new HomeWidgetsService(repository),
    pins: new PinsService(repository),
    savedSearches: new SavedSearchesService(repository),
    display: new DisplayService(repository),
    tagRenames: new TagRenames(repository),
    maintenance: new PreferencesMaintenance(repository),
  };
}

/** A store kept in memory, empty until something is written to it. */
export class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, unknown>();

  /** The value stored under `key`, or `defaultValue` when there is none. */
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  /** Stores `value` under `key`; undefined removes it. */
  public update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
    return Promise.resolve();
  }
}

/** The whole set over a store of its own in memory, as a suite with nothing kept yet. */
export function createMemoryPreferences(): TestPreferences {
  return createPreferences(new MemoryStore());
}
