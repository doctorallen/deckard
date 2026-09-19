import { TagInfo, WorkspaceIndex } from '../../core/types';

/**
 * When each person was last written about, and who has gone quiet.
 *
 * People are first-class in the index, but nothing said when a name last
 * appeared. That is the question a 1:1 or a standing meeting asks: who have
 * I not written about since the spring, and what is still open with them.
 */

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

/** A tag that names a person: an `@` tag, or one under `#person/`. */
export function isPersonTag(key: string): boolean {
  return key.startsWith('@') || key.toLocaleLowerCase().startsWith('#person/');
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
    if (task.completed) {
      return;
    }
    task.tags.filter(isPersonTag).forEach((key) => {
      openTasksByTag.set(key, (openTasksByTag.get(key) ?? 0) + 1);
    });
  });

  return [...index.tags.values()]
    .filter((tag) => isPersonTag(tag.key))
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

/** The newest date among the notes that carry a tag. */
function lastWritten(index: WorkspaceIndex, tag: TagInfo): number {
  const paths = new Set<string>(tag.filePaths);
  tag.sectionIds.forEach((id) => {
    const section = index.sections.get(id);
    if (section) {
      paths.add(section.filePath);
    }
  });
  tag.taskIds.forEach((id) => {
    const task = index.tasks.get(id);
    if (task) {
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
