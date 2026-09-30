import type { Disposable } from '../../ports/events';
import type { ResourceUri } from '../../ports/uri';
import type { WorkspaceEvents } from '../../ports/workspaceEvents';
import { Reactions, reactionsTo, WorkspaceChange } from './changeReactions';
import type { WorkspaceScanner } from './scanner';
import type { OwnWrites } from './writeHistory';

/** A file waiting in the change queue: its newest content, or its removal. */
export interface QueuedChange<U extends ResourceUri = ResourceUri> {
  uri: U;
  /** Content an editor holds, parsed as it is; absent, the file is read. */
  content?: string;
  deleted: boolean;
}

/**
 * What the watcher asks of the index when a change needs more than a queued
 * read: the parts of a reaction the index itself carries out.
 */
export interface ChangeTarget<U extends ResourceUri = ResourceUri> {
  /** Forgets the parked rules read, so the next index reads them again. */
  forgetParkedRules(): void;
  /** Republishes the index with parking worked out again, once a first scan has built it. */
  republishParking(): void;
  /** Scans the workspace again, which `ready` then waits for. */
  rescan(): void;
  /** Reads and applies a batch the queue let go of, all at once. */
  applyQueued(changes: ReadonlyArray<QueuedChange<U>>): Promise<void>;
}

/** What the watcher needs of the scanner: which files are notes, and the globs that find them. */
export type WatchedNotes<U extends ResourceUri> = Pick<WorkspaceScanner<U>, 'isNotesFile' | 'getPatterns'>;

/** How long the queue waits after the last change before it lets the batch go, in milliseconds. */
const DEBOUNCE_MS = 200;

/**
 * Hears every change to the workspace through the {@link WorkspaceEvents}
 * port, asks {@link reactionsTo} what each one requires, and carries it out:
 * the watchers and the change queue itself, the rest through its target.
 *
 * The queue is keyed by URI and keeps only the newest change for each. It
 * lets the batch go 200 ms after the last change, or at once for a note
 * Deckard just saved itself, so typing and a burst of watcher events cost
 * one update rather than one each.
 */
export class ChangeWatcher<U extends ResourceUri = ResourceUri> implements Disposable {
  private readonly disposables: Disposable[] = [];
  private readonly watcherDisposables: Disposable[] = [];
  private readonly pending = new Map<string, QueuedChange<U>>();
  private flushHandle: ReturnType<typeof setTimeout> | undefined;

  /**
   * Without `events`, a test's, the watcher hears nothing and changes come
   * only through the queue. Without `ownWrites`, every save is debounced.
   */
  public constructor(
    private readonly notes: WatchedNotes<U>,
    private readonly target: ChangeTarget<U>,
    private readonly events?: WorkspaceEvents<U>,
    private readonly ownWrites?: Pick<OwnWrites, 'take'>,
  ) {}

  /**
   * Connects configuration, workspace, editor, and filesystem changes to one
   * queued update path so every source of change produces the same index shape.
   */
  public start(): void {
    const events = this.events;
    if (!events) {
      return;
    }
    this.disposables.push(
      events.onDidChangeConfiguration((event) =>
        this.react({ kind: 'settings', affects: (section) => event.affectsConfiguration(section) }),
      ),
    );
    this.disposables.push(events.onDidChangeWorkspaceFolders(() => this.react({ kind: 'folders' })));
    this.disposables.push(
      events.onDidSaveTextDocument((document) =>
        this.react({ kind: 'save', isNote: this.notes.isNotesFile(document.uri) }, document.uri),
      ),
    );
    this.replaceWatchers();
  }

  /**
   * Replaces pending work for a URI because only its newest content matters.
   * `now` lets the batch go at once rather than after the debounce.
   */
  public queueUpsert(uri: U, content?: string, now = false): void {
    this.pending.set(uri.toString(), { uri, content, deleted: false });
    this.scheduleFlush(now);
  }

  /**
   * Coalesces deletion with other URI changes before rebuilding the index.
   */
  public queueDelete(uri: U): void {
    this.pending.set(uri.toString(), { uri, deleted: true });
    this.scheduleFlush();
  }

  /**
   * Stops the queue's timer and every listener and watcher, so a late event
   * cannot queue anything.
   */
  public dispose(): void {
    if (this.flushHandle) {
      clearTimeout(this.flushHandle);
    }
    this.watcherDisposables.splice(0).forEach((disposable) => disposable.dispose());
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Carries out what one change requires, in the order {@link Reactions} names. */
  private react(change: WorkspaceChange, uri?: U): void {
    const reactions = reactionsTo(change);
    if (reactions.forgetParkedRules) {
      this.target.forgetParkedRules();
    }
    if (reactions.republishParking) {
      this.target.republishParking();
    }
    if (reactions.rewatch) {
      this.replaceWatchers();
    }
    if (reactions.rescan) {
      this.target.rescan();
    }
    if (uri) {
      this.queue(reactions, uri);
    }
  }

  /** Queues the file a change names, as its reactions say. */
  private queue(reactions: Reactions, uri: U): void {
    if (reactions.queue === 'delete') {
      this.queueDelete(uri);
      return;
    }
    if (reactions.queue !== 'upsert') {
      return;
    }
    // A note Deckard just wrote is read back at once. The write is taken
    // only for a note, so a save of any other file leaves it waiting.
    const now = reactions.ownWriteSkipsDebounce && (this.ownWrites?.take(uri.toString()) ?? false);
    this.queueUpsert(uri, undefined, now);
  }

  /**
   * Recreates globs when the configured notes boundary changes.
   */
  private replaceWatchers(): void {
    this.watcherDisposables.splice(0).forEach((disposable) => disposable.dispose());
    const events = this.events;
    if (!events) {
      return;
    }
    for (const pattern of this.notes.getPatterns()) {
      const watcher = events.createFileSystemWatcher(pattern);
      this.watcherDisposables.push(watcher);
      // The glob can take in files that are not notes, such as templates.
      const upsertNote = (kind: 'created' | 'changed') => (uri: U) =>
        this.react({ kind, isNote: this.notes.isNotesFile(uri) }, uri);
      this.watcherDisposables.push(watcher.onDidCreate(upsertNote('created')));
      this.watcherDisposables.push(watcher.onDidChange(upsertNote('changed')));
      this.watcherDisposables.push(watcher.onDidDelete((uri) => this.react({ kind: 'deleted' }, uri)));
    }
  }

  /**
   * Debounces bursts from typing and filesystem watchers into one refresh event.
   */
  private scheduleFlush(now = false): void {
    if (this.flushHandle) {
      if (!now) {
        return;
      }
      // A write of Deckard's own does not wait out another's debounce.
      clearTimeout(this.flushHandle);
    }

    this.flushHandle = setTimeout(() => {
      this.flushHandle = undefined;
      void this.flush();
    }, now ? 0 : DEBOUNCE_MS);
  }

  /** Lets the whole batch go at once, so no listener sees half of it. */
  private flush(): Promise<void> {
    const changes = [...this.pending.values()];
    this.pending.clear();
    return this.target.applyQueued(changes);
  }
}
