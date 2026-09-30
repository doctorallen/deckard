import type { PinnedNote } from '../../domain/model/preferences';
import type { PreferencesRepository } from './preferencesRepository';
import {
  bumped,
  FIND_CHOICE_LIMIT,
  normalizeFindInput,
  pinKey,
  RECENT_HEADING_LIMIT,
} from './preferencesSchema';

/**
 * What a reader opened and chose, kept so rankings follow actual use: how
 * often and how lately each tag, entity, and heading was opened, which
 * result Find was chosen for what was typed, and the headings Capture and
 * Move to… went under. All of it is derived, so pruning collects what
 * names an entry the index no longer has.
 */
export class UsageService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /**
   * Increments usage counts so access sorting reflects actual navigation, and
   * notes the time so recently opened tags rank first in search.
   */
  public async recordTagAccess(tagKey: string, now = Date.now()): Promise<void> {
    const current = this.repository.current;
    const tagAccessCounts = bumped(current.tagAccessCounts, tagKey);
    const tagAccessTimes = {
      ...current.tagAccessTimes,
      [tagKey]: now,
    };
    await this.repository.update({ tagAccessCounts, tagAccessTimes });
  }

  /** Counts one more opening of an entity, for the entity list's access sort. */
  public async recordEntityAccess(entityKey: string): Promise<void> {
    const entityAccessCounts = bumped(this.repository.current.entityAccessCounts, entityKey);
    await this.repository.update({ entityAccessCounts });
  }

  /**
   * Increments section usage counts for the overview's access sort.
   */
  public async recordSectionAccess(
    sectionId: string,
    now = Date.now(),
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    const current = this.repository.current;
    const sectionAccessCounts = bumped(current.sectionAccessCounts, sectionId);
    const sectionAccessTimes = {
      ...current.sectionAccessTimes,
      [sectionId]: now,
    };
    await this.repository.update({ sectionAccessCounts, sectionAccessTimes }, options.quiet === true);
  }

  /**
   * Moves view counts and times from ids that are gone to the new id of the
   * same heading, summing counts and keeping the later time, in one quiet
   * write. A heading's id changes when a line above it does.
   */
  public async carrySectionAccess(moved: ReadonlyMap<string, string>): Promise<void> {
    const counts = { ...this.repository.current.sectionAccessCounts };
    const times = { ...(this.repository.current.sectionAccessTimes ?? {}) };
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
      await this.repository.update({ sectionAccessCounts: counts, sectionAccessTimes: times }, true);
    }
  }

  /**
   * Remembers the result chosen for what was typed, so Find can offer it
   * first the next time the start of it is typed.
   */
  public async recordFindChoice(input: string, key: string, now = Date.now()): Promise<void> {
    const typed = normalizeFindInput(input);
    if (!typed) {
      return;
    }
    const choices = this.repository.current.findChoices ?? [];
    const existing = choices.find((choice) => choice.input === typed && choice.key === key);
    const next = [
      { input: typed, key, count: (existing?.count ?? 0) + 1, at: now },
      ...choices.filter((choice) => choice !== existing),
    ];
    await this.repository.update({ findChoices: next.slice(0, FIND_CHOICE_LIMIT) }, true);
  }

  /** Remembers a heading Capture or Move to… went under, newest first. */
  public async recordRecentHeading(pin: PinnedNote): Promise<void> {
    const key = pinKey(pin);
    const recentHeadings = [
      pin,
      ...(this.repository.current.recentHeadings ?? []).filter((each) => pinKey(each) !== key),
    ].slice(0, RECENT_HEADING_LIMIT);
    await this.repository.update({ recentHeadings }, true);
  }
}
