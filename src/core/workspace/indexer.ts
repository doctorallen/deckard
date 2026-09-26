import * as vscode from 'vscode';

import {
  ParsedFile,
  Section,
  Task,
  WorkspaceIndex,
  UnreadableNote,
} from '../types';
import {
  EntrySearchOptions,
  EntrySearchResult,
  SearchStore,
} from '../storage/searchStore';
import { measure, measureAsync, reportError } from '../timing';
import { FileStamp, WorkspaceScanner, describeError } from './scanner';
import { takeOwnWrite } from './ownWrites';
import { IndexState, NoteChange } from './indexState';
import { ViewUpdateOptions } from './publishing';

/** What the indexer can be given beyond its scanner and cache. */
export interface WorkspaceIndexerOptions {
  /**
   * Deckard's version. The parsed notes in the cache are kept only for the
   * version that parsed them, since a new version may parse differently.
   */
  version?: string;
  /**
   * Runs a view's redraw in a later host turn. `setImmediate` by default; a
   * test passes its own to step through the turns.
   */
  schedule?: (run: () => void) => void;
}

/** A view waiting for its turn to redraw from the index. */
interface ViewSubscription {
  listener: () => void;
  options: ViewUpdateOptions;
  disposed: boolean;
}

/**
 * Owns the live note cache and turns scanner output into lookup maps for the UI.
 *
 * Files are cached separately from the derived index so rapid editor and file
 * watcher events can be coalesced before one consistent snapshot is published.
 */
export class WorkspaceIndexer implements vscode.Disposable {
  private readonly updateEmitter = new vscode.EventEmitter<WorkspaceIndex>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watcherDisposables: vscode.Disposable[] = [];
  /** The notes and the index derived from them, updated a note at a time. */
  private state = IndexState.build([]);
  /** The parse settings the notes in the state were read under. */
  private parsedUnder: string | undefined;
  private readonly pending = new Map<string, PendingUpdate>();
  private flushHandle: ReturnType<typeof setTimeout> | undefined;
  private readyPromise: Promise<void> = Promise.resolve();
  private disposed = false;
  /** The derived index, kept until the notes next change. */
  private snapshot: WorkspaceIndex | undefined;
  /** Notes in the workspace that are not in the index, and why. */
  private readonly unreadable = new Map<string, string>();
  /** How far the scan under way has got, or nothing between scans. */
  private scanState: { completed: number; total: number } | undefined;
  private readonly progressEmitter = new vscode.EventEmitter<void>();
  /**
   * Fires as a scan moves on, at most every few percent, so a view that says
   * it is waiting can say how far along it is.
   */
  public readonly onDidProgress = this.progressEmitter.event;
  /** Views that redraw in turns of their own, in the order they asked. */
  private readonly views = new Set<ViewSubscription>();
  /** The views still to redraw from the last publish, next first. */
  private viewQueue: ViewSubscription[] = [];
  private viewTurnScheduled = false;
  private readonly schedule: (run: () => void) => void;
  private readonly version: string;

  public constructor(
    private readonly scanner = new WorkspaceScanner(),
    private readonly searchStore?: SearchStore,
    options: WorkspaceIndexerOptions = {},
  ) {
    this.schedule = options.schedule ?? ((run) => void setImmediate(run));
    this.version = options.version ?? '';
    this.disposables.push(this.updateEmitter, this.progressEmitter);
  }

  /** Whether a first scan has finished, so the index holds the workspace. */
  public get hasIndexed(): boolean {
    return this.indexedOnce;
  }

  private indexedOnce = false;

  /** How far the scan under way has got: "412 of 3,760 notes", or nothing. */
  public get scanProgress(): { completed: number; total: number } | undefined {
    return this.scanState;
  }

  public readonly onDidUpdate = this.updateEmitter.event;

  /**
   * Redraws a view from the index after each update, in a host turn of its
   * own, after the plain listeners and in order of `priority` (the view in
   * front first). A view that has not had its turn when the index changes
   * again runs once, with the newer index.
   */
  public onDidUpdateView(
    listener: () => void,
    options: ViewUpdateOptions,
  ): vscode.Disposable {
    const subscription: ViewSubscription = { listener, options, disposed: false };
    this.views.add(subscription);
    return {
      dispose: () => {
        subscription.disposed = true;
        this.views.delete(subscription);
      },
    };
  }

  /**
   * Installs change listeners before the first refresh so edits during startup
   * are queued rather than lost.
   */
  public start(): Promise<void> {
    this.registerWatchers();
    this.readyPromise = this.refresh();
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
    return { ...this.scanner.lastScan };
  }

  /**
   * Exposes the initial scan as a barrier for commands that need complete data.
   */
  public get ready(): Promise<void> {
    return this.readyPromise;
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
    this.snapshot ??= measure(
      'Build index',
      () => this.state.snapshot(),
      (index) => `${index.files.size} notes, ${index.sections.size} entries`,
    );
    return this.snapshot;
  }

  /**
   * Looks up a task from the latest derived index for source-safe actions.
   */
  public getTask(taskId: string): Task | undefined {
    return this.getSnapshot().tasks.get(taskId);
  }

