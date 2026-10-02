import { isParkedFile } from '../../domain/index/parked';
import { describeDistance, formatShortDay } from '../../domain/markdown/dates';
import { formatIsoDate } from '../../domain/markdown/taskMetadata';
import { isPeriodicNoteFile, stripTags } from '../../domain/markdown/parser';
import {
  NoteLinkEntry,
  NoteLinkGroup,
  NoteLinks,
  NoteMention,
  ParsedFile,
  Section,
  WorkspaceIndex,
} from '../../core/types';
import { getBacklinkIndex, noteTitle } from '../../domain/index/backlinks';
import { getHeadingPath } from '../../domain/ranking/entryLabels';
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
/** The most characters of a section shown, once it is cut to SECTION_LINES lines. */
const SECTION_CHARACTERS = 1500;

/** When the list is read, and whether it leaves out periodic notes. */
export interface NoteLinkOptions {
  /** The moment the links are listed at, which says how lately each note changed. */
  now: number;
  /** Leave out links from daily, weekly, and monthly notes, and count them. */
  hideDailyNotes?: boolean;
}

/**
 * Lists what points at `file`: the notes linking to it, one group a note,
 * newest updated first and parked notes last, with up to LIMIT lines across
 * them; and the notes that name it without a link, up to LIMIT. The counts
 * say how many there are in all.
 */
export function collectNoteLinks(
  index: WorkspaceIndex,
  file: ParsedFile,
  options: NoteLinkOptions,
): NoteLinks {
  const everyLink = getBacklinkIndex(index).toNote(file.filePath);
  const { linked, hidden } = options.hideDailyNotes
    ? leaveOutPeriodicNotes(index, everyLink)
    : { linked: everyLink, hidden: new Set<string>() };
  const mentions = findUnlinkedMentions(file, index).filter(
    (mention) => mention.filePath !== file.filePath,
  );
  const entry = createEntryReader(index);
  const groups = groupBySource(index, linked);
  return {
    linkedFromNotes: listLinkedFromNotes(index, groups, entry, options.now),
    linkedFromCount: linked.length,
    linkedFromNoteCount: groups.length,
    ...(hidden.size > 0 ? { hiddenDailyNoteCount: hidden.size } : {}),
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

/** A link to the note, as the backlink index records it. */
type LinkOccurrence = ReturnType<ReturnType<typeof getBacklinkIndex>['toNote']>[number];

/** A linking note before its lines are cut to fit. */
interface SourceGroup {
  filePath: string;
  title: string;
  updatedAt: number | undefined;
  /** Zero-based lines that link, in order, each once. */
  sourceLines: number[];
  linkCount: number;
  parked: boolean;
}

/** Reads one line of a note as a row, under the headings it sits beneath. */
type EntryReader = (filePath: string, zeroBasedLine: number) => NoteLinkEntry;

/**
 * Leaves out links from periodic notes. A daily note links to everything
 * written that day, so it can be left out; the notes left out are counted,
 * so the list can say so.
 */
function leaveOutPeriodicNotes(
  index: WorkspaceIndex,
  everyLink: readonly LinkOccurrence[],
): { linked: LinkOccurrence[]; hidden: Set<string> } {
  const hidden = new Set<string>();
  const linked = everyLink.filter((occurrence) => {
    const source = index.files.get(occurrence.sourcePath);
    if (source && isPeriodicNoteFile(source)) {
      hidden.add(occurrence.sourcePath);
      return false;
    }
    return true;
  });
  return { linked, hidden };
}

/** An EntryReader that splits each note into lines once, however many rows it reads from it. */
function createEntryReader(index: WorkspaceIndex): EntryReader {
  const lines = new Map<string, string[]>();
  const lineOf = (filePath: string, line: number): string => {
    let content = lines.get(filePath);
    if (!content) {
      content = index.files.get(filePath)?.content.split(/\r?\n/) ?? [];
      lines.set(filePath, content);
    }
    return (content[line] ?? '').trim();
  };
  return (filePath, zeroBasedLine) => ({
    filePath,
    title: noteTitle(filePath),
    line: zeroBasedLine + 1,
    text: lineOf(filePath, zeroBasedLine).slice(0, 200),
    headingPath: headingPathAt(index, filePath, zeroBasedLine + 1),
  });
}

/**
 * One group a note, newest updated first, so what was written lately about
 * this note is at the top rather than wherever the index put it. A link from
 * a parked note is a fact, so it stays, after the rest.
 */
function groupBySource(
  index: WorkspaceIndex,
  linked: readonly LinkOccurrence[],
): SourceGroup[] {
  const bySource = new Map<string, number[]>();
  linked.forEach((occurrence) => {
    const found = bySource.get(occurrence.sourcePath) ?? [];
    if (!found.includes(occurrence.line)) {
      found.push(occurrence.line);
    }
    bySource.set(occurrence.sourcePath, found);
  });
  return [...bySource.entries()]
    .map(([filePath, sourceLines]) => ({
      filePath,
      title: noteTitle(filePath),
      updatedAt: index.files.get(filePath)?.updatedAt,
      sourceLines: sourceLines.sort((left, right) => left - right),
      linkCount: linked.filter((occurrence) => occurrence.sourcePath === filePath).length,
      parked: isParkedFile(index, filePath),
    }))
    .sort(
      (left, right) =>
        Number(left.parked) - Number(right.parked) ||
        (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
        left.title.localeCompare(right.title),
    );
}

/** The groups as Linked from draws them, until LIMIT lines are shown across them. */
function listLinkedFromNotes(
  index: WorkspaceIndex,
  groups: readonly SourceGroup[],
  entry: EntryReader,
  now: number,
): NoteLinkGroup[] {
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
      ...(group.updatedAt === undefined
        ? {}
        : { updatedAt: group.updatedAt, updatedLabel: describeAge(group.updatedAt, now) }),
      entries: shown.map((line) => {
        const row = entry(group.filePath, line);
        const sectionText = sectionTextAt(index, group.filePath, line + 1);
        return sectionText ? { ...row, sectionText } : row;
      }),
      linkCount: group.linkCount,
      ...(group.parked ? { parked: true as const } : {}),
    });
  }
  return linkedFromNotes;
}

/**
 * The search that lists every entry linking to a note, for Linked from's
 * Open as search, leaving out daily notes while Linked from does.
 */
export function createLinksSearchQuery(
  file: Pick<ParsedFile, 'filePath'>,
  hideDailyNotes = false,
): string {
  return `link = [[${noteTitle(file.filePath)}]]${hideDailyNotes ? ' -is:periodic' : ''}`;
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
