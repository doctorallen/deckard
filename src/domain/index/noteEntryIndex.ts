import type { ParsedFile, Section, WorkspaceIndex } from '../model';
import { entryIdOf, entryText, fileEntryId, groupEntryParts } from '../markdown/noteEntries';

/**
 * Each entry's sections across the workspace, by entry id, worked out once
 * per index: an index is replaced, never changed, when a note changes, so
 * the grouping lives as long as the index it was read from.
 */
const partsByIndex = new WeakMap<WorkspaceIndex, Map<string, Section[]>>();

/** Every entry's parts, its own first, in order, by entry id (noteEntries.ts). */
export function getEntryParts(index: WorkspaceIndex): Map<string, Section[]> {
  const cached = partsByIndex.get(index);
  if (cached) {
    return cached;
  }
  const parts = groupEntryParts(index.sections.values());
  partsByIndex.set(index, parts);
  return parts;
}

/** A note's text above its first heading, front matter left out. */
export function getFilePreambleText(file: ParsedFile): string {
  const lines = file.content.split(/\r?\n/);
  const firstHeading = file.sections.filter((section) => !section.isInline).reduce((first, section) => Math.min(first, section.startLine), lines.length + 1);
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
    start = close > 0 ? close + 1 : 0;
  }
  return lines.slice(start, firstHeading - 1).join('\n').trim();
}

/** Each entry's text, read once: an entry's sections are all its note's, reparsed together. */
const entryTexts = new WeakMap<Section, string>();

/**
 * An entry's text, its own and its untagged headings' (noteEntries.ts), read
 * from its note in `index`. A section that owns no other heading reads as its
 * own body, never the headings under it: each of those is a note of its own,
 * with a card of its own, so its text is shown there and only there.
 */
export function getEntryTextOf(index: WorkspaceIndex, section: Section): string {
  const cached = entryTexts.get(section);
  if (cached !== undefined) {
    return cached;
  }
  const file = index.files.get(section.filePath);
  const parts = file?.sections.filter((part) => entryIdOf(part) === section.id).sort((left, right) => left.startLine - right.startLine);
  const text = entryText(parts && parts.length ? parts : [section], section);
  entryTexts.set(section, text);
  return text;
}

/** One line of an entry's text, with where it is written and the heading it is under, when it is under one. */
export interface EntryLine {
  readonly text: string;
  readonly line: number;
  readonly part?: Section;
}

/**
 * A note tagged in its front matter as one entry: its text above its first
 * heading, then its headings with no tags of their own and no tagged heading
 * above them, each line with where it is written. A heading with tags of its
 * own is a note of its own, so its text is left to its own card.
 */
export function getFileEntryLines(index: WorkspaceIndex, file: ParsedFile): EntryLine[] {
  const lines = file.content.split(/\r?\n/);
  const firstHeading = file.sections.filter((section) => !section.isInline).reduce((first, section) => Math.min(first, section.startLine), lines.length + 1);
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
    start = close > 0 ? close + 1 : 0;
  }
  const preamble = lines.slice(start, firstHeading - 1).map((text, offset) => ({ text, line: start + offset + 1 }));
  const parts = [...(getEntryParts(index).get(fileEntryId(file.filePath)) ?? [])].sort((left, right) => left.startLine - right.startLine);
  return [
    ...preamble,
    ...parts.flatMap((part) => part.bodyContent.split(/\r?\n/).map((text, offset) => ({ text, line: part.startLine + offset, part }))),
  ];
}

/** Whether a note tagged in its front matter is an entry: it owns its text above its headings, or an untagged heading. */
export function isFileEntry(file: ParsedFile): boolean {
  const id = fileEntryId(file.filePath);
  return file.frontmatterTags.length > 0 && (file.sections.length === 0 || file.sections.some((section) => section.entryId === id));
}

/** Each index's note count, counted once. */
const noteCounts = new WeakMap<WorkspaceIndex, number>();

/**
 * How many notes the workspace holds, as search counts them: every section
 * that is a note of its own, and every note tagged in its front matter that
 * is an entry as a whole (noteEntries.ts). `is:note` finds this many.
 */
export function countNotes(index: WorkspaceIndex): number {
  const cached = noteCounts.get(index);
  if (cached !== undefined) {
    return cached;
  }
  let count = 0;
  index.sections.forEach((section) => {
    if (entryIdOf(section) === section.id) {
      count += 1;
    }
  });
  index.files.forEach((file) => {
    if (isFileEntry(file)) {
      count += 1;
    }
  });
  noteCounts.set(index, count);
  return count;
}

/**
 * Where each line of an entry's text is written in its note, for an entry
 * that owns untagged headings: its text skips the headings with tags of
 * their own, so line N of it is not line N after the heading. Each line is
 * paired with the heading of the part it is in. Undefined for an entry that
 * owns nothing, whose text is contiguous.
 */
export function getEntryLineMap(
  index: WorkspaceIndex,
  section: Section,
): { line: number; part: Section }[] | undefined {
  const file = index.files.get(section.filePath);
  const parts = file?.sections.filter((part) => entryIdOf(part) === section.id).sort((left, right) => left.startLine - right.startLine);
  if (!parts || parts.length < 2) {
    return undefined;
  }
  return parts.flatMap((part) => part.bodyContent.split(/\r?\n/).map((_text, offset) => ({ line: part.startLine + offset, part })));
}
