import { Emitter } from '../../shared/emitter';
import type { Disposable, Event } from '../../ports/events';
import type { KeyValueStore } from '../../ports/keyValueStore';

import type { PersistedPreferences } from '../../domain/model/preferences';
import {
  clonePreferences,
  normalizePreferences,
  omitWorkspacePreferences,
  pickWorkspacePreferences,
} from './preferencesSchema';

/** The key the blob is kept under, in both stores. */
const preferencesKey = 'deckard.preferences';

/** Set once the machine-wide store has handed its content to a workspace. */
const workspaceScopedKey = 'deckard.preferences.workspaceScoped';

/**
 * What a caller that reads the preferences, and changes none of them,
 * receives: the blob, and the events that say it changed. A caller that
 * changes something takes the service that owns that capability instead.
 */
export interface PreferencesReader {
  /** A defensive copy of the blob as it stands. */
  readonly value: PersistedPreferences;
  /** Fires after each change is kept, with a copy of the whole blob. */
  readonly onDidChange: Event<PersistedPreferences>;
  /** Fires when a visit or a carried view count was kept quietly. */
  readonly onDidRecordVisit: Event<void>;
}

/**
 * Where the preferences are kept: the one blob, read once when the
 * repository is made, written through one queue to the two stores it is
 * split across, and announced after each write.
 *
 * It owns persistence and nothing else. What a change means is the
 * services' business; what shape a blob may have is the schema's, and
 * every write passes through `normalizePreferences`, so old or malformed
 * state cannot leak unsupported sort modes, duplicate ids, or invalid
 * access counts.
 */
export class PreferencesRepository implements PreferencesReader, Disposable {
  private readonly changeEmitter = new Emitter<PersistedPreferences>();
  private readonly visitEmitter = new Emitter<void>();
  private preferences: PersistedPreferences;
  private updateQueue: Promise<void> = Promise.resolve();

  /** A seed from the machine-wide store, waiting to be written. */
  private seeded: Partial<PersistedPreferences> | undefined;

  /** Fires after each change is kept, with a copy of the whole blob. */
  public readonly onDidChange: Event<PersistedPreferences> = this.changeEmitter.event;

  /**
   * Fires when a visit or a carried view count was kept quietly: only Home's
   * Recently opened needs to hear it.
   */
  public readonly onDidRecordVisit: Event<void> = this.visitEmitter.event;

  /**
   * `workspaceState` carries the preferences that name workspace content. It
   * is left out when no folder is open, where there is no workspace to own
   * them and nothing to index; the store then reads and writes the
   * machine-wide blob alone, as it always did.
   */
  public constructor(
    private readonly state: KeyValueStore,
    private readonly workspaceState?: KeyValueStore,
  ) {
    const global = state.get<Partial<PersistedPreferences>>(preferencesKey);
    if (!this.workspaceState) {
      this.preferences = normalizePreferences(global);
      return;
    }
    const workspace =
      this.workspaceState.get<Partial<PersistedPreferences>>(preferencesKey);
    // The first workspace opened after the upgrade adopts what was kept
    // machine-wide, so a reader with one set of notes sees no change at all.
    // Later workspaces start clean rather than inheriting another's tags,
    // which they would prune away anyway.
    if (
      workspace === undefined &&
      !state.get<boolean>(workspaceScopedKey, false)
    ) {
      this.seeded = pickWorkspacePreferences(global);
    }
    // The machine-wide blob keeps a whole copy, so its workspace keys have to
    // be dropped before the workspace's own are laid over it. Without that, a
    // workspace with nothing stored would read the last one's favorites.
    this.preferences = normalizePreferences({
      ...omitWorkspacePreferences(global),
      ...(workspace ?? this.seeded ?? {}),
    });
  }

