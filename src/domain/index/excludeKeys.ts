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

/** One level an exclude-style setting can be set at: what it holds there, and how to write there. */
export interface KeyLevel<T> {
  target: T;
  value: unknown;
}

/**
 * What to write to take a folder's key out of an exclude-style setting so
 * the merged value no longer names it, or undefined when no level names it
 * by a `true` key.
 *
 * VS Code merges such an object across the user's, the workspace's, and a
 * folder's settings, a key's value coming from the most specific level
 * that holds it. So the key is taken out at that level. When a less
 * specific level holds it as `true` too, taking it out would bring that
 * one into force, so it is set to `false` there instead, under each
 * spelling those levels hold.
 * @param levels Most specific first.
 * @param name The folder's path from its workspace folder, as
 *   {@link findWrittenKey} reads it.
 */
export function planKeyRemoval<T>(
  levels: readonly KeyLevel<T>[],
  name: string,
): { target: T; value: Record<string, boolean> } | undefined {
  const held = levels.findIndex((level) => findWrittenKey(level.value, name) !== undefined);
  const level = levels[held];
  const written = level ? findWrittenKey(level.value, name) : undefined;
  if (!level || written === undefined || (level.value as Record<string, unknown>)[written] !== true) {
    return undefined;
  }
  const value = withExcludeKey(level.value, written, false);
  for (const below of levels.slice(held + 1)) {
    const spelling = findWrittenKey(below.value, name);
    if (spelling !== undefined && (below.value as Record<string, unknown>)[spelling] === true) {
      value[spelling] = false;
    }
  }
  return { target: level.target, value };
}