  /**
   * Looks up a section from the latest derived index for navigation actions.
   */
  public getSection(sectionId: string): Section | undefined {
    return this.getSnapshot().sections.get(sectionId);
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
   * Keeps path formatting owned by the scanner so all callers use one key shape.
   */
  public getFilePath(uri: vscode.Uri): string {
    return this.scanner.getFilePath(uri);
  }

  /**
   * Parses editor content through the scanner's workspace-specific settings.
   */
  public parse(
    uri: vscode.Uri,
    content: string,
    metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  ): ParsedFile {
    return this.scanner.parse(uri, content, metadata);
  }

  /**
   * Delegates notes-folder containment to the scanner's path boundary checks.
   */
  public isNotesFile(uri: vscode.Uri): boolean {
    return this.scanner.isNotesFile(uri);
  }

  public getNotesFolderUri(
    workspaceFolder: vscode.WorkspaceFolder,
  ): vscode.Uri {
    return this.scanner.getNotesFolderUri(workspaceFolder);
  }

  public getTemplatesFolderUri(
    workspaceFolder: vscode.WorkspaceFolder,
  ): vscode.Uri | undefined {
    return this.scanner.getTemplatesFolderUri(workspaceFolder);
  }

  /**
   * Performs a full replacement refresh while reporting progress in VS Code.
   *
   * A note whose saved time, created time, and size are what they were when
   * it was last read, under the same parse settings, is not read again, so
   * a rescan after an exclude or folder change costs a stat per note.
   * `reuse: 'none'` rereads and reparses every note: Reindex Workspace.
   */
  public async refresh(options: { reuse?: 'session' | 'none' } = {}): Promise<void> {
    if (this.disposed) {
      return;
    }
    const fingerprint = this.scanner.getParseFingerprint();
    const reusable =
      options.reuse !== 'none' && this.parsedUnder === fingerprint
        ? this.state.files
        : undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Deckard: Indexing workspace',
        cancellable: false,
      },
      async (progress) => {
        const parsedFiles = await measureAsync(
          'Scan workspace',
          () =>
            this.scanner.scan(
              (completed, total): void => {
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
              },
              reusable && ((filePath, stamp) => reuseUnchanged(reusable.get(filePath), stamp)),
              // Each note is encoded for the cache as it is read, rather
              // than all of them in one turn when the cache is written.
              this.searchStore && ((file) => this.searchStore?.prepare(file)),
            ),
          (files) => `${files.length} notes`,
        );
        this.scanState = undefined;
        if (this.disposed) {
          return;
        }

        const previous = this.state;
        this.snapshot = measure(
          'Build index',
          () => {
            this.state = IndexState.build(parsedFiles, reusable ? previous : undefined);
            return this.state.snapshot();
          },
          (index) => `${index.files.size} notes, ${index.sections.size} entries`,
        );
        this.parsedUnder = fingerprint;
        this.unreadable.clear();
        this.scanner.failures.forEach((failure) =>
          this.unreadable.set(failure.filePath, failure.reason),
        );
        measure(
          'Rebuild search index',
          () =>
            {
              this.searchStore?.replace(this.state.files.values(), this.cacheFingerprint(fingerprint));
              this.searchStore?.writeLastScan(this.scanner.lastScan);
            },
          () => `${this.state.files.size} notes`,
        );
        // What the store handed to its worker is still being written. The
        // log says when it lands, because until then a search finds a note
        // by its title and tags but not yet by the words inside it.
        this.reportSearchIndexWritten();
        this.indexedOnce = true;
        this.emitUpdate();
      },
    );
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
   * Stops timers, watchers, and events so late callbacks cannot repopulate state.
   */
  public dispose(): void {
    this.disposed = true;
    if (this.flushHandle) {
      clearTimeout(this.flushHandle);
    }
    this.watcherDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
    this.views.clear();
    this.viewQueue = [];
    this.searchStore?.dispose();
  }

