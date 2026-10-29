/**
 * A task's nearest parent tag: the tag that says what a task is part of
 * when its words alone do not, as "Draft the brief" under
 * `## Launch #project/atlas` is Atlas's. It is drawn above the task's title.
 */
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
 * The tag a task is under, nearest first: the first tag written on the
 * heading it is under, else on each heading above that, and last its note's
 * front matter, which holds the tag a hub note describes. A tag the task's
 * own line writes is left out, since its title shows it, and so is a tag of
 * the namespace the board is grouped by. Undefined when no tag is left.
 */
export function findParentTag(index: WorkspaceIndex, task: Task, rules: ParentTagRules = {}): TagReference | undefined {
  const own = new Set((task.associationTagGroups?.[0] ?? []).map((tag) => tag.key.toLowerCase()));
  const grouped = (tag: TagReference): boolean =>
    rules.groupNamespace !== undefined && isInNamespace(tag.key, rules.groupNamespace);
  const inherited = (tag: TagReference): boolean => !own.has(tag.key.toLowerCase()) && !grouped(tag);
  for (let section = task.sectionId ? index.sections.get(task.sectionId) : undefined; section; section = section.parentSectionId ? index.sections.get(section.parentSectionId) : undefined) {
    const found = (section.headingTags ?? []).find(inherited);
    if (found) {
      return found;
    }
  }
  // A hub note's `describes:` is one of its front-matter tags.
  return index.files.get(task.filePath)?.frontmatterTags.find(inherited);
}
