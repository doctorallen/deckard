/**
 * A task's nearest parent tag: the tag that says what a task is part of
 * when its words alone do not, as "Draft the brief" under
 * `## Launch #project/atlas` is Atlas's. It is drawn above the task's title.
 */
import { stripTrailingTags } from '../ranking/entryLabels';
import type { TagReference, Task, WorkspaceIndex } from '../model';

/** Which tags a parent tag may not be, since the card already says them. */
export interface ParentTagRules {
  /** A namespace whose tags the board's columns already name, when it is grouped by one. */
  groupNamespace?: string;
}

/** Whether a tag key is in a namespace: `#project/atlas` is in `project`. */
function isInNamespace(key: string, namespace: string): boolean {
  return key.toLowerCase().startsWith(`#${namespace.toLowerCase()}/`);
}

/**
 * The tags written at the end of the task's own line, which its title
 * leaves off: `#project/atlas` in `Call Ren #project/atlas`, but not
 * `@ren` in `Pair @ren with @dax`, which the title shows.
 */
function listTrailingTags(task: Task): TagReference[] {
  const title = stripTrailingTags(task.title) || task.title;
  return (task.associationTagGroups?.[0] ?? []).filter((tag) => !title.includes(tag.label));
}

/**
 * The tag a task is under, nearest first: a tag written at the end of its
 * own line that has a hub note; the first tag written on the heading it is
 * under, else on each heading above that; its note's front matter, which
 * holds the tag a hub note describes; and last any other tag written at the
 * end of its line. A tag of the namespace the board is grouped by is
 * left out, and an inherited tag the line writes too. Undefined when no tag
 * is left.
 */
export function findParentTag(index: WorkspaceIndex, task: Task, rules: ParentTagRules = {}): TagReference | undefined {
  const own = new Set((task.associationTagGroups?.[0] ?? []).map((tag) => tag.key.toLowerCase()));
  const grouped = (tag: TagReference): boolean =>
    rules.groupNamespace !== undefined && isInNamespace(tag.key, rules.groupNamespace);
  const inherited = (tag: TagReference): boolean => !own.has(tag.key.toLowerCase()) && !grouped(tag);
  const trailing = listTrailingTags(task).filter((tag) => !grouped(tag));
  const withHub = trailing.find((tag) => (index.tags.get(tag.key)?.hubFilePaths?.length ?? 0) > 0);
  if (withHub) {
    return withHub;
  }
  for (let section = task.sectionId ? index.sections.get(task.sectionId) : undefined; section; section = section.parentSectionId ? index.sections.get(section.parentSectionId) : undefined) {
    const found = (section.headingTags ?? []).find(inherited);
    if (found) {
      return found;
    }
  }
  // A hub note's `describes:` is one of its front-matter tags.
  return index.files.get(task.filePath)?.frontmatterTags.find(inherited) ?? trailing[0];
}
