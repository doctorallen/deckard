import type { Disposable } from '../../ports/events';
import type { Progress, ProgressReport } from '../../ports/progress';
import type { ResourceUri } from '../../ports/uri';
import { Emitter } from '../../shared/emitter';
import {
  EntrySearchOptions,
  EntrySearchResult,
  ScanCounts,
  SearchStore,
} from '../storage/searchStore';
import { measure, measureAsync, reportError } from '../../shared/timing';
import { ParsedFile, Task, UnreadableNote, WorkspaceIndex } from '../types';
import type { ChangeTarget, QueuedChange } from './changeWatcher';
import type { IndexContents, IndexScanStatus, IndexSearch, RefreshOptions } from './indexReader';
import { IndexState, NoteChange } from '../../domain/index/indexState';
import { computeParked, NO_PARKED_RULES, ParkedRules } from '../../domain/index/parked';
import { FileStamp, WorkspaceScanner, describeError } from './scanner';
import type { ViewPublisher } from './viewPublisher';

/** What the index service can be given beyond its scanner, cache, and publisher. */
export interface IndexServiceOptions {
  /**
   * Deckard's version. The parsed notes in the cache are kept only for the
   * version that parsed them, since a new version may parse differently.
   */
  version?: string;
  /**
   * Whether a start shows the notes the cache kept before reading any. Off
   * in the Development and Test extension modes, where the parser can
   * change without the version changing.
   */
  readCache?: boolean;
  /**
   * Where a scan shows its progress: the window's status bar, in the
   * extension. Without it, a test's, a scan reports nowhere.
   */
  progress?: Progress;
}

/** Progress for a scan with nowhere to show it: the task runs as it is. */
const PROGRESS_NOWHERE: Progress = {
  withProgress: (_title, task) => task({ report: () => undefined }),
};

/**
 * Owns the live note cache and turns scanner output into lookup maps for the UI.
 *
 * It holds the notes and the index derived from them, starts from the cache
 * or a scan, checks a warm start against the files, applies the batches the
 * change queue lets go, writes the full-text cache, and keeps the notes that
 * could not be read. It publishes through a {@link ViewPublisher} and hears
 * about changes as a {@link ChangeTarget}; it knows nothing of VS Code.
 *
 * Files are cached separately from the derived index so rapid editor and file
 * watcher events can be coalesced before one consistent snapshot is published.
 */
