/**
 * Names taken from an index path: the workspace-relative, `/`-separated path
 * the index keys every note by, as `projects/atlas.md`, and folder settings
 * read into that form. They are string operations on that form only, not on
 * OS paths, and nothing here reaches `vscode`.
 */

/**
 * The last segment of an index path, extension kept: `atlas.md` for
 * `projects/atlas.md`, the whole path when it has no `/`, and '' for a path
 * that ends in `/`. Undefined stays undefined, for a view model whose note
 * may have no path.
 */
export function getFileName(filePath: string): string;
/** The file name of a path that may be missing; undefined when it is. */
export function getFileName(filePath: string | undefined): string | undefined;
export function getFileName(filePath: string | undefined): string | undefined {
  return filePath?.split('/').pop() ?? filePath;
}

/**
 * Everything before the last `/` of an index path: `projects` for
 * `projects/atlas.md`, and '' for a note at the top of the notes folder.
 */
export function getFolder(filePath: string): string {
  return filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
}

/**
 * A folder setting, such as `deckard.notesFolder`, as a workspace-relative
 * path with `/` separators and no slash at either end; '' for the workspace
 * folder itself. A value that is not text, which a hand-edited settings.json
 * can hold, reads as `fallback`, the setting's default, rather than failing
 * every reader of it.
 */
export function readFolderSetting(value: unknown, fallback: string): string {
  const folder = typeof value === 'string' ? value : fallback;
  return folder.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}