  /**
   * Connects configuration, workspace, editor, and filesystem changes to one
   * queued update path so every source of change produces the same index shape.
   */
  private registerWatchers(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        const notesFolderChanged = event.affectsConfiguration(
          'deckard.notesFolder',
        );
        const inlineTagsChanged =
          event.affectsConfiguration('deckard.parseInlineTags') ||
          event.affectsConfiguration('deckard.noteBoundaries');
        const entityNamespaceAliasesChanged = event.affectsConfiguration(
          'deckard.entityNamespaceAliases',
        );
        const personMarkerChanged = event.affectsConfiguration(
          'deckard.personMarker',
        );
        const templatesFolderChanged = event.affectsConfiguration(
          'deckard.templatesFolder',
        );
        const excludeChanged =
          event.affectsConfiguration('deckard.exclude') ||
          event.affectsConfiguration('files.exclude') ||
          event.affectsConfiguration('search.exclude');
        if (
          notesFolderChanged ||
          inlineTagsChanged ||
          entityNamespaceAliasesChanged ||
          personMarkerChanged ||
          templatesFolderChanged ||
          excludeChanged
        ) {
          if (notesFolderChanged) {
            this.replaceWatchers();
          }
          this.readyPromise = this.refresh();
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.replaceWatchers();
        this.readyPromise = this.refresh();
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.scanner.isNotesFile(document.uri)) {
          // A note Deckard just wrote is read back at once.
          this.queueUpsert(document.uri, undefined, takeOwnWrite(document.uri.toString()));
        }
      }),
    );
    this.replaceWatchers();
  }

  /**
   * Recreates globs when the configured notes boundary changes.
   */
  private replaceWatchers(): void {
    this.watcherDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());

    for (const pattern of this.scanner.getPatterns()) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.watcherDisposables.push(watcher);
      // The glob can take in files that are not notes, such as templates.
      const upsertNote = (uri: vscode.Uri) => {
        if (this.scanner.isNotesFile(uri)) {
          this.queueUpsert(uri);
        }
      };
      this.watcherDisposables.push(watcher.onDidCreate(upsertNote));
      this.watcherDisposables.push(watcher.onDidChange(upsertNote));
      this.watcherDisposables.push(
        watcher.onDidDelete((uri) => this.queueDelete(uri)),
      );
    }
  }

  /**
   * Replaces pending work for a URI because only its newest content matters.
   */
  private queueUpsert(uri: vscode.Uri, content?: string, now = false): void {
    this.pending.set(uri.toString(), { uri, content, deleted: false });
    this.scheduleFlush(now);
  }

  /**
   * Coalesces deletion with other URI changes before rebuilding the index.
   */
  private queueDelete(uri: vscode.Uri): void {
    this.pending.set(uri.toString(), { uri, deleted: true });
    this.scheduleFlush();
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
      void this.flushPending();
    }, now ? 0 : 200);
  }

  /**
   * Applies all queued changes together so observers never see half a batch.
   *
   * Saved-file reads refresh timestamps; in-memory parses reuse prior metadata
   * because unsaved editor content cannot provide a trustworthy file stat.
   */
  private async flushPending(): Promise<void> {
    const updates = [...this.pending.values()];
    this.pending.clear();
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
    this.snapshot = measure(
      'Update index',
      () => {
        this.state.apply(changes);
        return this.state.snapshot();
      },
      (index) =>
        `${changes.length} ${changes.length === 1 ? 'note' : 'notes'} changed, ${index.files.size} notes`,
    );
    this.emitUpdate();
  }

  /** Reads what changed, in the order it was queued, as changes to apply. */
  private async readUpdates(updates: PendingUpdate[]): Promise<NoteChange[]> {
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
   * Publishes a newly derived snapshot after the cache is internally consistent.
   *
   * The plain listeners, which only keep the index or fire a cheap event, run
   * now. Each view then redraws in a host turn of its own, the one in front
   * first, so no single turn pays for every open view and other extensions
   * get a turn in between. A publish while views are still waiting starts
   * the order again, and each waiting view still runs once.
   */
  private emitUpdate(): void {
    measure('Refresh views after an index update', () =>
      this.updateEmitter.fire(this.getSnapshot()),
    );
    this.viewQueue = [...this.views]
      .map((subscription, order) => ({
        subscription,
        order,
        priority: readPriority(subscription),
      }))
      .sort((left, right) => left.priority - right.priority || left.order - right.order)
      .map(({ subscription }) => subscription);
    this.scheduleViewTurn();
  }

  private scheduleViewTurn(): void {
    if (this.viewTurnScheduled || this.viewQueue.length === 0) {
      return;
    }
    this.viewTurnScheduled = true;
    this.schedule(() => {
      this.viewTurnScheduled = false;
      this.runNextView();
    });
  }

  /** Redraws the next view waiting, if any, then leaves the rest a turn. */
  private runNextView(): void {
    if (this.disposed) {
      return;
    }
    let next = this.viewQueue.shift();
    while (next?.disposed) {
      next = this.viewQueue.shift();
    }
    if (next) {
      const view = next;
      try {
        measure(`Refresh ${view.options.name} after an index update`, () =>
          view.listener(),
        );
      } catch (error) {
        reportError(`Could not refresh ${view.options.name}`, error);
      }
    }
    this.scheduleViewTurn();
  }
}

/** A view's priority now, or last when it cannot say. */
function readPriority(subscription: ViewSubscription): number {
  try {
    const priority = subscription.options.priority();
    return Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
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

interface PendingUpdate {
  uri: vscode.Uri;
  content?: string;
  deleted: boolean;
}

/**
 * Aggregates per-file parse results into stable section, task, and tag lookups.
 *
 * The source files remain the canonical cache; these maps make cross-note
 * queries cheap without duplicating parsing logic in each UI surface. The
 * index is a fold of each note's own contribution (see `IndexState`), so a
 * full build and an update after a save are the same code.
 */
export function buildWorkspaceIndex(
  files: Map<string, ParsedFile>,
): WorkspaceIndex {
  return { ...IndexState.build(files.values()).snapshot(), files };
}
