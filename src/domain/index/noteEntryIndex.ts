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
 * from its note in `index`; a section that owns nothing reads as itself.
 */
export function getEntryTextOf(index: WorkspaceIndex, section: Section): string {
  const cached = entryTexts.get(section);
  if (cached !== undefined) {
    return cached;
  }
  const file = index.files.get(section.filePath);
  const parts = file?.sections.filter((part) => entryIdOf(part) === section.id).sort((left, right) => left.startLine - right.startLine);
  const text = parts && parts.length > 1 ? entryText(parts, section) : section.rawContent;
  entryTexts.set(section, text);
  return text;
}

/** Whether a note tagged in its front matter is an entry: it owns its text above its headings, or an untagged heading. */
export function isFileEntry(file: ParsedFile): boolean {
  const id = fileEntryId(file.filePath);
  return file.frontmatterTags.length > 0 && (file.sections.length === 0 || file.sections.some((section) => section.entryId === id));
}