export class IndexService<U extends ResourceUri = ResourceUri>
  implements IndexContents, IndexSearch, IndexScanStatus, ChangeTarget<U>, Disposable
{
  /** The notes and the index derived from them, updated a note at a time. */
  private state = IndexState.build([]);
  /** The parse settings the notes in the state were read under. */
  private parsedUnder: string | undefined;
  private readyPromise: Promise<void> = Promise.resolve();
  private disposed = false;
  private indexedOnce = false;
  /** The derived index, kept until the notes next change. */
  private snapshot: WorkspaceIndex | undefined;
  /** What `deckard.parked` parks, read once per scan or settings change. */
  private parkedRules: ParkedRules | undefined;
  /** Notes in the workspace that are not in the index, and why. */
  private readonly unreadable = new Map<string, string>();
  /** How far the scan under way has got, or nothing between scans. */
  private scanState: { completed: number; total: number } | undefined;
  private readonly progressEmitter = new Emitter<void>();
  /**
   * Fires as a scan moves on, at most every few percent, so a view that says
   * it is waiting can say how far along it is.
   */
  public readonly onDidProgress = this.progressEmitter.event;
  /** Whether the index shows the cache's notes, not yet checked against the files. */
  private staleFromCache = false;
  /** The last session's scan counts, shown until a warm start's check finishes. */
  private cachedScan: ScanCounts | undefined;
  private readonly version: string;
  private readonly readCache: boolean;
  private readonly progress: Progress;

  /** `searchStore` is the full-text cache, absent in a test that needs none. */
  public constructor(
    private readonly scanner: WorkspaceScanner<U>,
    private readonly searchStore: SearchStore | undefined,
    private readonly publisher: Pick<ViewPublisher, 'publish'>,
    options: IndexServiceOptions = {},
  ) {
    this.version = options.version ?? '';
    this.readCache = options.readCache ?? false;
    this.progress = options.progress ?? PROGRESS_NOWHERE;
  }

  /** Whether a first scan has finished, so the index holds the workspace. */
  public get hasIndexed(): boolean {
    return this.indexedOnce;
  }

  /** How far the scan under way has got: "412 of 3,760 notes", or nothing. */
  public get scanProgress(): { completed: number; total: number } | undefined {
    return this.scanState;
  }

  /**
   * Whether the index is the notes as the cache kept them, still being
   * checked against the files. It is replaced within about a second.
   */
  public get isStale(): boolean {
    return this.staleFromCache;
  }

  /**
   * Exposes the initial scan as a barrier for commands that need complete data.
   */
  public get ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Starts from the cache, or with a full scan, and makes that the scan `ready` waits for. */
  public start(): Promise<void> {
    this.readyPromise = this.startFromCache();
    return this.readyPromise;
  }

  /**
   * The notes the workspace has that the index does not, because they could
   * not be read, with why. Sorted by path so two reports of the same state
   * read the same.
   */
  public getUnreadable(): UnreadableNote[] {
    return [...this.unreadable]
      .map(([filePath, reason]) => ({ filePath, reason }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  /** What the last full scan found, kept out, and read. */
  public getLastScan(): { found: number; templates: number; excluded: number; read: number } {
    // Until the check at a warm start finishes, the last session's counts.
    return { ...(this.cachedScan ?? this.scanner.lastScan) };
  }

  /**
   * Returns the derived index, built once per change to the notes and shared
   * by every caller until the next one, so callers treat it as read-only.
   *
   * Building it walks every note, and editor features ask for it on every
   * keystroke and cursor move, so rebuilding per call was the main cost of
   * typing in a large workspace.
   */
  public getSnapshot(): WorkspaceIndex {
    return this.snapshot ?? this.publishState('Build index', () => undefined, describeBuild);
  }

  /**
   * Looks up a task from the latest derived index for source-safe actions.
   */
  public getTask(taskId: string): Task | undefined {
    return this.getSnapshot().tasks.get(taskId);
  }

  /** What `deckard.parked` parks now, as the index reads it. */
  public getParkedRules(): ParkedRules {
    this.parkedRules ??=
      typeof this.scanner.getParkedRules === 'function'
        ? this.scanner.getParkedRules()
        : NO_PARKED_RULES;
    return this.parkedRules;
  }

  /**
   * Searches the local full-text cache for note entries and tasks, best
   * first. The ids it returns are the live index's, so a caller can open or
   * filter by them directly.
   */
  public searchEntries(
    query: string,
    options?: EntrySearchOptions,
  ): EntrySearchResult {
    return (
      this.searchStore?.searchEntries(query, options) ?? {
        matches: [],
        partial: false,
      }
    );
  }

  /**
   * Answers the closest word the notes contain for each word they do not,
   * so a surface that searches the index itself can correct a misspelling
   * the same way the full-text cache does.
   */
  public suggestWords(terms: readonly string[]): ReadonlyMap<string, string> {
    return this.searchStore?.suggestWords(terms) ?? new Map();
  }

  /**
   * Performs a full replacement refresh while reporting progress.
   *
   * A note whose saved time, created time, and size are what they were when
   * it was last read, under the same parse settings, is not read again, so
   * a rescan after an exclude or folder change costs a stat per note.
   * `reuse: 'none'` rereads and reparses every note: Reindex Workspace.
   * `reuse: 'cache'` is a warm start's check, which applies only what
   * differs from the notes on screen and publishes nothing if nothing does.
   */
  public async refresh(options: RefreshOptions = {}): Promise<void> {
    if (this.disposed) {
      return;
    }
    const checking = options.reuse === 'cache';
    this.parkedRules = undefined;
    const fingerprint = this.scanner.getParseFingerprint();
    const reusable =
      options.reuse !== 'none' && this.parsedUnder === fingerprint
        ? this.state.files
        : undefined;

    await this.progress.withProgress(
      checking ? 'Deckard: Checking notes for changes' : 'Deckard: Indexing workspace',
      async (progress) => {
        const parsedFiles = await this.scanWorkspace(progress, reusable);
        this.scanState = undefined;
        if (this.disposed) {
          return;
        }
        let changed = true;
        if (checking) {
          changed = this.applyCheck(parsedFiles);
        } else {
          this.applyRebuild(parsedFiles, reusable !== undefined);
        }
        this.finishScan(fingerprint);
        if (changed) {
          this.emitUpdate();
        }
      },
    );
  }

  /** Forgets the parked rules read, so the next index reads `deckard.parked` again. */
  public forgetParkedRules(): void {
    this.parkedRules = undefined;
  }

  /**
   * Republishes with parking worked out again from `deckard.parked`, reading
   * no note. Before a first scan there is nothing to redraw.
   */
  public republishParking(): void {
    if (!this.indexedOnce) {
      return;
    }
    this.snapshot = undefined;
    this.emitUpdate();
  }

  /** Scans again after a settings or folder change, and makes that the scan `ready` waits for. */
  public rescan(): void {
    this.readyPromise = this.refresh();
  }

  /**
   * Applies all queued changes together so observers never see half a batch.
   *
   * Saved-file reads refresh timestamps; in-memory parses reuse prior metadata
   * because unsaved editor content cannot provide a trustworthy file stat.
   */
  public async applyQueued(updates: ReadonlyArray<QueuedChange<U>>): Promise<void> {
    const changes = await measureAsync(
      'Read changed notes',
      () => this.readUpdates(updates),
      () => `${updates.length} ${updates.length === 1 ? 'note' : 'notes'}`,
    );
    if (this.disposed) {
      return;
    }
    // Only the changed notes' parts of the index are worked out again; the
    // rest is reused from the index before.
    this.publishState('Update index', () => this.state.apply(changes), describeUpdate(changes));
    this.emitUpdate();
  }

  /**
   * Stops the progress events and closes the full-text cache, so a scan or
   * read still under way publishes nothing when it finishes.
   */
  public dispose(): void {
    this.disposed = true;
    this.progressEmitter.dispose();
    this.searchStore?.dispose();
  }

  /**
   * A warm start: the notes as they were when VS Code last closed, shown at
   * once, then checked against the files, rereading only the notes whose
   * saved time, created time, or size changed. A cold start is a full scan.
   */
  private async startFromCache(): Promise<void> {
    const store = this.searchStore;
    const fingerprint = this.scanner.getParseFingerprint();
    if (!store || !this.readCache) {
      return this.refresh();
    }
    const cached = await this.readCachedNotes(store, fingerprint);
    if (!cached || cached.length === 0 || this.disposed) {
      return this.refresh();
    }
    this.publishState('Build index', () => {
      this.state = IndexState.build(cached);
    }, describeBuild);
    this.parsedUnder = fingerprint;
    this.staleFromCache = true;
    this.cachedScan = store.readLastScan();
    this.indexedOnce = true;
    this.emitUpdate();
    try {
      await this.refresh({ reuse: 'cache' });
    } finally {
      this.staleFromCache = false;
      this.cachedScan = undefined;
    }
  }

  /**
   * The notes the cache kept under this fingerprint that are still notes,
   * in the cache's order, or nothing when it kept none under it.
   */
  private async readCachedNotes(store: SearchStore, fingerprint: string): Promise<ParsedFile[] | undefined> {
    const cached: ParsedFile[] = [];
    const found = await measureAsync(
      'Load notes from cache',
      () =>
        store.readParsedNotes(this.cacheFingerprint(fingerprint), (page) =>
          page.forEach((file) => {
            // A note excluded, or a folder removed, while VS Code was
            // closed is no longer a note.
            const uri = this.scanner.getUri(file.filePath);
            if (uri && this.scanner.isNotesFile(uri)) {
              cached.push(file);
            }
          }),
        ),
      () => `${cached.length} notes`,
    );
    return found ? cached : undefined;
  }

  /**
   * Reads and parses the workspace, reusing each note in `reusable` whose
   * stat is unchanged, and encoding each note for the cache as it is read.
   */
  private scanWorkspace(
    progress: ProgressReport,
    reusable: ReadonlyMap<string, ParsedFile> | undefined,
  ): Promise<ParsedFile[]> {
    return measureAsync(
      'Scan workspace',
      () =>
        this.scanner.scan(
          (completed, total): void => this.reportScan(progress, completed, total),
          reusable && ((filePath, stamp) => reuseUnchanged(reusable.get(filePath), stamp)),
          // Each note is encoded for the cache as it is read, rather
          // than all of them in one turn when the cache is written.
          this.searchStore && ((file) => this.searchStore?.prepare(file)),
        ),
      (files) => `${files.length} notes`,
    );
  }

  /**
   * Shows how far a scan has got in the progress, and tells the views that
   * wait on it at most every 2 percent, and at the end.
   */
  private reportScan(progress: ProgressReport, completed: number, total: number): void {
    const step = Math.max(1, Math.floor(total / 50));
    if (completed === total || completed % step === 0) {
      this.scanState = { completed, total };
      this.progressEmitter.fire();
    }
    progress.report({
      message:
        total > 0
          ? `${completed}/${total} Markdown files`
          : 'No Markdown files',
      increment: total > 0 ? 100 / total : 0,
    });
  }

  /**
   * Applies a warm start's check, and answers whether anything changed.
   * The cache's notes are on screen already: only what differs from them
   * is applied, and nothing is published if nothing does.
   */
  private applyCheck(parsedFiles: readonly ParsedFile[]): boolean {
    const changes = measure(
      'Check notes for changes',
      () => this.diffAgainstScan(parsedFiles),
      (found) =>
        `${parsedFiles.length} notes, ${found.filter((change) => change.file).length} changed, ${found.filter((change) => !change.file).length} gone`,
    );
    if (changes.length === 0) {
      return false;
    }
    this.publishState('Update index', () => this.state.apply(changes), describeUpdate(changes));
    return true;
  }

  /**
   * Builds the state from a scan, keeping each reused note's worked-out part
   * when the scan reused notes of the state before.
   */
  private applyRebuild(parsedFiles: readonly ParsedFile[], reused: boolean): void {
    const previous = this.state;
    this.publishState('Build index', () => {
      this.state = IndexState.build(parsedFiles, reused ? previous : undefined);
    }, describeBuild);
  }

  /**
   * What every finished scan records: the parse settings it read under, the
   * notes it could not read, and the full-text cache written from it.
   */
  private finishScan(fingerprint: string): void {
    this.parsedUnder = fingerprint;
    this.unreadable.clear();
    this.scanner.failures.forEach((failure) =>
      this.unreadable.set(failure.filePath, failure.reason),
    );
    this.persistToCache(fingerprint);
    this.indexedOnce = true;
    this.staleFromCache = false;
    this.cachedScan = undefined;
  }

  /** Writes the notes and the scan's counts to the full-text cache. */
  private persistToCache(fingerprint: string): void {
    measure(
      'Rebuild search index',
      () => {
        this.searchStore?.replace(this.state.files.values(), this.cacheFingerprint(fingerprint));
        this.searchStore?.writeLastScan(this.scanner.lastScan);
      },
      () => `${this.state.files.size} notes`,
    );
    // What the store handed to its worker is still being written. The
    // log says when it lands, because until then a search finds a note
    // by its title and tags but not yet by the words inside it.
    this.reportSearchIndexWritten();
  }

  /** What a scan found that the index does not hold as it is, in scan order. */
  private diffAgainstScan(parsedFiles: readonly ParsedFile[]): NoteChange[] {
    const changes: NoteChange[] = [];
    const scanned = new Set<string>();
    parsedFiles.forEach((file) => {
      scanned.add(file.filePath);
      if (this.state.files.get(file.filePath) !== file) {
        changes.push({ filePath: file.filePath, file });
      }
    });
    this.state.files.forEach((_, filePath) => {
      if (!scanned.has(filePath)) {
        changes.push({ filePath });
      }
    });
    return changes;
  }

  /**
   * What the notes in the cache were parsed under: the parse settings, this
   * version of Deckard, and the time zone, since the parser reads a
   * written date as a local one. Any change rebuilds the cache.
   */
  private cacheFingerprint(parseFingerprint = this.scanner.getParseFingerprint()): string {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    return [parseFingerprint, this.version, timeZone].join('\u0002');
  }

  /** Times the part of a rebuild that finished after the host moved on. */
  private reportSearchIndexWritten(): void {
    const store = this.searchStore;
    if (store) {
      void measureAsync('Write search index off the extension host', () =>
        store.whenIdle(),
      );
    }
  }

  /**
   * Derives the index from the state once `mutate` has changed it, marks
   * parking on it, and keeps it as the snapshot every caller shares, timed
   * under `label`. Every path that changes the state derives through here,
   * so none can forget parking.
   */
  private publishState(
    label: 'Build index' | 'Update index',
    mutate: () => void,
    describe: (index: WorkspaceIndex) => string,
  ): WorkspaceIndex {
    this.snapshot = measure(
      label,
      () => {
        mutate();
        return this.withParking(this.state.snapshot());
      },
      describe,
    );
    return this.snapshot;
  }

  /**
   * Marks what `deckard.parked` parks on a newly derived index. Parking is a
   * setting, not part of a note, so it is worked out after the notes' own
   * parts are folded, and a change to it redraws without reading any note.
   */
  private withParking(index: WorkspaceIndex): WorkspaceIndex {
    // A stand-in scanner in a test may not read settings at all.
    index.parked = computeParked(index, this.getParkedRules());
    return index;
  }

  /** Reads what changed, in the order it was queued, as changes to apply. */
  private async readUpdates(updates: ReadonlyArray<QueuedChange<U>>): Promise<NoteChange[]> {
    const changes: NoteChange[] = [];
    for (const update of updates) {
      const filePath = this.scanner.getFilePath(update.uri);
      if (update.deleted) {
        changes.push({ filePath });
        this.unreadable.delete(filePath);
        this.searchStore?.remove(filePath);
        continue;
      }

      try {
        const previous = this.state.files.get(filePath);
        const parsedFile =
          update.content === undefined
            ? await this.scanner.read(update.uri)
            : this.scanner.parse(update.uri, update.content, previous?.fileTimes);
        changes.push({ filePath, file: parsedFile });
        this.unreadable.delete(filePath);
        this.searchStore?.upsert(parsedFile);
      } catch (error) {
        reportError(`Could not update ${filePath}`, error);
        this.unreadable.set(filePath, describeError(error));
      }
    }
    return changes;
  }

  /**
   * Publishes a newly derived snapshot after the cache is internally
   * consistent: the plain listeners now, each view in a turn of its own, as
   * `ViewPublisher` orders them.
   */
  private emitUpdate(): void {
    this.publisher.publish(() => this.getSnapshot());
  }
}

/** What the log says of a full build: "3 notes, 12 entries". */
function describeBuild(index: WorkspaceIndex): string {
  return `${index.files.size} notes, ${index.sections.size} entries`;
}

/** What the log says of an update: "1 note changed, 3 notes". */
function describeUpdate(changes: readonly NoteChange[]): (index: WorkspaceIndex) => string {
  return (index) =>
    `${changes.length} ${changes.length === 1 ? 'note' : 'notes'} changed, ${index.files.size} notes`;
}

/**
 * The note as already parsed, when the file is still as it was then: same
 * saved time, created time, and size.
 */
function reuseUnchanged(
  file: ParsedFile | undefined,
  stamp: FileStamp,
): ParsedFile | undefined {
  return file &&
    file.fileTimes?.updatedAt === stamp.mtime &&
    file.fileTimes.createdAt === stamp.ctime &&
    Buffer.byteLength(file.content, 'utf8') === stamp.size
    ? file
    : undefined;
}
