import type { Disposable, Event } from './events';
import type { ResourceUri } from './uri';
import type { FolderPattern } from './workspace';

/** A settings change, which answers whether it touched a given setting. */
export interface ConfigurationChange {
  /** Whether `section`, such as `deckard.exclude`, or anything under it changed. */
  affectsConfiguration(section: string): boolean;
}

/** A document that was saved, as far as the index needs it: where it is. */
export interface SavedDocument<U extends ResourceUri = ResourceUri> {
  readonly uri: U;
}

/**
 * Watches the files one {@link FolderPattern} matches, as VS Code's
 * `FileSystemWatcher` does, until it is disposed.
 */
export interface FileWatcher<U extends ResourceUri = ResourceUri> extends Disposable {
  readonly onDidCreate: Event<U>;
  readonly onDidChange: Event<U>;
  readonly onDidDelete: Event<U>;
}

/**
 * Where changes to the workspace come from: settings, the set of open
 * folders, saved documents, and files on disk, as `vscode.workspace` has
 * each. The index subscribes to these and decides for itself what each
 * one means; the platform only delivers them.
 */
export interface WorkspaceEvents<U extends ResourceUri = ResourceUri> {
  readonly onDidChangeConfiguration: Event<ConfigurationChange>;
  /** Fires when a folder is added to the workspace or removed from it. */
  readonly onDidChangeWorkspaceFolders: Event<unknown>;
  readonly onDidSaveTextDocument: Event<SavedDocument<U>>;
  /** A watcher over the files `pattern` matches, reporting creates, changes, and deletes. */
  createFileSystemWatcher(pattern: FolderPattern<U>): FileWatcher<U>;
}