  /**
   * Writes a seed taken from the machine-wide store into the workspace, and
   * records that it has been handed over. Call once, after construction.
   *
   * The machine-wide blob keeps a whole copy. That is what an older Deckard
   * reads, and what seeds a workspace whose own storage VS Code has since
   * cleaned up; it is never read while the workspace has one of its own.
   */
  public async initialize(): Promise<void> {
    if (!this.workspaceState || this.seeded === undefined) {
      return;
    }
    this.seeded = undefined;
    // Through the same queue as every other write, so a preference changed
    // before the handover lands is not overwritten by it.
    const write = async (): Promise<void> => {
      await this.persist(clonePreferences(this.preferences), new Set());
      await this.state.update(workspaceScopedKey, true);
    };
    const queued = this.updateQueue.then(write, write);
    this.updateQueue = queued;
    await queued;
  }

  /**
   * The blob as it stands, not a copy: what the services read to decide a
   * change. They never mutate it; a change goes through `update`.
   */
  public get current(): PersistedPreferences {
    return this.preferences;
  }

  /**
   * A defensive copy, because callers use snapshots as freely mutable
   * view-model input while the repository must keep its state private.
   */
  public snapshot(): PersistedPreferences {
    return clonePreferences(this.preferences);
  }

  /** The same copy as `snapshot()`, as what a reader reads. */
  public get value(): PersistedPreferences {
    return this.snapshot();
  }

  /**
   * Normalizes, persists, and broadcasts one change. The new blob is held at
   * once, so the next change builds on it; the writes wait their turn in the
   * queue, so two changes land in the order they were made.
   *
   * A quiet change is kept without telling every open page, since a visit
   * recorded on each note switch would redraw them all; only
   * `onDidRecordVisit` hears of it.
   */
  public async update(
    changes: Partial<PersistedPreferences>,
    quiet = false,
  ): Promise<void> {
    const previous = this.preferences;
    this.preferences = normalizePreferences({
      ...this.preferences,
      ...changes,
    });
    const nextPreferences = clonePreferences(this.preferences);
    const changed = changedKeys(previous, this.preferences, changes);
    const persist = async (): Promise<void> => {
      await this.persist(nextPreferences, changed);
      if (quiet) {
        this.visitEmitter.fire();
      } else {
        this.changeEmitter.fire(clonePreferences(nextPreferences));
      }
    };
    const queuedUpdate = this.updateQueue.then(persist, persist);
    this.updateQueue = queuedUpdate;
    await queuedUpdate;
  }

  /**
   * Releases the event sources owned by this repository.
   */
  public dispose(): void {
    this.changeEmitter.dispose();
    this.visitEmitter.dispose();
  }

  /**
   * Writes one blob to the two stores it is split across. The workspace's
   * share is authoritative; the machine-wide copy is a backup and a seed.
   *
   * Every window shares the machine-wide store, and each read it once, when
   * it started. Writing this window's whole blob there would put back every
   * machine-wide choice another window has made since, such as a sort mode,
   * on the next visit this window records. So only the keys in `changed`
   * are laid over what the store holds now; the workspace's share of the
   * copy is this window's whole, so the copy stays one workspace's set.
   */
  private async persist(
    next: PersistedPreferences,
    changed: ReadonlySet<string>,
  ): Promise<void> {
    const stored = this.state.get<Partial<PersistedPreferences>>(preferencesKey);
    const merged: Record<string, unknown> = { ...(stored ?? next) };
    for (const key of changed) {
      merged[key] = next[key as keyof PersistedPreferences];
    }
    await this.state.update(
      preferencesKey,
      normalizePreferences(
        this.workspaceState
          ? { ...omitWorkspacePreferences(merged), ...pickWorkspacePreferences(next) }
          : merged,
      ),
    );
    await this.workspaceState?.update(
      preferencesKey,
      pickWorkspacePreferences(next),
    );
  }
}

/**
 * The keys one update changes: those it was given, even when the value is
 * the one this window already held, since another window may have stored
 * another since, and any other that normalizing it changed.
 */
function changedKeys(
  previous: PersistedPreferences,
  next: PersistedPreferences,
  changes: Partial<PersistedPreferences>,
): ReadonlySet<string> {
  const changed = new Set<string>(Object.keys(changes));
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]) as Set<keyof PersistedPreferences>;
  for (const key of keys) {
    if (!changed.has(key) && JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      changed.add(key);
    }
  }
  return changed;
}
