/**
 * How an entry is named in a list: its title with or without its tags, the
 * tags its title writes, the headings it sits under, and the date of the
 * daily note it is in.
 */
import { findDailyNoteDate, stripTags } from '../markdown/parser';
import { ParsedFile, Section, TagReference, TagTitleDisplayMode, Task } from '../model';

/**
 * Lists a section's heading and its ancestors, outermost first, without tags.
 */
export function getHeadingPath(
  section: Section,
  sectionsById: ReadonlyMap<string, Section>,
): string[] {
  const path = [stripTags(section.heading)];
  const visited = new Set<string>([section.id]);
  let parentId = section.parentSectionId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = sectionsById.get(parentId);
    if (!parent) {
      break;
    }
    path.unshift(stripTags(parent.heading));
    parentId = parent.parentSectionId;
  }
  return path.filter(Boolean);
}

/** A task's heading path: its section's, then the task's own title. */
export function getTaskHeadingPath(
  task: Task,
  sectionsById: ReadonlyMap<string, Section>,
): string[] {
  const section = task.sectionId ? sectionsById.get(task.sectionId) : undefined;
  return section
    ? [...getHeadingPath(section, sectionsById), stripTags(task.title)]
    : [stripTags(task.title)];
}

/** A heading as a list titles it: as written, or with its tags taken out. */
export function getNoteTitle(
  heading: string,
  tagTitleDisplayMode: TagTitleDisplayMode,
): string {
  return tagTitleDisplayMode === 'separate' ? stripTags(heading) : heading;
}

/** The entry's tags that its title writes, as the title spells them. */
export function getTitleTags(
  tagKeys: string[],
  tagLabels: Record<string, string>,
  title: string,
): TagReference[] {
  return tagKeys
    .map((key) => ({
      key,
      label: tagLabels[key] ?? `#${key}`,
    }))
    .filter((tag) => title.includes(tag.label));
}

/** What an inline tagged line's title is read from: the whole line. */
export function getInlineSource(section: Section): string {
  return section.isInline && section.rawContent
    ? section.rawContent
    : section.heading;
}

/** An entry's tags as references, each labeled as the entry writes it. */
export function getTagReferences(
  keys: string[],
  labels: Record<string, string>,
): TagReference[] {
  return keys.map((key) => ({ key, label: labels[key] ?? key }));
}

/** The date of a daily note, from its name or its top-level headings. */
export function getDailyNoteDate(file: ParsedFile): string | undefined {
  return findDailyNoteDate(
    file.filePath,
    file.sections
      .filter((section) => section.headingLevel === 1)
      .map((section) => section.heading),
  );
}
