import { stripTags } from '../../core/markdown/parser';
import { getFileName, getFolder } from '../../core/paths';
import { pinKey } from '../../core/storage/preferences';
import { PinnedNote, Section, WorkspaceIndex } from '../../core/types';

/**
 * What Home's pinned notes point at.
 *
 * A note in Deckard is an entry — a heading and what is written under it —
 * so a pin names one, not the file it happens to live in. A section's id is
 * a hash of its path, its line and its heading, so it changes the moment
 * anything above it is edited; a pin that stored one would quietly disappear
 * the first time its note was written in. A pin therefore keeps what a
 * reader would use to find the heading again — its text, its level, and
 * which heading of that text it is — and is resolved against the index each
 * time Home draws.
 */

/** A pin's identity, which a row sends back to unpin it. */
export { pinKey };

/** Whether two pins name the same thing. */
export function samePin(left: PinnedNote, right: PinnedNote): boolean {
  return pinKey(left) === pinKey(right);
}

/**
 * The pin for a line of a note: the heading it sits under, or the whole note
 * when it sits above every heading, as a front-matter-only note does.
 */
export function createPinForLine(
  index: WorkspaceIndex,
  filePath: string,
  line: number,
): PinnedNote | undefined {
  const file = index.files.get(filePath);
  if (!file) {
    return undefined;
  }
  const section = findHeadingAt(file.sections, line);
  if (!section) {
    return { filePath };
  }
  return {
    filePath,
    heading: section.heading,
    headingLevel: section.headingLevel,
    occurrence: countSameHeadingsBefore(file.sections, section),
  };
}

/** Where a pin points now: its heading if it is still there, or the note. */
export function resolvePin(
  index: WorkspaceIndex,
  pin: PinnedNote,
): { filePath: string; line: number; title: string; detail: string } | undefined {
  const file = index.files.get(pin.filePath);
  if (!file) {
    return undefined;
  }
  const fileName = getFileName(pin.filePath);
  const folder = getFolder(pin.filePath);
  const place = folder ? `${fileName} · ${folder}` : fileName;

  const section = pin.heading ? findPinnedSection(file.sections, pin) : undefined;
  if (pin.heading && !section) {
    // The heading is gone. The pin keeps the note rather than vanishing,
    // and says which heading it was put on.
    return {
      filePath: pin.filePath,
      line: 1,
      title: stripTags(pin.heading).trim() || fileName,
      detail: `${place} · heading not found`,
    };
  }
  if (section) {
    return {
      filePath: pin.filePath,
      line: section.startLine,
      title: stripTags(section.heading).trim() || fileName,
      detail: place,
    };
  }
  const first = file.sections.find((candidate) => !candidate.isInline);
  return {
    filePath: pin.filePath,
    line: 1,
    title: (first ? stripTags(first.heading).trim() : '') || fileName,
    detail: place,
  };
}

/**
 * Finds a pinned heading again by its text, its level, and which heading of
 * that text it is — the way `findSameSection` finds the heading a capture
 * chose. Failing that, the first heading with the same text, since a heading
 * promoted or demoted is still the one that was pinned.
 */
export function findPinnedSection(
  sections: readonly Section[],
  pin: PinnedNote,
): Section | undefined {
  const same = sections.filter(
    (section) =>
      !section.isInline &&
      section.heading === pin.heading &&
      (pin.headingLevel === undefined ||
        section.headingLevel === pin.headingLevel),
  );
  if (same.length > 0) {
    return same[Math.min(pin.occurrence ?? 0, same.length - 1)];
  }
  return sections.find(
    (section) => !section.isInline && section.heading === pin.heading,
  );
}

/** The innermost heading a one-based line sits in. */
function findHeadingAt(
  sections: readonly Section[],
  line: number,
): Section | undefined {
  return sections
    .filter(
      (section) =>
        !section.isInline &&
        section.startLine <= line &&
        section.endLine >= line,
    )
    .sort(
      (left, right) =>
        right.startLine - left.startLine ||
        right.headingLevel - left.headingLevel,
    )[0];
}

/** How many headings of the same text and level come before this one. */
function countSameHeadingsBefore(
  sections: readonly Section[],
  section: Section,
): number {
  return sections.filter(
    (candidate) =>
      !candidate.isInline &&
      candidate.heading === section.heading &&
      candidate.headingLevel === section.headingLevel &&
      candidate.startLine < section.startLine,
  ).length;
}
