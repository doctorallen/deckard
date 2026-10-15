/**
 * Older lines like the one being written, as the editor's hint and hover
 * and Context's Written before section say them: when and where each was
 * written, its words with the ones it shares marked, and what it shares
 * (docs/implementation/39-written-before.md § Where it shows).
 */
import { type DateFormats, DEFAULT_DATE_FORMATS, formatDisplayDate } from '../../domain/markdown/dateFormat';
import { stripTags } from '../../domain/markdown/parser';
import type { WorkspaceIndex } from '../../domain/model';
import type { WrittenBeforeMatch } from '../../domain/ranking/writtenBefore';
import { escapeMarkdown } from '../../shared/text';

/** An older line, as the hover and Context draw it. */
export interface WrittenBeforeRow {
  filePath: string;
  /** One-based. */
  line: number;
  text: string;
  /** The day it was written, in the reader's short format, when its note says. */
  day?: string;
  /** The heading it is under, without its tags. */
  heading?: string;
  /** The uncommon words both lines hold, the weightiest first. */
  shared: readonly string[];
  /** The tags both lines carry, as written. */
  sharedTags: readonly string[];
}

/** An older line as a row: its day and heading read from the index. */
export function toWrittenBeforeRow(
  index: WorkspaceIndex,
  match: WrittenBeforeMatch,
  options: { now: number; dateFormats?: DateFormats },
): WrittenBeforeRow {
  const heading = headingOf(index, match.sectionId);
  return {
    filePath: match.filePath,
    line: match.line,
    text: match.text,
    ...(match.at === undefined ? {} : { day: formatDisplayDate(match.at, options.dateFormats ?? DEFAULT_DATE_FORMATS, 'short', options.now) }),
    ...(heading ? { heading } : {}),
    shared: match.shared,
    sharedTags: match.sharedTags,
  };
}

/** The heading an entry is under, its own for a heading, without its tags. */
function headingOf(index: WorkspaceIndex, sectionId: string | undefined): string | undefined {
  let section = sectionId ? index.sections.get(sectionId) : undefined;
  const visited = new Set<string>();
  while (section?.isInline && section.parentSectionId && !visited.has(section.id)) {
    visited.add(section.id);
    section = index.sections.get(section.parentSectionId);
  }
  const heading = section && !section.isInline ? stripTags(section.heading).trim() : '';
  return heading || undefined;
}

/** Where an older line is: `Thu, Mar 12 · Rates desk standup`, or its note's path. */
export function describeWhere(row: Pick<WrittenBeforeRow, 'day' | 'heading' | 'filePath'>): string {
  return [row.day, row.heading].filter(Boolean).join(' · ') || row.filePath;
}

/** What two lines share: `Shares curve, feed, lagged… · both tagged #team/rates`. */
export function describeShared(row: Pick<WrittenBeforeRow, 'shared' | 'sharedTags'>): string {
  const words = row.shared.slice(0, 3).join(', ');
  const more = row.shared.length > 3 ? '…' : '';
  const tagged = row.sharedTags.length > 0 ? ` · both tagged ${row.sharedTags.join(', ')}` : '';
  return `Shares ${words}${more}${tagged}`;
}

/**
 * An older line's words for the hover, escaped for Markdown, with each word
 * the lines share in bold where it starts a word.
 */
export function markSharedWords(text: string, shared: readonly string[]): string {
  const wanted = new Set(shared.map((word) => word.toLowerCase()));
  return text
    .split(/(\s+)/)
    .map((part) => {
      // The word alone is marked, without the punctuation around it.
      const [, before = '', word = '', after = ''] = /^([^A-Za-z]*)([A-Za-z][A-Za-z-]*)(.*)$/.exec(part) ?? [];
      return word && wanted.has(word.toLowerCase())
        ? `${escapeMarkdown(before)}**${escapeMarkdown(word)}**${escapeMarkdown(after)}`
        : escapeMarkdown(part);
    })
    .join('');
}

/** The links an older line's part of the hover ends with. */
export interface WrittenBeforeLinks {
  open: string;
  linkHere: string;
  notSame: string;
}

/**
 * The hover over the hint, or a marked line: *Written before · 2 close
 * matches*, then each older line, its day and heading, its words with the
 * shared ones marked, what they share, and Open, Link it here, and Not the
 * same.
 */
export function describeWrittenBeforeHover(rows: readonly WrittenBeforeRow[], linksOf: (row: WrittenBeforeRow) => WrittenBeforeLinks): string {
  const lines = [`**Written before** · ${rows.length === 1 ? '1 close match' : `${rows.length} close matches`}`];
  rows.forEach((row) => {
    const links = linksOf(row);
    lines.push(
      '',
      `**${escapeMarkdown(describeWhere(row))}**`,
      '',
      markSharedWords(row.text, row.shared),
      '',
      `*${escapeMarkdown(describeShared(row))}*`,
      '',
      `[Open](${links.open}) · [Link it here](${links.linkHere}) · [Not the same](${links.notSame})`,
    );
  });
  return lines.join('\n');
}
