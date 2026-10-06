/**
 * A project's parts: for a tag written on headings, the tags on the headings
 * nested under them, each with how far along its tasks are. In
 * `# Checkout v2 #project/checkout-v2` with `## Design #phase/design` and
 * `## Build #phase/build` under it, #project/checkout-v2's parts are Design
 * and Build, and the same parts in another note for the project count with
 * them. A part is the tagged heading nearest the project's: a heading tagged
 * further down is part of that part.
 */
import type { Section, Task, WorkspaceIndex } from '../model';
import { readTaskTagKeys } from '../query/queryEvaluator';
import { DEFAULT_TASK_POLICY, type TaskPolicy } from './taskPolicy';
import { summarizeTasks, type TagProgress } from './tagProgress';

/** One part: the tag that names it and how far along its tasks are. */
export interface TagPart {
  readonly key: string;
  readonly label: string;
  readonly progress: TagProgress;
}

/** Where a part was first written, so the parts read in the order the notes give them. */
interface PartFound {
  key: string;
  label: string;
  tasks: Task[];
  at: { filePath: string; line: number };
}

/**
 * The heading that names a task's part, if any: walking up from the heading
 * the task is under, the last tagged heading passed before the project's
 * own, or before the top of a note whose front matter carries the tag.
 */
function findPartHeading(index: WorkspaceIndex, task: Task, tagKey: string): Section | undefined {
  let part: Section | undefined;
  for (let at = task.sectionId ? index.sections.get(task.sectionId) : undefined; at; at = at.parentSectionId ? index.sections.get(at.parentSectionId) : undefined) {
    const tags = at.headingTags ?? [];
    if (tags.some((tag) => tag.key === tagKey)) {
      return part;
    }
    if (tags.length) {
      part = at;
    }
  }
  const file = index.files.get(task.filePath);
  return file?.frontmatterTags.some((tag) => tag.key === tagKey) ? part : undefined;
}

/**
 * A tag's parts, over the tasks its progress counts: neither steps nor
 * parked tasks. Each part is named by the first tag on its heading other
 * than the project's; none when the tag has no tagged heading under it.
 */
export function collectTagParts(
  index: WorkspaceIndex,
  tagKey: string,
  now: number,
  taskPolicy: Pick<TaskPolicy, 'needsNewDateAfterDays'> = DEFAULT_TASK_POLICY,
): TagPart[] {
  const parts = new Map<string, PartFound>();
  for (const task of index.tasks.values()) {
    if (task.parentTaskId || index.parked?.tasks.has(task.id) || !readTaskTagKeys(index, task).has(tagKey)) {
      continue;
    }
    const heading = findPartHeading(index, task, tagKey);
    const name = heading?.headingTags?.find((tag) => tag.key !== tagKey);
    if (!heading || !name) {
      continue;
    }
    let found = parts.get(name.key);
    if (!found) {
      found = { key: name.key, label: name.label, tasks: [], at: { filePath: heading.filePath, line: heading.startLine } };
      parts.set(name.key, found);
    } else if (heading.filePath < found.at.filePath || (heading.filePath === found.at.filePath && heading.startLine < found.at.line)) {
      found.at = { filePath: heading.filePath, line: heading.startLine };
    }
    found.tasks.push(task);
  }
  return [...parts.values()]
    .sort((left, right) => left.at.filePath.localeCompare(right.at.filePath) || left.at.line - right.at.line)
    .flatMap((part) => {
      const progress = summarizeTasks(part.tasks, now, taskPolicy);
      return progress ? [{ key: part.key, label: part.label, progress }] : [];
    });
}
