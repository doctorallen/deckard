// The set of preference services a caller picks the ones it uses from. Each
// service lives in a module of its own beside this one, over
// PreferencesRepository, and the schema's helpers and limits are imported
// from preferencesSchema.ts.
import type { DisplayService } from './preferencesDisplay';
import type { FavoritesService } from './preferencesFavorites';
import type { HomeWidgetsService } from './preferencesHomeWidgets';
import type { PinsService } from './preferencesPins';
import type { PreferencesReader } from './preferencesRepository';
import type { SavedSearchesService } from './preferencesSavedSearches';
import type { PreferencesMaintenance } from './preferencesMaintenance';
import type { TagRenames } from './preferencesTagRenames';
import type { TaskLayoutService } from './preferencesTaskLayout';
import type { UsageService } from './preferencesUsage';

/**
 * Every preference capability, one service each, as the extension builds
 * them over one `PreferencesRepository`. A caller names the ones it uses,
 * as `Pick<PreferenceServices, 'reader' | 'favorites'>`, and is handed
 * those alone.
 */
export interface PreferenceServices {
  /** The blob and its change events, for a caller that only reads. */
  reader: PreferencesReader;
  /** The favorite tags and entities, and the custom order of each. */
  favorites: FavoritesService;
  /** What was opened and chosen, and when. */
  usage: UsageService;
  /** The task rank order, the task sort, and the Task Board's layout. */
  taskLayout: TaskLayoutService;
  /** Home's widgets and the Dashboard's view state. */
  homeWidgets: HomeWidgetsService;
  /** The notes pinned to Home. */
  pins: PinsService;
  /** Saved searches and recent searches. */
  savedSearches: SavedSearchesService;
  /** Sort modes, column counts, and the other presentation choices. */
  display: DisplayService;
  /** The cascade that moves what a renamed tag held to its new key. */
  tagRenames: TagRenames;
  /** Pruning against the index, the stale-choice check, and restoring a copy. */
  maintenance: PreferencesMaintenance;
}
