import type { WorkspaceIndex } from '../model';
import { isUnderParkedTag, ParkedRules } from './parked';

/**
 * What parks one note, and how much a folder or tag parks: the rules Park
 * Note, Park Folder, and Park Tag read before they write anything.
 */

/** The folder of a note that a parked-folder pattern matches, nearest first. */
export function parkingFolder(rules: ParkedRules, filePath: string): string | undefined {
  const parts = filePath.split('/').slice(0, -1);
  for (let end = 1; end <= parts.length; end += 1) {
    const folder = parts.slice(0, end).join('/');
    if (rules.isParkedPath(folder)) {
      return folder;
    }
  }
  return rules.isParkedPath(filePath) ? filePath : undefined;
}

/** The note's front-matter tags that park it, by key; none when it has none. */
export function parkingTags(index: WorkspaceIndex, rules: ParkedRules, filePath: string): string[] {
  return (index.files.get(filePath)?.frontmatterTags ?? [])
    .filter((tag) => isUnderParkedTag(tag.key, rules.tags))
    .map((tag) => tag.key);
}

/** How many indexed notes a folder holds, at any depth, by its index path. */
export function countNotesIn(index: WorkspaceIndex, folderPath: string): number {
  let count = 0;
  index.files.forEach((_, filePath) => {
    if (filePath.startsWith(`${folderPath}/`)) {
      count += 1;
    }
  });
  return count;
}

/** How a parked tag is written in the setting: `project/old`, `@ren`. */
export function parkedTagSettingValue(key: string): string {
  return key.startsWith('#') ? key.slice(1) : key;
}
