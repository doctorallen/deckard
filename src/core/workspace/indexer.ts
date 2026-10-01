import type { ResourceUri } from '../../ports/uri';
import type { WorkspaceEvents } from '../../ports/workspaceEvents';
import type { SearchStore } from '../storage/searchStore';
import type { WorkspaceScanner } from './scanner';
import type { OwnWrites } from './writeHistory';
import { ChangeWatcher } from './changeWatcher';
import { IndexService, IndexServiceOptions } from './indexService';
import type { IndexRoles, RefreshOptions } from './indexReader';
import { ViewPublisher } from './viewPublisher';

export { buildWorkspaceIndex } from '../../domain/index/indexState';

/** What {@link createWorkspaceIndex} builds the index from. */
export interface WorkspaceIndexOptions<U extends ResourceUri = ResourceUri> extends IndexServiceOptions {
  /** Finds, reads, and parses the notes, and names their paths and URIs. */
  scanner: WorkspaceScanner<U>;
  /** The full-text cache, absent in a test that needs none. */
  searchStore?: SearchStore;
  /**
   * Runs a view's redraw in a later host turn. `setImmediate` by default; a
   * test passes its own to step through the turns.
   */
  schedule?: (run: () => void) => void;
  /**
   * Where changes to the workspace come from once the index starts:
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
 * Builds the index from its pieces and hands back every role they play as
 * one value:
 *
 * - a {@link ViewPublisher}, first, since the service publishes through it;
 * - an {@link IndexService} over the scanner and the cache: the lifecycle,
 *   the warm start and the cache fingerprint, scans, the fold, the
 *   full-text cache, and the notes that could not be read;
 * - a {@link ChangeWatcher}, which hears the workspace's events and has the
 *   service carry out what each requires.
 *
 * The scanner answers for the notes' paths, URIs, and parsing. Starting
 * starts the watcher before the service, so an edit during startup is
 * queued rather than lost, and disposing stops the watcher, then the
 * publisher, then the service.
 */
export function createWorkspaceIndex<U extends ResourceUri = ResourceUri>(
  options: WorkspaceIndexOptions<U>,
): IndexRoles<U> {
  const { scanner } = options;
  const publisher = new ViewPublisher(options.schedule);
  const service = new IndexService(scanner, options.searchStore, publisher, options);
  const watcher = new ChangeWatcher(scanner, service, options.events, options.ownWrites);
  return {
    get ready() {
      return service.ready;
    },
    getSnapshot: () => service.getSnapshot(),
    getTask: (taskId) => service.getTask(taskId),
    getParkedRules: () => service.getParkedRules(),
    getFilePath: (uri) => scanner.getFilePath(uri),
    getUri: (filePath) => scanner.getUri(filePath),
    isNotesFile: (uri) => scanner.isNotesFile(uri),
    getNotesFolderUri: (workspaceFolder) => scanner.getNotesFolderUri(workspaceFolder),
    getTemplatesFolderUri: (workspaceFolder) => scanner.getTemplatesFolderUri(workspaceFolder),
    parse: (uri, content, metadata) => scanner.parse(uri, content, metadata),
    searchEntries: (query, searchOptions) => service.searchEntries(query, searchOptions),
    suggestWords: (terms) => service.suggestWords(terms),
    get hasIndexed() {
      return service.hasIndexed;
    },
    get scanProgress() {
      return service.scanProgress;
    },
    onDidProgress: service.onDidProgress,
    get isStale() {
      return service.isStale;
    },
    getUnreadable: () => service.getUnreadable(),
    getLastScan: () => service.getLastScan(),
    onDidUpdate: publisher.onDidUpdate,
    onDidUpdateView: (listener, viewOptions) => publisher.onDidUpdateView(listener, viewOptions),
    get published() {
      return publisher.published;
    },
    start: () => {
      watcher.start();
      return service.start();
    },
    refresh: (refreshOptions: RefreshOptions = {}) => service.refresh(refreshOptions),
    dispose: () => {
      watcher.dispose();
      publisher.dispose();
      service.dispose();
    },
  };
}
