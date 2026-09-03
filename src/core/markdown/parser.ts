import {
  HeadingTagSpan,
  ParsedFile,
  Section,
  TagReference,
  Task,
} from '../types';

interface HeadingMatch {
  lineNumber: number;
  level: number;
  text: string;
}

const headingPattern = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/;
const taskPattern = /^(\s*)([-*+])[ \t]+\[([ xX])\][ \t]+(.*)$/;
const tagPattern = /(^|[^\w])([@#])([A-Za-z0-9][A-Za-z0-9_-]*)\b/g;

export interface MarkdownParseOptions {
  parseInlineTags?: boolean;
}

/**
 * Builds every indexable representation of a note from one Markdown pass.
 *
 * Fence detection happens first so headings, tasks, tag decorations, and
 * completion all agree on which source text is real note content.
 */
export function parseMarkdown(
  filePath: string,
  content: string,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  options: MarkdownParseOptions = {},
): ParsedFile {
  const lines = content.split(/\r?\n/);
  const fencedLines = findFencedLines(lines);
  const headings = findHeadings(lines, fencedLines);
  const headingSections = headings.map((heading, headingIndex) =>
    createSection(filePath, lines, headings, heading, headingIndex, metadata),
  );
  const inlineSections =
    options.parseInlineTags === false
      ? []
      : findInlineSections(filePath, lines, fencedLines, metadata);
  const sections = [...headingSections, ...inlineSections].sort(
    (left, right) => left.startLine - right.startLine,
  );
  const tasks = findTasks(
    filePath,
    lines,
    headings,
    headingSections,
    fencedLines,
    metadata,
  );

  return {
    filePath,
    content,
    sections,
    tasks,
    createdAt: metadata?.createdAt,
    updatedAt: metadata?.updatedAt,
  };
}

/**
 * Normalizes tag identity without rewriting the spelling shown to users.
 *
 * A shared key lets `#Work` and `@work` aggregate together while retaining
 * the first source label for display in the editor and webviews.
 */
export function extractTags(text: string): TagReference[] {
  const tags: TagReference[] = [];
  const seen = new Set<string>();

  for (const match of findTagMatches(text)) {
    const key = match.key;

    if (!seen.has(key)) {
      seen.add(key);
      tags.push({ key, label: match.label });
    }
  }

  return tags;
}

/**
 * Keeps the older heading-only span contract for callers that need it.
 *
 * Heading spans remain useful as the conservative default for editor links;
 * callers that opt into inline tags use `extractTagSpans` directly.
 */
export function extractHeadingTagSpans(content: string): HeadingTagSpan[] {
  return extractTagSpans(content, false);
}

/**
 * Produces source ranges using the same fence and inline-tag rules as parsing.
 *
 * The column offset is preserved because heading text is scanned as a
 * substring, but the resulting ranges must still point into the full editor.
 */
export function extractTagSpans(
  content: string,
  parseInlineTags = true,
): HeadingTagSpan[] {
  const lines = content.split(/\r?\n/);
  const fencedLines = findFencedLines(lines);

  return lines.flatMap((line, lineIndex) => {
    if (fencedLines.has(lineIndex)) {
      return [];
    }

    const heading = line.match(headingPattern);
    if (heading) {
      const headingTextStart = heading[0].indexOf(heading[2]);
      return createTagSpans(heading[2], lineIndex + 1, headingTextStart);
    }

    if (!parseInlineTags) {
      return [];
    }

    return createTagSpans(line, lineIndex + 1, 0);
  });
}

/**
 * Converts matches in a substring back into document coordinates.
 *
 * Keeping this offset calculation beside tag matching prevents decorations
 * and document links from drifting when a heading has Markdown indentation.
 */
function createTagSpans(
  text: string,
  lineNumber: number,
  columnOffset: number,
): HeadingTagSpan[] {
  return findTagMatches(text).map((match) => ({
    key: match.key,
    label: match.label,
    lineNumber,
    startColumn: columnOffset + match.start,
    endColumn: columnOffset + match.end,
  }));
}

/**
 * Removes tag syntax from display titles while preserving numeric hash text.
 *
 * Numeric hashes can be dates or ordinary heading content, so stripping them
 * would make related-note titles misleading even though they are not tags.
 */
export function stripTags(text: string): string {
  return text
    .replace(
      tagPattern,
      (fullMatch, prefix: string, marker: string, rawName: string) =>
        isNumericHashTag(marker, rawName) ? fullMatch : prefix,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

interface TagMatch extends TagReference {
  start: number;
  end: number;
}

/**
 * Finds the canonical tag token used by every parser consumer.
 *
 * Centralizing normalization and numeric-hash filtering keeps counts,
 * navigation ranges, and rendered titles consistent with one another.
 */
function findTagMatches(text: string): TagMatch[] {
  return [...text.matchAll(tagPattern)].flatMap((match) => {
    const marker = match[2];
    const rawName = match[3];
    if (isNumericHashTag(marker, rawName)) {
      return [];
    }

    const markerIndex = (match.index ?? 0) + match[0].lastIndexOf(marker);
    return [
      {
        key: rawName.toLowerCase(),
        label: `${marker}${rawName}`,
        start: markerIndex,
        end: markerIndex + marker.length + rawName.length,
      },
    ];
  });
}

/**
 * Distinguishes numeric hash text from a real tag without rejecting numeric
 * `@` tags, which are valid identifiers for dates or other user conventions.
 */
function isNumericHashTag(marker: string, rawName: string): boolean {
  return marker === '#' && /^\d+$/.test(rawName);
}

/**
 * Collects headings before sections are built so section boundaries and task
 * inheritance use one fence-aware source of truth.
 */
function findHeadings(
  lines: string[],
  fencedLines: Set<number>,
): HeadingMatch[] {
  const headings: HeadingMatch[] = [];

  lines.forEach((line, lineIndex) => {
    if (fencedLines.has(lineIndex)) {
      return;
    }
    const match = line.match(headingPattern);
    if (match) {
      headings.push({
        lineNumber: lineIndex + 1,
        level: match[1].length,
        text: stripClosingHeadingHashes(match[2].trim()),
      });
    }
  });

  return headings;
}

/**
 * Builds a heading section whose end is controlled by the next heading at the
 * same or higher level, matching Markdown's nested-section structure.
 */
function createSection(
  filePath: string,
  lines: string[],
  headings: HeadingMatch[],
  heading: HeadingMatch,
  headingIndex: number,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
): Section {
  const nextBoundary = headings
    .slice(headingIndex + 1)
    .find((candidate) => candidate.level <= heading.level);
  const endLine = nextBoundary ? nextBoundary.lineNumber - 1 : lines.length;
  const sectionTags = extractTags(heading.text);
  const tagLabels = Object.fromEntries(
    sectionTags.map((tag) => [tag.key, tag.label]),
  );

  return {
    id: createId(
      'section',
      `${filePath}:${heading.lineNumber}:${heading.text}`,
    ),
    filePath,
    heading: heading.text,
    headingLevel: heading.level,
    tags: sectionTags.map((tag) => tag.key),
    tagLabels,
    rawContent: lines.slice(heading.lineNumber - 1, endLine).join('\n'),
    startLine: heading.lineNumber,
    endLine,
    createdAt: metadata?.createdAt,
    updatedAt: metadata?.updatedAt,
  };
}

/**
 * Represents tagged prose as an entry only when it is not already a heading or
 * task, avoiding duplicate dashboard counts for checklist lines.
 */
function findInlineSections(
  filePath: string,
  lines: string[],
  fencedLines: Set<number>,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
): Section[] {
  return lines.flatMap((line, lineIndex) => {
    if (
      fencedLines.has(lineIndex) ||
      headingPattern.test(line) ||
      taskPattern.test(line)
    ) {
      return [];
    }

    const inlineTags = extractTags(line);
    if (inlineTags.length === 0) {
      return [];
    }

    const lineNumber = lineIndex + 1;
    return [
      {
        id: createId('inline', `${filePath}:${lineNumber}:${line}`),
        filePath,
        heading: line.trim(),
        headingLevel: 0,
        isInline: true,
        tags: inlineTags.map((tag) => tag.key),
        tagLabels: Object.fromEntries(
          inlineTags.map((tag) => [tag.key, tag.label]),
        ),
        rawContent: '',
        startLine: lineNumber,
        endLine: lineNumber,
        createdAt: metadata?.createdAt,
        updatedAt: metadata?.updatedAt,
      },
    ];
  });
}

/**
 * Captures the exact source line as well as parsed task data.
 *
 * The source snapshot lets checkbox updates verify that the note has not
 * changed before applying a one-character edit.
 */
function findTasks(
  filePath: string,
  lines: string[],
  headings: HeadingMatch[],
  headingSections: Section[],
  fencedLines: Set<number>,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
): Task[] {
  return lines.flatMap((line, lineIndex) => {
    if (fencedLines.has(lineIndex)) {
      return [];
    }
    const match = line.match(taskPattern);
    if (!match) {
      return [];
    }

    const lineNumber = lineIndex + 1;
    const sectionIndex = findNearestHeadingIndex(headings, lineNumber);
    const section =
      sectionIndex >= 0 ? headingSections[sectionIndex] : undefined;
    const inlineTags = extractTags(match[4]);
    const tags = mergeTags(
      section?.tags ?? [],
      inlineTags.map((tag) => tag.key),
    );
    const tagLabels = mergeTagLabels(section?.tagLabels ?? {}, inlineTags);
    const checkboxColumn = match[1].length + match[2].length + 2;
    const checkboxValue = match[3] as ' ' | 'x' | 'X';

    return [
      {
        id: createId('task', `${filePath}:${lineNumber}:${match[4]}`),
        filePath,
        sectionId: section?.id,
        title: match[4],
        completed: checkboxValue !== ' ',
        tags,
        tagLabels,
        lineNumber,
        checkboxColumn,
        checkboxValue,
        sourceLineText: line,
        createdAt: metadata?.createdAt,
        updatedAt: metadata?.updatedAt,
      },
    ];
  });
}

/**
 * Marks fence delimiters and their contents in one pass so every Markdown
 * feature can ignore examples without maintaining a second parser.
 */
export function findFencedLines(lines: string[]): Set<number> {
  const fencedLines = new Set<number>();
  let fenceCharacter: '`' | '~' | undefined;

  lines.forEach((line, lineIndex) => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      fencedLines.add(lineIndex);
      const nextFenceCharacter = fence[1][0] as '`' | '~';
      if (fenceCharacter === undefined) {
        fenceCharacter = nextFenceCharacter;
      } else if (fenceCharacter === nextFenceCharacter) {
        fenceCharacter = undefined;
      }
      return;
    }

    if (fenceCharacter !== undefined) {
      fencedLines.add(lineIndex);
    }
  });

  return fencedLines;
}

/**
 * Finds the last heading before a task so inherited tags follow source order.
 */
function findNearestHeadingIndex(
  headings: HeadingMatch[],
  lineNumber: number,
): number {
  let nearestIndex = -1;

  headings.forEach((heading, headingIndex) => {
    if (heading.lineNumber < lineNumber) {
      nearestIndex = headingIndex;
    }
  });

  return nearestIndex;
}

/**
 * Combines inherited and local tags while preventing duplicate filter entries.
 */
function mergeTags(sectionTags: string[], inlineTags: string[]): string[] {
  return [...new Set([...sectionTags, ...inlineTags])];
}

/**
 * Preserves the heading's display spelling when a task repeats the same key.
 *
 * This keeps labels stable across a section while still adding labels for
 * tags introduced only on the task line.
 */
function mergeTagLabels(
  sectionLabels: Record<string, string>,
  inlineTags: TagReference[],
): Record<string, string> {
  const labels = { ...sectionLabels };

  inlineTags.forEach((tag) => {
    labels[tag.key] ??= tag.label;
  });

  return labels;
}

/**
 * Tells completion whether a trailing hash belongs to ATX syntax, not a tag.
 */
export function hasAtxHeadingClosingHashes(line: string): boolean {
  const match = line.match(headingPattern);
  if (!match) {
    return false;
  }

  const text = match[2].trim();
  return stripClosingHeadingHashes(text) !== text;
}

/**
 * Applies the optional closing-hash rule from ATX headings to display text.
 */
function stripClosingHeadingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/**
 * Creates deterministic IDs so persisted ranks and access counts survive a
 * workspace rescan without storing metadata in the Markdown source.
 */
function createId(prefix: string, value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return `${prefix}-${Math.abs(hash).toString(36)}`;
}
