import { Emitter } from '../../shared/emitter';
import type { KeyValueStore } from '../../ports/keyValueStore';

/**
 * What Questions remembers that is not in the notes, per workspace: the
 * offered answers set aside with Not it, each a question and a line's
 * words (docs/implementation/38-questions.md § Offering an answer), and
 * the searches Find found nothing for, so its Ask it row can say how often
 * one was tried.
 *
 * It is kept in the workspace's own storage under keys of its own, apart
 * from the preferences blob: each list is short, capped, and means nothing
 * outside the workspace whose notes it names.
 */

/** The workspace-state key of the pairs set aside with Not it. */
export const NOT_IT_KEY = 'deckard.questions.notIt';
/** The workspace-state key of the searches Find found nothing for. */
export const MISSED_SEARCHES_KEY = 'deckard.questions.missedSearches';
/** The most pairs kept; the oldest go first. */
export const NOT_IT_LIMIT = 500;
/** The most missed searches kept; the least recent go first. */
export const MISSED_SEARCH_LIMIT = 200;

/** A search Find found nothing for: how many times, and when first. */
export interface MissedSearch {
  count: number;
  /** When it was first missed, in milliseconds since the epoch. */
  first: number;
  /** When it was last missed. */
  last: number;
}

/** The words of a search as a miss is kept by: lower case, one space between words. */
export function missedSearchKey(words: string): string {
  return words.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Questions' memory, over the workspace's key-value store. */
export class QuestionMemory {
  private readonly changeEmitter = new Emitter<void>();
  /** Fires when a pair is set aside, so whatever lists offers lists them again. */
  public readonly onDidChange = this.changeEmitter.event;
  private rejectedSet: ReadonlySet<string> | undefined;

  /** A memory over `store`, the workspace's state. */
  public constructor(private readonly store: KeyValueStore) {}

  /** The pairs set aside with Not it, as `notItKey` writes them. */
  public rejected(): ReadonlySet<string> {
    this.rejectedSet ??= new Set(readStrings(this.store.get<unknown>(NOT_IT_KEY)));
    return this.rejectedSet;
  }

  /** Sets a pair aside, so it is never offered again. */
  public async reject(key: string): Promise<void> {
    const kept = readStrings(this.store.get<unknown>(NOT_IT_KEY)).filter((each) => each !== key);
    kept.push(key);
    await this.store.update(NOT_IT_KEY, kept.slice(-NOT_IT_LIMIT));
    this.rejectedSet = undefined;
    this.changeEmitter.fire();
  }

  /** How often a search found nothing, and since when; undefined when it never has. */
  public missed(words: string): MissedSearch | undefined {
    return readMisses(this.store.get<unknown>(MISSED_SEARCHES_KEY))[missedSearchKey(words)];
  }

  /** Counts one more miss of a search, at `now`. */
  public async recordMiss(words: string, now: number): Promise<MissedSearch> {
    const key = missedSearchKey(words);
    const misses = readMisses(this.store.get<unknown>(MISSED_SEARCHES_KEY));
    const before = misses[key];
    const after: MissedSearch = { count: (before?.count ?? 0) + 1, first: before?.first ?? now, last: now };
    misses[key] = after;
    const kept = Object.entries(misses)
      .sort(([, left], [, right]) => right.last - left.last)
      .slice(0, MISSED_SEARCH_LIMIT);
    await this.store.update(MISSED_SEARCHES_KEY, Object.fromEntries(kept));
    return after;
  }

  /** Forgets a search's misses, once it has been asked as a question. */
  public async forgetMisses(words: string): Promise<void> {
    const misses = readMisses(this.store.get<unknown>(MISSED_SEARCHES_KEY));
    if (!Object.hasOwn(misses, missedSearchKey(words))) {
      return;
    }
    delete misses[missedSearchKey(words)];
    await this.store.update(MISSED_SEARCHES_KEY, misses);
  }

  /** Stops telling listeners of changes. */
  public dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** The strings in a stored list, leaving out anything else a hand edit left there. */
function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];
}

/** The misses in a stored record, each with its count and dates, leaving out any that cannot be read. */
function readMisses(value: unknown): Record<string, MissedSearch> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const misses: Record<string, MissedSearch> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    const { count, first, last } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (typeof count === 'number' && count > 0 && typeof first === 'number' && typeof last === 'number') {
      misses[key] = { count, first, last };
    }
  });
  return misses;
}
