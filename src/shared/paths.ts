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

/** A workspace folder, as far as the key its notes are filed under needs it. */
export interface KeyedFolder {
  readonly name: string;
  readonly uri: { toString(): string };
}

/**
 * The first segment of the index path of each note in `folder`, in a
 * workspace of more than one folder: the folder's name, or, when an earlier
 * folder already has that name, the name with " (2)", " (3)", and so on, so
 * two folders both named `notes` keep their notes apart. Undefined for a
 * folder that is not one of `folders`.
 */
export function workspaceFolderKey(folders: readonly KeyedFolder[], folder: KeyedFolder): string | undefined {
  const position = folders.findIndex(
    (candidate) => candidate === folder || candidate.uri.toString() === folder.uri.toString(),
  );
  return position < 0 ? undefined : folderKeys(folders)[position];
}

/** The folder of `folders` whose notes are filed under `key`, as {@link workspaceFolderKey} names it. */
export function findWorkspaceFolderByKey<F extends KeyedFolder>(folders: readonly F[], key: string): F | undefined {
  const position = folderKeys(folders).indexOf(key);
  return position < 0 ? undefined : folders[position];
}

/** Each folder's key, in the folders' order: the first folder of a name keeps it. */
function folderKeys(folders: readonly KeyedFolder[]): string[] {
  const used = new Set<string>();
  return folders.map((folder) => {
    let key = folder.name;
    for (let count = 2; used.has(key); count += 1) {
      key = `${folder.name} (${count})`;
    }
    used.add(key);
    return key;
  });
}
