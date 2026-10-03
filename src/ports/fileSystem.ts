import type { ResourceUri } from './uri';

/**
 * What kind of entry a directory listing names, numbered as VS Code's
 * `FileType` numbers them, so a VS Code listing needs no translation.
 */
export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const;

/** What a stat says about a file: its kind, times, and size in bytes. */
export interface FileStat {
  /** One of {@link FileType}, or a combination of them for a link. */
  readonly type: number;
  /** When it was created, in milliseconds since the epoch. */
  readonly ctime: number;
  /** When it was last written, in milliseconds since the epoch. */
  readonly mtime: number;
  readonly size: number;
}

/**
 * Reading and writing files by URI, as `vscode.workspace.fs` does, together
 * with joining a URI and path segments into another, as `Uri.joinPath` does.
 *
 * `U` is the URI type the caller works in: VS Code's `Uri` in the extension,
 * a plain object in a test. Every method takes and returns that type, so
 * nothing the caller passes through comes back as a narrower one.
 */
export interface FileSystem<U extends ResourceUri = ResourceUri> {
  /** `base` with each segment appended to its path, `..` and `.` resolved. */
  joinPath(base: U, ...segments: string[]): U;
  /** The file's stat. Rejects when it cannot be read, as for a missing file. */
  stat(uri: U): PromiseLike<FileStat>;
  /** The file's bytes. Rejects when it cannot be read. */
  readFile(uri: U): PromiseLike<Uint8Array>;
  /** Writes the file whole, creating it when it is missing. */
  writeFile(uri: U, content: Uint8Array): PromiseLike<void>;
  /** Each entry of the folder, by name, with its {@link FileType}. */
  readDirectory(uri: U): PromiseLike<Array<[string, number]>>;
  /** Creates the folder and any missing parents; an existing one is kept. */
  createDirectory(uri: U): PromiseLike<void>;
  /** Deletes the file. */
  delete(uri: U): PromiseLike<void>;
}
