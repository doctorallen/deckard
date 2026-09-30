import * as path from 'path';

/**
 * The keys `deckard.exclude` and `deckard.parked.folders` hold for one
 * folder: its path from its workspace folder, with glob characters escaped,
 * so what the Explorer wrote can be read, and undone, in the settings editor.
 */

/** Characters a glob reads as more than themselves. */
const GLOB_CHARACTERS = /[[\]*?{}]/g;

/**
 * The `deckard.exclude` key for a folder: its path from its workspace folder,
 * with glob characters escaped so `[draft]` means that name. Undefined for the
 * workspace folder itself, which is not a key.
 */
export function relativeExcludeKey(folder: string, workspaceFolder: string): string | undefined {
  const relative = path.posix.relative(workspaceFolder, folder);
  if (relative === '' || relative.startsWith('..')) {
    return undefined;
  }
  return relative.replace(GLOB_CHARACTERS, (character) => `\\${character}`);
}

/** A key written by `relativeExcludeKey`, read back as the path it names. */
export function readExcludeKey(key: string): string {
  return key.replace(/\\([[\]*?{}])/g, '$1');
}

/**
 * The key a setting already holds for the folder `name`, however its glob
 * characters and trailing slash were written, or undefined when it names
 * that folder by no key. The setting is whatever the settings hold, so
 * anything but an object has no keys.
 */
export function findWrittenKey(setting: unknown, name: string): string | undefined {
  const keys = setting && typeof setting === 'object' ? Object.keys(setting) : [];
  return keys.find((candidate) => readExcludeKey(candidate.replace(/\/+$/, '')) === name);
}

/**
 * The folders a set of exclude settings names by an exact `true` key, as
 * full paths: the folders Include in Deckard can bring back. A pattern such
 * as `**\/drafts` names no one folder, so it is left out.
 */
export function listExcludedFolders(
  folders: readonly { root: string; exclude: unknown }[],
  join: (root: string, relative: string) => string,
): string[] {
  const listed: string[] = [];
  for (const { root, exclude } of folders) {
    if (!exclude || typeof exclude !== 'object' || Array.isArray(exclude)) {
      continue;
    }
    for (const [key, value] of Object.entries(exclude)) {
      const written = key.trim().replace(/\/+$/, '');
      const unescaped = readExcludeKey(written);
      // A glob character not escaped makes the key a pattern, not one folder.
      if (value === true && unescaped !== '' && !/(^|[^\\])[*?[\]{}]/.test(written)) {
        listed.push(join(root, unescaped));
      }
    }
  }
  return listed;
}

/** A copy of an exclude setting with one key set, or taken out. */
export function withExcludeKey(
  current: unknown,
  key: string,
  excluded: boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, boolean>) }
      : {};
  if (excluded) {
    next[key] = true;
  } else {
    delete next[key];
  }
  return next;
}
