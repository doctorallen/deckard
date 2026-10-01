// Where callers import the preferences from: the schema's helpers and
// limits, the maintenance types, and the set of services a caller picks the
// ones it uses from. Each service lives in a module of its own beside this
// one, over PreferencesRepository.
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
export type { PreferencesReader } from './preferencesRepository';

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
