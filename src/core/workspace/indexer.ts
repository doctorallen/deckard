import type { Disposable, Event } from '../../ports/events';
import type { ResourceUri, WorkspaceFolder } from '../../ports/uri';
import type { WorkspaceEvents } from '../../ports/workspaceEvents';
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
import { WorkspaceScanner } from './scanner';
import type { OwnWrites } from './writeHistory';
import { ChangeWatcher } from './changeWatcher';
import { IndexService, IndexServiceOptions, RefreshOptions } from './indexService';
import { ViewUpdateOptions } from './publishing';
import { ViewPublisher } from './viewPublisher';
import { ParkedRules } from '../../domain/index/parked';

export { buildWorkspaceIndex } from '../../domain/index/indexState';

/** What the indexer can be given beyond its scanner and cache. */
export interface WorkspaceIndexerOptions<U extends ResourceUri = ResourceUri> extends IndexServiceOptions {
  /**
   * Runs a view's redraw in a later host turn. `setImmediate` by default; a
   * test passes its own to step through the turns.
   */
  schedule?: (run: () => void) => void;
  /**
   * Where changes to the workspace come from once the indexer starts:
   * settings, folders, saves, and file watchers. Without it, a test's, the
   * index changes only when it is refreshed.
   */
  events?: WorkspaceEvents<U>;
  /**
   * The notes Deckard has just saved itself, which a save reads back at
   * once rather than after the debounce: the write history's, in the
   * extension. Without it, a test's, every save is debounced.
   */
  ownWrites?: Pick<OwnWrites, 'take'>;
}

/**
 * The index as every caller outside `src/core/workspace` has known it: one
 * object for the notes, their index, the scan, the change queue, and the
 * views. It now only puts together the pieces that do the work and hands
 * each call to one of them:
 *
 * - {@link IndexService}: the lifecycle, the warm start and the cache
 *   fingerprint, scans, the fold, the full-text cache, and the notes that
 *   could not be read;
 * - {@link ChangeWatcher}: the workspace's events, what each requires, and
 *   the debounced change queue;
 * - {@link ViewPublisher}: the plain listeners, and the views redrawn one
 *   host turn at a time;
 * - the {@link WorkspaceScanner}: paths, URIs, and parsing.
 *
 * It keeps the surface it had so that no caller changed with the split.
 * Phase 4 of the refactor moves each caller to the piece it uses and
 * deletes this class.
 */
export class WorkspaceIndexer<U extends ResourceUri = ResourceUri> implements Disposable {
  /** Publishes each new index to the plain listeners, then to the views in turns. */
  private readonly publisher: ViewPublisher;
  /** The notes, the index, the scans, and the cache. */
  private readonly service: IndexService<U>;
  /** Hears changes to the workspace and queues or carries out what each requires. */
  private readonly watcher: ChangeWatcher<U>;
  /**
   * Fires as a scan moves on, at most every few percent, so a view that says
   * it is waiting can say how far along it is.
   */
  public readonly onDidProgress: Event<void>;
  /** Fires with each new index, before any view redraws from it. */
  public readonly onDidUpdate: Event<WorkspaceIndex>;

  /** `searchStore` is the full-text cache, absent in a test that needs none. */
  public constructor(
    private readonly scanner: WorkspaceScanner<U>,
    searchStore?: SearchStore,
    options: WorkspaceIndexerOptions<U> = {},
  ) {
    this.publisher = new ViewPublisher(options.schedule);
    this.service = new IndexService(scanner, searchStore, this.publisher, options);
    this.watcher = new ChangeWatcher(scanner, this.service, options.events, options.ownWrites);
    this.onDidProgress = this.service.onDidProgress;
    this.onDidUpdate = this.publisher.onDidUpdate;
  }

  /** Whether a first scan has finished, so the index holds the workspace. */
  public get hasIndexed(): boolean {
    return this.service.hasIndexed;
  }

  /** How far the scan under way has got: "412 of 3,760 notes", or nothing. */
  public get scanProgress(): { completed: number; total: number } | undefined {
    return this.service.scanProgress;
  }

