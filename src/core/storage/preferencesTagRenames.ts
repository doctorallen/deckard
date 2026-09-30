import type {
  DashboardWidgetConfig,
  PersistedPreferences,
  SavedFilter,
} from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import { normalizeSavedFilterTagKeys } from './preferencesSchema';

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

/** One tag's move: the key it had, and the key it has now. */
interface TagMove {
  sourceKey: string;
  targetKey: string;
}

/** A list of keys with the moved one renamed, each key once. */
function renameKeys(keys: readonly string[], { sourceKey, targetKey }: TagMove): string[] {
  return [...new Set(keys.map((key) => (key === sourceKey ? targetKey : key)))];
}

/** Counts with the moved key's count added to its new key's. */
function moveCount(counts: Record<string, number>, { sourceKey, targetKey }: TagMove): Record<string, number> {
  const { [sourceKey]: moved, ...rest } = counts;
  return moved === undefined
    ? rest
    : { ...rest, [targetKey]: (rest[targetKey] ?? 0) + moved };
}

/** Access times with the moved key's time kept under its new key, the later of the two. */
function moveAccessTime(
  times: Record<string, number> | undefined,
  { sourceKey, targetKey }: TagMove,
): Record<string, number> {
  const { [sourceKey]: movedTime, ...tagAccessTimes } = times ?? {};
  return movedTime === undefined
    ? tagAccessTimes
    : {
        ...tagAccessTimes,
        [targetKey]: Math.max(movedTime, tagAccessTimes[targetKey] ?? 0),
      };
}

/**
 * First-seen times with the moved key's time given to its new key, when it
 * had one. A tag renamed to a new name is no newer than it was; merged into
 * a tag that exists, it takes that tag's time.
 */
function moveFirstSeen(
  firstSeen: Record<string, number> | undefined,
  { sourceKey, targetKey }: TagMove,
): Pick<PersistedPreferences, 'tagFirstSeen'> {
  const movedFirstSeen = firstSeen?.[sourceKey];
  if (!firstSeen || movedFirstSeen === undefined) {
    return {};
  }
  return {
    tagFirstSeen: {
      ...firstSeen,
      [targetKey]: firstSeen[targetKey] ?? movedFirstSeen,
    },
  };
}

/** Home's widgets with the moved tag renamed in each widget's search. */
function renameInWidgets(
  widgets: readonly DashboardWidgetConfig[],
  { sourceKey, targetKey }: TagMove,
): DashboardWidgetConfig[] {
  return widgets.map((widget) =>
    widget.query
      ? { ...widget, query: replaceTagInQuery(widget.query, sourceKey, targetKey) }
      : widget,
  );
}

/**
 * Saved filters with the moved tag renamed in each tag set. A tag-set view
 * needs two tags, so one left with fewer is dropped; a query view keeps its
 * own text.
 */
function renameInSavedFilters(filters: readonly SavedFilter[], move: TagMove): SavedFilter[] {
  return filters.flatMap((filter) => {
    if (filter.query || !filter.tagKeys.includes(move.sourceKey)) {
      return [filter];
    }
    const tagKeys = normalizeSavedFilterTagKeys(renameKeys(filter.tagKeys, move));
    return tagKeys.length >= 2 ? [{ ...filter, tagKeys }] : [];
  });
}

/**
 * The tag-rename cascade: when a tag is renamed or merged, everything kept
 * under its key follows it to the new one, so favorites, ranking, Dashboard
 * selections, and saved views stay with the tag rather than being pruned
 * as a tag that is gone.
 */
export class TagRenames {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

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
    const move: TagMove = { sourceKey, targetKey };
    const current = this.repository.current;
    await this.repository.update({
      favoriteTags: renameKeys(current.favoriteTags, move),
      favoriteEntities: renameKeys(current.favoriteEntities, move),
      tagAccessOrder: renameKeys(current.tagAccessOrder, move),
      entityAccessOrder: renameKeys(current.entityAccessOrder, move),
      tagAccessCounts: moveCount(current.tagAccessCounts, move),
      entityAccessCounts: moveCount(current.entityAccessCounts, move),
      tagAccessTimes: moveAccessTime(current.tagAccessTimes, move),
      ...moveFirstSeen(current.tagFirstSeen, move),
      dashboardWidgets: renameInWidgets(current.dashboardWidgets, move),
      savedFilters: renameInSavedFilters(current.savedFilters, move),
    });
  }
}
