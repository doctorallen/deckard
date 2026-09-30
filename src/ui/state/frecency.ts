import { Section, WorkspaceIndex } from '../../core/types';

/**
 * Ranks things by how often and how recently they were opened.
 *
 * Firefox's address bar calls this frecency. Deckard keeps only a count and
 * the last time for each tag and note entry, so the score is the count,
 * softened with a logarithm so a habit does not drown out something opened
 * yesterday, decayed by the time since it was last opened. Something never
 * timed, such as a count recorded before times were kept, decays as if it
 * were opened one half-life ago.
 */
export const FRECENCY_HALF_LIFE_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

export function frecencyScore(
  count: number,
  lastAccess: number | undefined,
  /** The moment the score is for, which the caller read once for all its scores. */
  now: number,
  halfLifeDays = FRECENCY_HALF_LIFE_DAYS,
): number {
  if (count <= 0 && lastAccess === undefined) {
    return 0;
  }
  const ageDays =
    lastAccess === undefined
      ? halfLifeDays
      : Math.max(0, (now - lastAccess) / DAY);
  return Math.log2(2 + Math.max(0, count)) * 0.5 ** (ageDays / halfLifeDays);
}

/**
 * Where each heading went between two indexes: an old section id that is
 * gone, mapped to the new id of the same heading in the same note, matched
 * by its text, its level, and which heading of that text it is, as a pin
 * is. A heading's id changes whenever a line above it does, which would
 * otherwise lose its view count every time its note was written in.
 */
export function carrySectionIds(
  previous: WorkspaceIndex,
  next: WorkspaceIndex,
): Map<string, string> {
  const moved = new Map<string, string>();
  previous.files.forEach((oldFile, filePath) => {
    const newFile = next.files.get(filePath);
    if (!newFile || oldFile === newFile) {
      return;
    }
    const gone = oldFile.sections.filter(
      (section) => !section.isInline && !next.sections.has(section.id),
    );
    if (gone.length === 0) {
      return;
    }
    const byHeading = groupHeadings(newFile.sections);
    const oldByHeading = groupHeadings(oldFile.sections);
    gone.forEach((section) => {
      const key = headingKey(section);
      const occurrence = (oldByHeading.get(key) ?? []).indexOf(section);
      const match = (byHeading.get(key) ?? [])[occurrence];
      if (match && match.id !== section.id) {
        moved.set(section.id, match.id);
      }
    });
  });
  return moved;
}

function headingKey(section: Section): string {
  return `${section.headingLevel}\u0000${section.heading}`;
}

function groupHeadings(sections: readonly Section[]): Map<string, Section[]> {
  const groups = new Map<string, Section[]>();
  sections
    .filter((section) => !section.isInline)
    .sort((left, right) => left.startLine - right.startLine)
    .forEach((section) => {
      const key = headingKey(section);
      groups.set(key, [...(groups.get(key) ?? []), section]);
    });
  return groups;
}
