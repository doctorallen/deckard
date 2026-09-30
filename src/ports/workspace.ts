import type { ResourceUri, WorkspaceFolder } from './uri';

/**
 * A glob relative to one workspace folder, as VS Code's `RelativePattern`
 * holds one: the platform turns it into a `RelativePattern` built on the
 * same folder, for a search or a file watcher.
 */
export interface FolderPattern<U extends ResourceUri = ResourceUri> {
  readonly folder: WorkspaceFolder<U>;
  /** A glob with `/` separators, relative to the folder. */
  readonly pattern: string;
}

/**
 * The open workspace: its root folders, finding files in them, and naming a
 * file relative to them, as `vscode.workspace` does each.
 */
export interface WorkspaceFiles<U extends ResourceUri = ResourceUri> {
  /** The root folders now open, in order, or undefined when none is. */
  readonly workspaceFolders?: readonly WorkspaceFolder<U>[];
  /**
   * The files `include` matches and `exclude` does not, as
   * `workspace.findFiles` finds them, at most `maxResults` of them.
   */
  findFiles(
    include: FolderPattern<U>,
    exclude?: FolderPattern<U>,
    maxResults?: number,
  ): PromiseLike<U[]>;
  /**
   * The URI's path relative to the workspace folder that holds it, as
   * `workspace.asRelativePath` gives it, with the folder's name in front
   * when `includeWorkspaceFolder` is true and more than one folder is open.
   */
  asRelativePath(uri: U, includeWorkspaceFolder: boolean): string;
}
