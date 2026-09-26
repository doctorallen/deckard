import { describeDistance, formatShortDay } from '../../core/markdown/dates';
import { formatIsoDate } from '../../core/markdown/taskMetadata';
import { stripTags } from '../../core/markdown/parser';
import {
  NoteLinkEntry,
  NoteLinkGroup,
  NoteLinks,
  NoteMention,
  ParsedFile,
  Section,
  WorkspaceIndex,
} from '../../core/types';
import { getBacklinkIndex, noteTitle } from '../../core/workspace/backlinks';
import { getHeadingPath } from './dashboardState';
import { findUnlinkedMentions } from './editorLensState';

/**
 * What points at a note: the notes that link to it, each line in context
 * under the headings it was written beneath, and the notes that name it
 * without a link.
 *
 * The editor's "Linked from N notes" lens opened a peek of bare lines, and
 * mentions could only be linked all at once. This is the list a note-taking
 * app keeps beside the note, read from the same index.
 */

/** No more than this many of each are listed; the count says the rest. */
const LIMIT = 50;
/** How much of a line's section unfolds under it. */
const SECTION_LINES = 15;
const SECTION_CHARACTERS = 1500;

export interface NoteLinkOptions {
  now?: number;
}

export function collectNoteLinks(
  index: WorkspaceIndex,
  file: ParsedFile,
  options: NoteLinkOptions = {},
): NoteLinks {
  const now = options.now ?? Date.now();
  const linked = getBacklinkIndex(index).toNote(file.filePath);
  const mentions = findUnlinkedMentions(file, index).filter(
    (mention) => mention.filePath !== file.filePath,
  );
  const lines = new Map<string, string[]>();
  const lineOf = (filePath: string, line: number): string => {
    let content = lines.get(filePath);
    if (!content) {
      content = index.files.get(filePath)?.content.split(/\r?\n/) ?? [];
      lines.set(filePath, content);
    }
    return (content[line] ?? '').trim();
  };
  const entry = (filePath: string, zeroBasedLine: number): NoteLinkEntry => ({
    filePath,
    title: noteTitle(filePath),
    line: zeroBasedLine + 1,
    text: lineOf(filePath, zeroBasedLine).slice(0, 200),
    headingPath: headingPathAt(index, filePath, zeroBasedLine + 1),
  });

  // One group a note, newest updated first, so what was written lately
  // about this note is at the top rather than wherever the index put it.
  const bySource = new Map<string, number[]>();
  linked.forEach((occurrence) => {
    const found = bySource.get(occurrence.sourcePath) ?? [];
    if (!found.includes(occurrence.line)) {
      found.push(occurrence.line);
    }
    bySource.set(occurrence.sourcePath, found);
  });
  const groups = [...bySource.entries()]
    .map(([filePath, sourceLines]) => ({
      filePath,
      title: noteTitle(filePath),
      updatedAt: index.files.get(filePath)?.updatedAt,
      sourceLines: sourceLines.sort((left, right) => left - right),
      linkCount: linked.filter((occurrence) => occurrence.sourcePath === filePath).length,
    }))
    .sort(
      (left, right) =>
        (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.title.localeCompare(right.title),
    );
  let room = LIMIT;
  const linkedFromNotes: NoteLinkGroup[] = [];
  for (const group of groups) {
    if (room <= 0) {
      break;
    }
    const shown = group.sourceLines.slice(0, room);
    room -= shown.length;
    linkedFromNotes.push({
      filePath: group.filePath,
      title: group.title,
      ...(group.updatedAt !== undefined
        ? { updatedAt: group.updatedAt, updatedLabel: describeAge(group.updatedAt, now) }
        : {}),
      entries: shown.map((line) => {
        const row = entry(group.filePath, line);
        const sectionText = sectionTextAt(index, group.filePath, line + 1);
        return sectionText ? { ...row, sectionText } : row;
      }),
      linkCount: group.linkCount,
    });
  }

  return {
    linkedFromNotes,
    linkedFromCount: linked.length,
    linkedFromNoteCount: groups.length,
    mentions: mentions.slice(0, LIMIT).map(
      (mention): NoteMention => ({
        ...entry(mention.filePath, mention.line),
        startColumn: mention.startColumn,
        endColumn: mention.endColumn,
        name: mention.text,
      }),
    ),
    mentionCount: mentions.length,
  };
}

/**
 * The search that lists every entry linking to a note, for Linked from's
 * Open as search.
 */
export function createLinksSearchQuery(file: Pick<ParsedFile, 'filePath'>): string {
  return `link = [[${noteTitle(file.filePath)}]]`;
}

/** When a note was updated, in words: `today`, `3 days ago`, or its day. */
function describeAge(at: number, now: number): string {
  return describeDistance(at, now) ?? formatShortDay(formatIsoDate(at), now);
}

/**
 * The heading section whose own lines hold a one-based line, as a search by
 * link reads it.
 */
function findOwnSection(
  index: WorkspaceIndex,
  filePath: string,
  line: number,
): Section | undefined {
  return index.files
    .get(filePath)
    ?.sections.find(
      (section) => !section.isInline && section.startLine <= line && section.bodyEndLine >= line,
    );
}

/** The rest of a line's section, without its heading, cut to fit. */
function sectionTextAt(
  index: WorkspaceIndex,
  filePath: string,
  line: number,
): string | undefined {
  const section = findOwnSection(index, filePath, line);
  if (!section) {
    return undefined;
  }
  const body = section.bodyContent.split(/\r?\n/).slice(1);
  while (body.length > 0 && !body[0].trim()) {
    body.shift();
  }
  while (body.length > 0 && !body[body.length - 1].trim()) {
    body.pop();
  }
  if (body.length === 0) {
    return undefined;
  }
  let text = body.slice(0, SECTION_LINES).join('\n');
  let cut = body.length > SECTION_LINES;
  if (text.length > SECTION_CHARACTERS) {
    text = text.slice(0, SECTION_CHARACTERS).trimEnd();
    cut = true;
  }
  return cut ? `${text}…` : text;
}

/** The headings a line sits under, outermost first, without their tags. */
function headingPathAt(
  index: WorkspaceIndex,
  filePath: string,
  line: number,
): string[] {
  const sections = index.files.get(filePath)?.sections ?? [];
  let within: Section | undefined;
  for (const section of sections) {
    if (
      !section.isInline &&
      section.startLine <= line &&
      section.endLine >= line &&
      (!within || section.startLine >= within.startLine)
    ) {
      within = section;
    }
  }
  if (!within) {
    return [];
  }
  const path = getHeadingPath(within, index.sections);
  const title = stripTags(noteTitle(filePath)).toLowerCase();
  // The note's own title is already the row's name.
  return path[0]?.toLowerCase() === title ? path.slice(1) : path;
}
