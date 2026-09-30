import type {
  FindChoice,
  PersistedPreferences,
  PinnedNote,
  SavedFilter,
} from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import {
  carryLegacyIds,
  findChoiceFilePath,
  normalizePreferences,
  pinKey,
} from './preferencesSchema';

/** What `findStale` reports: deliberate choices the index no longer backs. */
export interface StalePreferences {
  favoriteTags: string[];
  favoriteEntities: string[];
  pinnedNotes: PinnedNote[];
  savedFilters: SavedFilter[];
}

/**
 * What pruning needs of an index snapshot: the keys of its five maps. A
 * `WorkspaceIndex` is one.
 */
export type PruneIndex = {
  readonly [K in 'tags' | 'tasks' | 'sections' | 'entities' | 'files']: ReadonlyMap<string, unknown>;
};

/**
 * The keys that exist, for a caller that has them without an index. Tags
 * and tasks are always checked; a kind left out is not, and what is kept
 * under it stays.
 */
export interface PruneKeys {
  tags: Iterable<string>;
  tasks: Iterable<string>;
  sections?: Iterable<string>;
  entities?: Iterable<string>;
  files?: Iterable<string>;
}

/** The keys that exist, as sets; a kind left out is not checked. */
interface ValidKeys {
  tags: ReadonlySet<string>;
  tasks: ReadonlySet<string>;
  sections: ReadonlySet<string> | undefined;
  entities: ReadonlySet<string> | undefined;
  files: ReadonlySet<string> | undefined;
}

/** The keys as sets, read once. */
function validKeys(keys: PruneKeys): ValidKeys {
  return {
    tags: new Set(keys.tags),
    tasks: new Set(keys.tasks),
    sections: keys.sections ? new Set(keys.sections) : undefined,
    entities: keys.entities ? new Set(keys.entities) : undefined,
    files: keys.files ? new Set(keys.files) : undefined,
  };
}

/** Whether the index holds nothing at all. */
function isEmptyIndex(valid: ValidKeys): boolean {
  return (
    valid.tags.size === 0 &&
    valid.tasks.size === 0 &&
    (valid.sections?.size ?? 0) === 0 &&
    (valid.entities?.size ?? 0) === 0 &&
    (valid.files?.size ?? 0) === 0
  );
}

/** A record with only the keys `keep` accepts. */
function keepKeys<T>(record: Record<string, T>, keep: (key: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keep(key)));
}

/** Whether a Find choice still names a note or tag that exists, or names neither. */
function keepsFindChoice(choice: FindChoice, valid: ValidKeys): boolean {
  const filePath = findChoiceFilePath(choice.key);
  if (filePath !== undefined) {
    return valid.files?.has(filePath) ?? true;
  }
  return choice.key.startsWith('tag:') ? valid.tags.has(choice.key.slice(4)) : true;
}

/** The Find choices and recent headings left once those naming what is gone are forgotten. */
function prunedMemory(
  current: PersistedPreferences,
  valid: ValidKeys,
): Pick<PersistedPreferences, 'findChoices' | 'recentHeadings'> {
  // A choice whose note or tag is gone is forgotten with it.
  const findChoices = current.findChoices?.filter((choice) => keepsFindChoice(choice, valid));
  const recentHeadings = current.recentHeadings?.filter(
    (pin) => valid.files?.has(pin.filePath) ?? true,
  );
  return {
    ...(findChoices ? { findChoices } : {}),
    ...(recentHeadings ? { recentHeadings } : {}),
  };
}

/**
 * When each indexed tag was first seen. Every tag in the first index is
 * known; a tag seen after that is new from the moment it is seen, until it
 * is gone again.
 */
function firstSeenTimes(
  previous: Record<string, number> | undefined,
  tags: ReadonlySet<string>,
  now: number,
): Record<string, number> {
  return Object.fromEntries(
    [...tags].map((tagKey) => [tagKey, previous ? (previous[tagKey] ?? now) : 0]),
  );
}

/**
 * What pruning would store: the counts, orders, and times kept only for
 * entries that exist, and the first-seen times brought up to date.
 *
 * Only what Deckard derived is collected here: counts, orders, times, and
 * when a tag was first seen. A favorite, a pin, a saved search and a Home
 * widget were each chosen on purpose, and an index that no longer mentions
 * one is not a reason to throw it away — it is a reason to say so and let
 * the reader decide. `findStale` finds them; the Tidy command asks.
 */
