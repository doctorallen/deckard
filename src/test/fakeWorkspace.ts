// A workspace in memory for the index's suites: URIs, folders, settings,
// and change events that behave as VS Code's do for the parts the scanner
// and indexer read, so those suites run under plain mocha.
import * as path from 'path';

import { Emitter } from '../core/emitter';
import type { WorkspaceFileAccess } from '../core/workspace/scanner';
import type { ConfigurationSection } from '../ports/configuration';
import { FileStat, FileSystem, FileType } from '../ports/fileSystem';
import type { ResourceUri, WorkspaceFolder } from '../ports/uri';
import type { FolderPattern } from '../ports/workspace';
import type {
  ConfigurationChange,
  FileWatcher,
  SavedDocument,
  WorkspaceEvents,
} from '../ports/workspaceEvents';

/**
 * A `file` URI for `fsPath`, as `Uri.file` makes one: `path` has `/`
 * separators and a leading `/`, `fsPath` is as given.
 */
export function fileUri(fsPath: string): ResourceUri {
  const slashed = fsPath.replaceAll('\\', '/');
  const uriPath = slashed.startsWith('/') ? slashed : `/${slashed}`;
  return {
    scheme: 'file',
    path: uriPath,
    fsPath,
    toString: () => `file://${uriPath}`,
  };
}

/** `base` with `segments` appended, as `Uri.joinPath` joins a file URI. */
export function joinUri(base: ResourceUri, ...segments: string[]): ResourceUri {
  return fileUri(path.join(base.fsPath, ...segments));
}

/** A workspace folder at `fsPath`, first among the roots unless `index` says otherwise. */
export function fakeFolder(fsPath: string, name: string, index = 0): WorkspaceFolder {
  return { uri: fileUri(fsPath), name, index };
}

/** One read of the settings: the section and the scope it was read at. */
export interface SettingsRead {
  section: string;
  scope: ResourceUri | undefined;
}

/**
 * Settings by their full name, such as `deckard.exclude`. A setting with no
 * value reads as the default the caller passes, as VS Code reads one no
 * one set; the scope is recorded but does not change what is read.
 */
export class FakeSettings {
  private readonly values: Map<string, unknown>;
  /** Every section read, in order, with its scope. */
  public readonly reads: SettingsRead[] = [];

  /** Starts with `values`, by full name. */
  public constructor(values: Record<string, unknown> = {}) {
    this.values = new Map(Object.entries(values));
  }

  /** Sets `name` to `value`, or clears it when `value` is undefined. */
  public set(name: string, value: unknown): void {
    if (value === undefined) {
      this.values.delete(name);
      return;
    }
    this.values.set(name, value);
  }

  /** The section as `getConfiguration(section, scope)` reads it. */
  public getConfiguration(section: string, scope?: ResourceUri): ConfigurationSection {
    this.reads.push({ section, scope });
    return new FakeSection((key) => {
      const name = `${section}.${key}`;
      return { found: this.values.has(name), value: this.values.get(name) };
    });
  }
}

/** One section of {@link FakeSettings}, answering by key within it. */
class FakeSection implements ConfigurationSection {
  /** Reads through `lookup`, which says whether a key is set and to what. */
  public constructor(
    private readonly lookup: (key: string) => { found: boolean; value: unknown },
  ) {}

  public get<T>(key: string): T | undefined;
  public get<T>(key: string, defaultValue: T): T;
  /** The value set for `key`, or `defaultValue` when none is. */
  public get<T>(key: string, defaultValue?: T): T | undefined {
    const { found, value } = this.lookup(key);
    return found ? (value as T) : defaultValue;
  }
}

/** What a suite may set on a fake workspace; anything left out has a default. */
export interface FakeAccessOptions extends Partial<WorkspaceFileAccess> {
  settings?: FakeSettings;
}

/**
 * The scanner's ports over a fake workspace: no folders, no files, and
 * empty reads unless `options` gives them, `joinPath` as {@link joinUri},
 * and settings from `options.settings`. There is no `stat` unless one is
 * given, so notes carry no file times, as with a workspace that has none.
 */
export function createFakeAccess(options: FakeAccessOptions = {}): WorkspaceFileAccess {
  const { settings = new FakeSettings(), ...overrides } = options;
  const access: WorkspaceFileAccess = {
    findFiles: async () => [],
    readFile: async () => new Uint8Array(),
    joinPath: joinUri,
    asRelativePath: (uri) => {
      const folder = access.workspaceFolders?.find((candidate) =>
        uri.path.startsWith(`${candidate.uri.path}/`),
      );
      return folder ? uri.path.slice(folder.uri.path.length + 1) : uri.path;
    },
    getConfiguration: (section, scope) => settings.getConfiguration(section, scope),
    ...overrides,
  };
  return access;
}

