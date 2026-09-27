import { isPersonTag } from '../../core/markdown/parser';
import { TagInfo, WorkspaceIndex } from '../../core/types';
import {
  isParkedFile,
  isParkedOnlyTag,
  isParkedSection,
  isParkedTask,
} from '../../core/workspace/parked';

/**
 * When each person, or any tag of a namespace, was last written about, and
 * which have gone quiet.
 *
 * People are first-class in the index, but nothing said when a name last
 * appeared. That is the question a 1:1 or a standing meeting asks: who have
 * I not written about since the spring, and what is still open with them.
 */

export { isPersonTag };

/** One person, and when their name was last written. */
export interface PersonRecency {
  tag: TagInfo;
  /** The newest date of any note carrying the tag, or 0 when none is known. */
  lastWrittenAt: number;
  /** Open tasks that name them. */
  openTasks: number;
  /** How many notes, sections, and tasks carry the tag, as the index counts. */
  entries: number;
}

/**
 * Every person in the index with the day their name was last written, most
 * recent first.
 *
 * A note's own date comes first, the way the rest of Deckard reads dates: a
 * `updated:` field, a daily note's day, then the file's modified time.
 */
export function listPeopleRecency(index: WorkspaceIndex): PersonRecency[] {
  const openTasksByTag = new Map<string, number>();
  index.tasks.forEach((task) => {
    if (task.completed || isParkedTask(index, task.id)) {
      return;
    }
    task.tags.filter(isPersonTag).forEach((key) => {
      openTasksByTag.set(key, (openTasksByTag.get(key) ?? 0) + 1);
    });
  });

  return [...index.tags.values()]
    // A person written about only in parked notes is not listed.
    .filter((tag) => isPersonTag(tag.key) && !isParkedOnlyTag(index, tag.key))
    .map((tag) => ({
      tag,
      lastWrittenAt: lastWritten(index, tag),
      openTasks: openTasksByTag.get(tag.key) ?? 0,
      entries: tag.count,
    }))
    .sort(
      (left, right) =>
        right.lastWrittenAt - left.lastWrittenAt ||
        left.tag.label.localeCompare(right.tag.label),
    );
}

/**
 * The people whose name has not been written for `days`, longest ago first.
 * Someone with no date at all is left out: nothing is known about when.
 */
export function listQuietPeople(
  index: WorkspaceIndex,
  now: number,
  days: number,
): PersonRecency[] {
  const cutoff = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  return listPeopleRecency(index)
    .filter((person) => person.lastWrittenAt > 0 && person.lastWrittenAt < cutoff)
    .sort(
      (left, right) =>
        left.lastWrittenAt - right.lastWrittenAt ||
        left.tag.label.localeCompare(right.tag.label),
    );
}

/** The newest date among the notes that carry a tag, where it is not parked. */
function lastWritten(index: WorkspaceIndex, tag: TagInfo): number {
  const paths = new Set<string>(
    tag.filePaths.filter((filePath) => !isParkedFile(index, filePath)),
  );
  tag.sectionIds.forEach((id) => {
    const section = index.sections.get(id);
    if (section && !isParkedSection(index, id)) {
      paths.add(section.filePath);
    }
  });
  tag.taskIds.forEach((id) => {
    const task = index.tasks.get(id);
    if (task && !isParkedTask(index, id)) {
      paths.add(task.filePath);
    }
  });
  let newest = 0;
  paths.forEach((filePath) => {
    const file = index.files.get(filePath);
    const at = file?.updatedAt ?? file?.createdAt ?? 0;
    newest = Math.max(newest, at);
  });
  return newest;
}

/** Which tags Gone quiet watches, and whether only those with nothing open. */
export interface QuietTagOptions {
  /** A tag namespace such as `project`; `person` means people, `@` tags too. */
  namespace?: string;
  /** Leave out a tag that still has an open task: a stuck project. */
  noOpenTasks?: boolean;
}

/** Whether a tag belongs to a namespace, as Gone quiet reads it. */
export function isInNamespace(tagKey: string, namespace: string): boolean {
  const name = namespace.toLowerCase();
  return name === 'person'
    ? isPersonTag(tagKey)
    : tagKey.toLowerCase().startsWith(`#${name}/`);
}

/**
 * The tags of a namespace not written for `days`, longest ago first. Open
 * tasks count those that carry the tag themselves or inherit it from a
 * heading above them, since a project's tag usually sits on its heading.
 */
export function listQuietTags(
  index: WorkspaceIndex,
  now: number,
  days: number,
  options: QuietTagOptions = {},
): PersonRecency[] {
  const namespace = options.namespace?.trim() || 'person';
  const openTasksByTag = new Map<string, number>();
  index.tasks.forEach((task) => {
    if (task.completed || isParkedTask(index, task.id)) {
      return;
    }
    const keys = new Set(task.tags);
    for (
      let section = task.sectionId ? index.sections.get(task.sectionId) : undefined;
      section;
      section = section.parentSectionId ? index.sections.get(section.parentSectionId) : undefined
    ) {
      section.tags.forEach((key) => keys.add(key));
    }
    keys.forEach((key) => {
      if (isInNamespace(key, namespace)) {
        openTasksByTag.set(key, (openTasksByTag.get(key) ?? 0) + 1);
      }
    });
  });
  const cutoff = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  return [...index.tags.values()]
    .filter((tag) => isInNamespace(tag.key, namespace) && !isParkedOnlyTag(index, tag.key))
    .map((tag) => ({
      tag,
      lastWrittenAt: lastWritten(index, tag),
      openTasks: openTasksByTag.get(tag.key) ?? 0,
      entries: tag.count,
    }))
    .filter(
      (entry) =>
        entry.lastWrittenAt > 0 &&
        entry.lastWrittenAt < cutoff &&
        (!options.noOpenTasks || entry.openTasks === 0),
    )
    .sort(
      (left, right) =>
        left.lastWrittenAt - right.lastWrittenAt ||
        left.tag.label.localeCompare(right.tag.label),
    );
}