function prunedChanges(
  current: PersistedPreferences,
  valid: ValidKeys,
  now: number,
): Partial<PersistedPreferences> {
  // Ids were widened in 1.23. What was kept under an old id is carried to
  // the new id of the same entry before anything is pruned, so task order
  // and view counts survive the upgrade.
  const carried = carryLegacyIds(current, valid.tasks, valid.sections);
  const sections = valid.sections;
  const isTag = (tagKey: string): boolean => valid.tags.has(tagKey);
  const isEntity = (entityKey: string): boolean => valid.entities?.has(entityKey) ?? true;
  return {
    ...prunedMemory(current, valid),
    tagAccessOrder: current.tagAccessOrder.filter(isTag),
    tagAccessCounts: keepKeys(current.tagAccessCounts, isTag),
    tagAccessTimes: keepKeys(current.tagAccessTimes ?? {}, isTag),
    taskOrder: carried.taskOrder.filter((taskId) => valid.tasks.has(taskId)),
    sectionAccessCounts: sections
      ? keepKeys(carried.sectionAccessCounts, (sectionId) => sections.has(sectionId))
      : carried.sectionAccessCounts,
    sectionAccessTimes: sections
      ? keepKeys(carried.sectionAccessTimes ?? {}, (sectionId) => sections.has(sectionId))
      : carried.sectionAccessTimes,
    entityAccessOrder: current.entityAccessOrder.filter(isEntity),
    entityAccessCounts: keepKeys(current.entityAccessCounts, isEntity),
    tagFirstSeen: firstSeenTimes(current.tagFirstSeen, valid.tags, now),
  };
}

/**
 * Housekeeping against the index: pruning what Deckard derived for entries
 * that are gone, finding the deliberate choices that point at nothing, and
 * restoring a blob from a copy.
 */
export class PreferencesMaintenance {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /**
   * Removes state for deleted index entries so preferences do not grow
   * forever, checking against every kind of entry the snapshot holds.
   */
  public prune(index: PruneIndex, now = Date.now()): Promise<void> {
    return this.pruneKeys(
      {
        tags: index.tags.keys(),
        tasks: index.tasks.keys(),
        sections: index.sections.keys(),
        entities: index.entities.keys(),
        files: index.files.keys(),
      },
      now,
    );
  }

  /**
   * Removes state for deleted index entries so preferences do not grow
   * forever, checking only the kinds of entry `keys` names.
   */
  public async pruneKeys(keys: PruneKeys, now = Date.now()): Promise<void> {
    const valid = validKeys(keys);
    // Pruning is a garbage collection, and it may only run against an index
    // that is authoritative about what exists. An index holding nothing is
    // not evidence that every tag, note and task was deleted: it is what a
    // window with no folder open reports, which is the state VS Code is in
    // while a VSIX is installed from the Extensions view.
    //
    // A workspace whose notes really were all deleted keeps its preferences
    // instead. They are small, and they come back into use the moment a note
    // does.
    if (isEmptyIndex(valid)) {
      return;
    }
    const changes = prunedChanges(this.repository.current, valid, now);
    // Every index update prunes, and it rarely removes anything. Writing
    // anyway would make every view that follows preferences refresh twice.
    if (this.hasChanges(changes)) {
      await this.repository.update(changes);
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
    const current = this.repository.current;
    return {
      favoriteTags: current.favoriteTags.filter(
        (tagKey) => !validTags.has(tagKey),
      ),
      favoriteEntities: current.favoriteEntities.filter(
        (entityKey) => !validEntities.has(entityKey),
      ),
      pinnedNotes: (current.pinnedNotes ?? []).filter(
        (pin) => !validFiles.has(pin.filePath),
      ),
      savedFilters: current.savedFilters.filter(
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
    const current = this.repository.current;
    await this.repository.update({
      favoriteTags: current.favoriteTags.filter((key) => !tags.has(key)),
      favoriteEntities: current.favoriteEntities.filter(
        (key) => !entities.has(key),
      ),
      pinnedNotes: (current.pinnedNotes ?? []).filter(
        (pin) => !pins.has(pinKey(pin)),
      ),
      savedFilters: current.savedFilters.filter(
        (filter) => !filters.has(filter.id),
      ),
      // A widget that showed a removed search leaves Home with it.
      dashboardWidgets: current.dashboardWidgets.filter(
        (widget) =>
          widget.kind !== 'savedQuery' ||
          widget.filterId === undefined ||
          !filters.has(widget.filterId),
      ),
    });
  }

  /**
   * Replaces everything the repository holds with a blob read back from an
   * export or a copy Deckard kept. It is normalized on the way in, so a file
   * from an older Deckard, or one that was edited by hand, cannot leave the
   * store holding a shape the views do not expect.
   */
  public async importPreferences(value: PersistedPreferences): Promise<void> {
    await this.repository.update(normalizePreferences(value));
  }

  /** Whether any of `changes` differs from what is stored. */
  private hasChanges(changes: Partial<PersistedPreferences>): boolean {
    const current = this.repository.current;
    return (
      Object.keys(changes) as Array<keyof PersistedPreferences>
    ).some(
      (key) =>
        JSON.stringify(changes[key]) !== JSON.stringify(current[key]),
    );
  }
}