/** A watcher {@link FakeWorkspaceEvents} made, which a suite fires by hand. */
export interface FakeWatcher extends FileWatcher {
  readonly pattern: FolderPattern;
  readonly created: Emitter<ResourceUri>;
  readonly changed: Emitter<ResourceUri>;
  readonly deleted: Emitter<ResourceUri>;
  disposed: boolean;
}

/**
 * The workspace's change events, which a suite fires by hand: settings,
 * folders, saves, and the watchers the indexer asked for.
 */
export class FakeWorkspaceEvents implements WorkspaceEvents {
  public readonly configuration = new Emitter<ConfigurationChange>();
  public readonly folders = new Emitter<unknown>();
  public readonly saves = new Emitter<SavedDocument>();
  /** Every watcher made, in order, disposed ones included. */
  public readonly watchers: FakeWatcher[] = [];
  public readonly onDidChangeConfiguration = this.configuration.event;
  public readonly onDidChangeWorkspaceFolders = this.folders.event;
  public readonly onDidSaveTextDocument = this.saves.event;

  /** A watcher over `pattern`, kept in {@link watchers}. */
  public createFileSystemWatcher(pattern: FolderPattern): FakeWatcher {
    const created = new Emitter<ResourceUri>();
    const changed = new Emitter<ResourceUri>();
    const deleted = new Emitter<ResourceUri>();
    const watcher: FakeWatcher = {
      pattern,
      created,
      changed,
      deleted,
      disposed: false,
      onDidCreate: created.event,
      onDidChange: changed.event,
      onDidDelete: deleted.event,
      dispose: () => {
        watcher.disposed = true;
        [created, changed, deleted].forEach((emitter) => emitter.dispose());
      },
    };
    this.watchers.push(watcher);
    return watcher;
  }

  /**
   * Tells subscribers the settings named changed, as VS Code does after a
   * write: a change affects a section when it is the section or inside it.
   */
  public changeSettings(...names: string[]): void {
    this.configuration.fire({
      affectsConfiguration: (section) =>
        names.some((name) => name === section || name.startsWith(`${section}.`)),
    });
  }
}

/**
 * Files and folders in memory, by `fsPath`, behind the file-system port. A
 * missing file rejects as VS Code's does; writing a file needs its folder
 * to exist, and creating a folder creates its parents.
 */
export class FakeFileSystem implements FileSystem {
  /** Each file's bytes, by path. */
  public readonly files = new Map<string, Uint8Array>();
  /** Each folder, by path. */
  public readonly folders = new Set<string>();

  /** Joins as {@link joinUri}. */
  public joinPath(base: ResourceUri, ...segments: string[]): ResourceUri {
    return joinUri(base, ...segments);
  }

  /** A file's size and kind; times are zero. */
  public async stat(uri: ResourceUri): Promise<FileStat> {
    const bytes = this.files.get(uri.fsPath);
    if (bytes) {
      return { type: FileType.File, ctime: 0, mtime: 0, size: bytes.byteLength };
    }
    if (this.folders.has(uri.fsPath)) {
      return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    throw new Error(`ENOENT: ${uri.fsPath}`);
  }

  /** A file's bytes; rejects for a missing file. */
  public async readFile(uri: ResourceUri): Promise<Uint8Array> {
    const bytes = this.files.get(uri.fsPath);
    if (!bytes) {
      throw new Error(`ENOENT: ${uri.fsPath}`);
    }
    return bytes;
  }

  /** Writes a file whole; rejects when its folder does not exist. */
  public async writeFile(uri: ResourceUri, content: Uint8Array): Promise<void> {
    if (!this.folders.has(path.dirname(uri.fsPath))) {
      throw new Error(`ENOENT: ${path.dirname(uri.fsPath)}`);
    }
    this.files.set(uri.fsPath, Uint8Array.from(content));
  }

  /** The files and folders directly in a folder; rejects for a missing one. */
  public async readDirectory(uri: ResourceUri): Promise<Array<[string, number]>> {
    if (!this.folders.has(uri.fsPath)) {
      throw new Error(`ENOENT: ${uri.fsPath}`);
    }
    const inFolder = (candidate: string) => path.dirname(candidate) === uri.fsPath;
    return [
      ...[...this.folders].filter(inFolder).map((folder): [string, number] => [path.basename(folder), FileType.Directory]),
      ...[...this.files.keys()].filter(inFolder).map((file): [string, number] => [path.basename(file), FileType.File]),
    ];
  }

  /** Creates a folder and its parents. */
  public async createDirectory(uri: ResourceUri): Promise<void> {
    for (let folder = uri.fsPath; !this.folders.has(folder); folder = path.dirname(folder)) {
      this.folders.add(folder);
      if (path.dirname(folder) === folder) {
        return;
      }
    }
  }

  /** Deletes a file; rejects for a missing one. */
  public async delete(uri: ResourceUri): Promise<void> {
    if (!this.files.delete(uri.fsPath)) {
      throw new Error(`ENOENT: ${uri.fsPath}`);
    }
  }
}
