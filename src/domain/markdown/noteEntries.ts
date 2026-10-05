import type { Section, Task } from '../model';

/**
 * What counts as one note (an entry): a heading with tags of its own and
 * every untagged heading under it, down to, not into, a heading with tags of
 * its own; a note tagged in its front matter, as a whole, past any heading
 * with tags of its own; a tagged line that stands as a note of its own; and,
 * where no tag reaches, each heading, as before. Each section and task is
 * marked with the entry that owns it, so search, a tag's page, and every
 * count of notes read one note where the note is written as one
 * (docs/implementation/24-note-entries.md).
 */

/** The id a note tagged in its front matter is known by as an entry. */
export function fileEntryId(filePath: string): string {
  return `file:${filePath}`;
}

/** The entry a section belongs to: the one it names, else itself. */
export function entryIdOf(section: Pick<Section, 'id' | 'entryId'>): string {
  return section.entryId ?? section.id;
}

/** Whether a section is a note of its own rather than part of one above it. */
export function isEntrySection(section: Pick<Section, 'id' | 'entryId'>): boolean {
  return entryIdOf(section) === section.id;
}

/**
 * Marks each of a note's sections and tasks with the entry that owns it,
 * leaving `entryId` unset where a section is its own entry. A heading is
 * owned by itself when it has tags of its own, else by the nearest heading
 * above it with tags of its own, else by the note when its front matter has
 * tags, else by itself. A tagged line that is a note of its own owns itself;
 * a task is owned by the entry that owns the heading it is under, or by the
 * note above the first heading.
 */
export function assignNoteEntries(
  filePath: string,
  sections: Section[],
  tasks: Task[],
  frontmatterTagged: boolean,
): void {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const ownerOf = (section: Section): string => {
    if (section.isInline || section.headingTags?.length) {
      return section.id;
    }
    const seen = new Set<string>();
    let parentId = section.parentSectionId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) {
        break;
      }
      if (!parent.isInline && parent.headingTags?.length) {
        return parent.id;
      }
      parentId = parent.parentSectionId;
    }
    return frontmatterTagged ? fileEntryId(filePath) : section.id;
  };
  for (const section of sections) {
    const owner = ownerOf(section);
    if (owner !== section.id) {
      section.entryId = owner;
    }
  }
  for (const task of tasks) {
    const section = task.sectionId ? byId.get(task.sectionId) : undefined;
    if (section) {
      if (section.entryId) {
        task.entryId = section.entryId;
      }
    } else if (frontmatterTagged) {
      task.entryId = fileEntryId(filePath);
    }
  }
}

/** Each entry's sections, its own first, in the order they are written, by entry id. */
export function groupEntryParts(sections: Iterable<Section>): Map<string, Section[]> {
  const parts = new Map<string, Section[]>();
  for (const section of sections) {
    const id = entryIdOf(section);
    const list = parts.get(id);
    if (list) {
      list.push(section);
    } else {
      parts.set(id, [section]);
    }
  }
  parts.forEach((list) => list.sort((left, right) => left.startLine - right.startLine));
  return parts;
}

/**
 * An entry's text: the own text (`bodyContent`) of each section it owns, in
 * order, so a heading with tags of its own reads through its untagged
 * headings and skips the ones with tags of their own.
 */
export function entryText(parts: readonly Section[] | undefined, fallback: Section): string {
  return (parts && parts.length > 0 ? parts : [fallback]).map((part) => part.bodyContent).join('\n');
}