  /**
   * Redraws a view from the index after each update, in a host turn of its
   * own, after the plain listeners and in order of `priority` (the view in
   * front first). A view that has not had its turn when the index changes
   * again runs once, with the newer index.
   */
  public onDidUpdateView(
    listener: () => void,
    options: ViewUpdateOptions,
  ): Disposable {
    return this.publisher.onDidUpdateView(listener, options);
  }

  /**
   * Installs change listeners before the first refresh so edits during startup
   * are queued rather than lost.
   */
  public start(): Promise<void> {
    this.watcher.start();
    return this.service.start();
  }

  /**
   * Resolves once the index first has notes to show: the cache's, on a warm
   * start, or the first scan's. Surfaces that only display notes wait for
   * this; anything that writes or answers for the whole workspace waits for
   * `ready`.
   */
  public get published(): Promise<void> {
    return this.publisher.published;
  }

  /**
   * Whether the index is the notes as the cache kept them, still being
   * checked against the files. It is replaced within about a second.
   */
  public get isStale(): boolean {
    return this.service.isStale;
  }

  /**
   * The notes the workspace has that the index does not, because they could
   * not be read, with why. Sorted by path so two reports of the same state
   * read the same.
   */
  public getUnreadable(): UnreadableNote[] {
    return this.service.getUnreadable();
  }

  /** What the last full scan found, kept out, and read. */
  public getLastScan(): { found: number; templates: number; excluded: number; read: number } {
    return this.service.getLastScan();
  }

  /**
   * Exposes the initial scan as a barrier for commands that need complete data.
   */
  public get ready(): Promise<void> {
    return this.service.ready;
  }

  /**
   * Returns the derived index, built once per change to the notes and shared
   * by every caller until the next one, so callers treat it as read-only.
   */
  public getSnapshot(): WorkspaceIndex {
    return this.service.getSnapshot();
  }

  /** What `deckard.parked` parks now, as the index reads it. */
  public getParkedRules(): ParkedRules {
    return this.service.getParkedRules();
  }

  /** The file an index path names, when a workspace folder holds it. */
  public getUri(filePath: string): U | undefined {
    return this.scanner.getUri(filePath);
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
    return this.service.searchEntries(query, options);
  }

  /**
   * Answers the closest word the notes contain for each word they do not,
   * so a surface that searches the index itself can correct a misspelling
   * the same way the full-text cache does.
   */
  public suggestWords(terms: readonly string[]): ReadonlyMap<string, string> {
    return this.service.suggestWords(terms);
  }

  /**
   * Keeps path formatting owned by the scanner so all callers use one key shape.
   */
  public getFilePath(uri: U): string {
    return this.scanner.getFilePath(uri);
  }

  /**
   * Parses editor content through the scanner's workspace-specific settings.
   */
  public parse(
    uri: U,
    content: string,
    metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  ): ParsedFile {
    return this.scanner.parse(uri, content, metadata);
  }

  /**
   * Delegates notes-folder containment to the scanner's path boundary checks.
   */
  public isNotesFile(uri: U): boolean {
    return this.scanner.isNotesFile(uri);
  }

  /** The folder `deckard.notesFolder` names in a workspace folder, or the folder itself. */
  public getNotesFolderUri(
    workspaceFolder: WorkspaceFolder<U>,
  ): U {
    return this.scanner.getNotesFolderUri(workspaceFolder);
  }

  /** The folder `deckard.templatesFolder` names in a workspace folder, if it names one. */
  public getTemplatesFolderUri(
    workspaceFolder: WorkspaceFolder<U>,
  ): U | undefined {
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
  public refresh(options: RefreshOptions = {}): Promise<void> {
    return this.service.refresh(options);
  }

  /**
   * Stops timers, watchers, and events so late callbacks cannot repopulate state.
   */
  public dispose(): void {
    this.watcher.dispose();
    this.publisher.dispose();
    this.service.dispose();
  }
}
