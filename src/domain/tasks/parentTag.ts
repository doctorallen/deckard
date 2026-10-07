/**
 * A task's nearest parent tag: the tag written on the nearest tagged
 * heading above it, or, under no tagged heading, on its note's front
 * matter. It says what a task is part of when its words alone do not, as
 * "Draft the brief" under `## Launch #project/atlas` is Atlas's.
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
 * heading it is under, else on each heading above that, else on its note's
 * front matter, leaving out a tag its own line writes and a tag of the
 * namespace the board is grouped by. Undefined when no tag is
 * left.
 */
export function findParentTag(index: WorkspaceIndex, task: Task, rules: ParentTagRules = {}): TagReference | undefined {
  const own = new Set((task.associationTagGroups?.[0] ?? []).map((tag) => tag.key.toLowerCase()));
  const usable = (tag: TagReference): boolean =>
    !own.has(tag.key.toLowerCase()) &&
    !(rules.groupNamespace !== undefined && isInNamespace(tag.key, rules.groupNamespace));
  for (let section = task.sectionId ? index.sections.get(task.sectionId) : undefined; section; section = section.parentSectionId ? index.sections.get(section.parentSectionId) : undefined) {
    const found = (section.headingTags ?? []).find(usable);
    if (found) {
      return found;
    }
  }
  return index.files.get(task.filePath)?.frontmatterTags.find(usable);
}
