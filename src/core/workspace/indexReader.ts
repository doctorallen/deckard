import type { Disposable, Event } from '../../ports/events';
import type { ResourceUri, WorkspaceFolder } from '../../ports/uri';
import type { ParkedRules } from '../../domain/index/parked';
import type { ParsedFile, Task, UnreadableNote, WorkspaceIndex } from '../../domain/model';
import type { EntrySearchOptions, EntrySearchResult } from '../storage/searchStore';
import type { ViewUpdateOptions } from './publishing';

/**
 * The roles the index plays for the rest of Deckard. Each caller is typed by
 * the roles it uses, so what it can reach is what it reads: a view that
 * only draws the index takes an {@link IndexReader} and {@link IndexUpdates},
 * and nothing it holds can rescan the workspace.
 *
 * `createWorkspaceIndex` builds the pieces that play them and hands back
 * every role as one {@link IndexRoles} value, for a caller that needs
 * several.
 */

/** What the index holds now, and when it holds the whole workspace: the `IndexService`'s. */
export interface IndexContents {
  /**
   * Resolves once the first scan has checked the notes against the files.
   * A surface that writes, or answers for the whole workspace, waits for
   * this; one that only displays notes waits for `published`.
   */
  readonly ready: Promise<void>;
  /**
   * The derived index, built once per change to the notes and shared by
   * every caller until the next one, so callers treat it as read-only.
   */
  getSnapshot(): WorkspaceIndex;
  /** The task with this id in the index now, for actions that check their source first. */
  getTask(taskId: string): Task | undefined;
  /** What `deckard.parked` parks now, as the index reads it. */
  getParkedRules(): ParkedRules;
}

/**
 * Which files are notes, what the index calls them, and how it reads one:
 * the `WorkspaceScanner`'s. `U` is the URI type the index was built
 * with, `vscode.Uri` in the extension, so a URI it hands back can go to
 * VS Code as it is.
 */
export interface NoteFiles<U extends ResourceUri = ResourceUri> {
  /** The index's path for a file: one key shape for every caller. */
  getFilePath(uri: U): string;
  /** The file an index path names, when a workspace folder holds it. */
  getUri(filePath: string): U | undefined;
  /** Whether a file is a note: Markdown, in the notes folder, and not excluded or a template. */
  isNotesFile(uri: U): boolean;
  /** The folder `deckard.notesFolder` names in a workspace folder, or the folder itself. */
  getNotesFolderUri(workspaceFolder: WorkspaceFolder<U>): U;
  /** The folder `deckard.templatesFolder` names in a workspace folder, if it names one. */
  getTemplatesFolderUri(workspaceFolder: WorkspaceFolder<U>): U | undefined;
  /** The folder of type notes, `Types/` under the notes folder, whether or not it exists. */
  getTypesFolderUri(workspaceFolder: WorkspaceFolder<U>): U;
  /**
   * Parses text an editor holds as the index would parse the file, under
   * its folder's parse settings. It changes nothing in the index.
   */
  parse(
    uri: U,
    content: string,
    metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  ): ParsedFile;
}

/** Reading the index: what it holds, and the notes' paths and URIs. */
export type IndexReader<U extends ResourceUri = ResourceUri> = IndexContents & NoteFiles<U>;

/** Searching the full-text cache. */
export interface IndexSearch {
  /**
   * Searches the local full-text cache for note entries and tasks, best
   * first. The ids it returns are the live index's, so a caller can open or
   * filter by them directly.
   */
  searchEntries(query: string, options?: EntrySearchOptions): EntrySearchResult;
  /**
   * Answers the closest word the notes contain for each word they do not,
   * so a surface that searches the index itself can correct a misspelling
   * the same way the full-text cache does.
   */
  suggestWords(terms: readonly string[]): ReadonlyMap<string, string>;
}

/** How far the index has got, and what it could not read. */
export interface IndexScanStatus {
  /** Whether a first scan has finished, so the index holds the workspace. */
  readonly hasIndexed: boolean;
  /** How far the scan under way has got: "412 of 3,760 notes", or nothing. */
  readonly scanProgress: { completed: number; total: number } | undefined;
  /**
   * Fires as a scan moves on, at most every few percent, so a view that says
   * it is waiting can say how far along it is.
   */
  readonly onDidProgress: Event<void>;
  /**
   * Whether the index is the notes as the cache kept them, still being
   * checked against the files. It is replaced within about a second.
   */
  readonly isStale: boolean;
  /**
   * The notes the workspace has that the index does not, because they could
   * not be read, with why. Sorted by path so two reports of the same state
   * read the same.
   */
  getUnreadable(): UnreadableNote[];
  /** What the last full scan found, kept out, and read. */
  getLastScan(): { found: number; templates: number; excluded: number; read: number };
}

/** Hearing about each new index: the `ViewPublisher`'s. */
export interface IndexUpdates {
  /** Fires with each new index, before any view redraws from it. */
  readonly onDidUpdate: Event<WorkspaceIndex>;
  /**
   * Redraws a view from the index after each update, in a host turn of its
   * own, after the plain listeners and in order of `priority` (the view in
   * front first). A view that has not had its turn when the index changes
   * again runs once, with the newer index.
   */
  onDidUpdateView(listener: () => void, options: ViewUpdateOptions): Disposable;
  /**
   * Resolves once the index first has notes to show: the cache's, on a warm
   * start, or the first scan's. Surfaces that only display notes wait for
   * this; anything that writes or answers for the whole workspace waits for
   * `ready`.
   */
  readonly published: Promise<void>;
}

/** How a refresh treats the notes it already holds; see {@link IndexControl.refresh}. */
export interface RefreshOptions {
  reuse?: 'session' | 'cache' | 'none';
}

/** Starting the index, and scanning the workspace again. */
export interface IndexControl {
  /**
   * Starts listening for changes, then starts from the cache or with a full
   * scan. The listeners come first so edits during startup are queued
   * rather than lost.
   */
  start(): Promise<void>;
  /**
   * Scans the workspace again, showing its progress.
   *
   * A note whose saved time, created time, and size are what they were when
   * it was last read, under the same parse settings, is not read again, so
   * a rescan after an exclude or folder change costs a stat per note.
   * `reuse: 'none'` rereads and reparses every note: Reindex Workspace.
   */
  refresh(options?: RefreshOptions): Promise<void>;
}

/**
 * Every role of the index in one value, as `createWorkspaceIndex` returns
 * it, for the composition root and a caller that needs several. Disposing
 * of it stops the watchers, the views' turns, and the scans.
 */
export type IndexRoles<U extends ResourceUri = ResourceUri> = IndexReader<U> &
  IndexSearch &
  IndexScanStatus &
  IndexUpdates &
  IndexControl &
  Disposable;
