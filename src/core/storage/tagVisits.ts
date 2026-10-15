/**
 * Since you last looked (docs/implementation/37-since-you-last-looked.md):
 * what each tag's page held when the reader last had it open, one snapshot
 * a tag, kept in VS Code's storage for the workspace. Never in the notes,
 * and never in the preferences blob that is copied machine-wide and backed
 * up: a snapshot names the workspace's entries, and there is no history of
 * them, only the last visit, replaced each time a visit counts.
 *
 * Each snapshot is kept under a key of its own, so counting a visit writes
 * one tag's, and a list of every tag's visit time beside them says which
 * to drop past the cap, oldest first, and which the Hubs view reads. The
 * Hubs view's sort is kept here too, with the workspace whose hubs it
 * sorts.
 */
import { Emitter } from '../../shared/emitter';
import { isRecord } from '../../shared/guards';
import type { Event } from '../../ports/events';
import type { KeyValueStore } from '../../ports/keyValueStore';

/** What one tag's page held at the reader's last visit. */
export interface TagVisit {
  /** When the visit counted, in milliseconds since the epoch. */
  seenAt: number;
  /** Each note entry the page listed, by a key that outlasts its line moving, with a hash of its text. */
  entries: Record<string, string>;
  /** The page's tasks, by a key that outlasts a line moving or a done date written: those open, and those done. */
  tasks: { open: string[]; done: string[] };
  /** The hub's own fields and reverses, by name, each as its values read. */
  fields: Record<string, string>;
  /** The questions under the tag that were answered; plan 38 records them, and a visit before it has none. */
  answered?: string[];
}

/** How the Hubs view orders each level: by name, or the hubs with the most new since their last visit first. */
export type HubSort = 'name' | 'new';

/** The list of every tag's visit time, by tag key. */
export const TAG_VISITS_KEY = 'deckard.tagVisits';
/** The prefix of each tag's snapshot, followed by its key. */
export const TAG_VISIT_PREFIX = 'deckard.tagVisit:';
/** The Hubs view's sort. */
export const HUB_SORT_KEY = 'deckard.hubs.sort';
/** The most snapshots kept; past it, the oldest visits go first. */
export const TAG_VISIT_LIMIT = 500;

/**
 * The tags' visits, read and written in the workspace's store. A value
 * written by hand, or by a later Deckard, that is not a visit reads as no
 * visit at all.
 */
export class TagVisits {
  private readonly changeEmitter = new Emitter<void>();
  /** Fires when a visit is counted, or the Hubs view's sort changes, so the views that show them redraw. */
  public readonly onDidChange: Event<void> = this.changeEmitter.event;

  /** Over the workspace's store. */
  public constructor(private readonly store: KeyValueStore) {}

  /** The last visit to a tag's page, or undefined when it was never counted. */
  public get(tagKey: string): TagVisit | undefined {
    return readTagVisit(this.store.get<unknown>(`${TAG_VISIT_PREFIX}${tagKey}`));
  }

  /** When each tag's page was last seen, by tag key. */
  public seenAt(): ReadonlyMap<string, number> {
    const list = this.store.get<unknown>(TAG_VISITS_KEY);
    if (!isRecord(list)) {
      return new Map();
    }
    return new Map(Object.entries(list).filter((entry): entry is [string, number] => isTime(entry[1])));
  }

  /**
   * Counts a visit: replaces the tag's snapshot with this one. Tags `exists`
   * says are gone lose theirs, and past the cap the oldest visits go.
   */
  public async record(tagKey: string, visit: TagVisit, exists: (tagKey: string) => boolean = () => true): Promise<void> {
    const times = new Map(this.seenAt());
    times.delete(tagKey);
    const kept = [...times.entries()]
      .filter(([key]) => exists(key))
      .sort((left, right) => right[1] - left[1])
      .slice(0, TAG_VISIT_LIMIT - 1);
    const dropped = [...times.keys()].filter((key) => !kept.some(([candidate]) => candidate === key));
    await this.store.update(`${TAG_VISIT_PREFIX}${tagKey}`, visit);
    for (const key of dropped) {
      await this.store.update(`${TAG_VISIT_PREFIX}${key}`, undefined);
    }
    await this.store.update(TAG_VISITS_KEY, Object.fromEntries([[tagKey, visit.seenAt], ...kept]));
    this.changeEmitter.fire();
  }

  /** The Hubs view's sort: by name until the reader chooses What's new. */
  public hubSort(): HubSort {
    return this.store.get<unknown>(HUB_SORT_KEY) === 'new' ? 'new' : 'name';
  }

  /** Keeps the Hubs view's sort; by name is kept as nothing. */
  public async setHubSort(sort: HubSort): Promise<void> {
    await this.store.update(HUB_SORT_KEY, sort === 'new' ? 'new' : undefined);
    this.changeEmitter.fire();
  }

  /** Stops telling listeners; what was stored stays. */
  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** A time a visit could have counted at: a whole number of milliseconds from the epoch. */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Whether a value is a list of text. */
function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Whether a value is a record of text by text. */
function isTextRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** A stored value read as a visit, or undefined when it is not one. */
export function readTagVisit(value: unknown): TagVisit | undefined {
  if (!isRecord(value) || !isTime(value.seenAt) || !isTextRecord(value.entries) || !isTextRecord(value.fields)) {
    return undefined;
  }
  const tasks = value.tasks;
  if (!isRecord(tasks) || !isTextList(tasks.open) || !isTextList(tasks.done)) {
    return undefined;
  }
  return {
    seenAt: value.seenAt,
    entries: { ...value.entries },
    tasks: { open: [...tasks.open], done: [...tasks.done] },
    fields: { ...value.fields },
    ...(isTextList(value.answered) ? { answered: [...value.answered] } : {}),
  };
}
