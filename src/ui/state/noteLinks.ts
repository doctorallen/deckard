import { stripTags } from '../../core/markdown/parser';
import {
  NoteLinkEntry,
  NoteLinks,
  NoteMention,
  ParsedFile,
  Section,
  WorkspaceIndex,
} from '../../core/types';
import {
  BacklinkIndex,
  buildBacklinkIndex,
  noteTitle,
} from '../../core/workspace/backlinks';
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
const backlinkCache = new WeakMap<WorkspaceIndex, BacklinkIndex>();

/** No more than this many of each are listed; the count says the rest. */
const LIMIT = 50;

export function collectNoteLinks(
  index: WorkspaceIndex,
  file: ParsedFile,
): NoteLinks {
  let backlinks = backlinkCache.get(index);
  if (!backlinks) {
    backlinks = buildBacklinkIndex(index);
    backlinkCache.set(index, backlinks);
  }
  const linked = backlinks.toNote(file.filePath);
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
  return {
    linkedFrom: linked
      .slice(0, LIMIT)
      .map((occurrence) => entry(occurrence.sourcePath, occurrence.line)),
    linkedFromCount: linked.length,
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
