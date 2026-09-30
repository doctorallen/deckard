import type { HeadingTagSpan, TagReference } from '../model';
import {
  EntityNamespaceAliases,
  extractTagSpans,
  getEntityKind,
  getPersonMarker,
} from './parser';

/**
 * The tag-rewrite engine that Rename Tag and Merge Tags run on each note:
 * which characters of a note's source change when one tag becomes another,
 * and what they change to.
 *
 * It works on text alone, so the same plan is made whether the note is open
 * in an editor or only on disk, and a test can check a rewrite without VS
 * Code.
 */

/** How the notes being rewritten read their tags, as their folder's settings say. */
export interface RenameTagOptions {
  entityNamespaceAliases?: EntityNamespaceAliases;
  personMarker?: string;
}

/** One change to a note's source: the characters from `start` to `end` become `text`. */
export interface TagEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Replaces only parser-recognized spans whose canonical key matches the
 * selected tag. Ranges are applied from right to left so offsets stay stable.
 */
export function replaceIndexedTag(
  content: string,
  sourceKey: string,
  replacement: TagReference,
  options: RenameTagOptions = {},
): { content: string; occurrenceCount: number } {
  const { edits, occurrenceCount } = planTagEdits(
    content,
    sourceKey,
    replacement,
    options,
  );

  let updatedContent = content;
  [...edits]
    .sort((left, right) => right.start - left.start)
    .forEach((edit) => {
      updatedContent =
        updatedContent.slice(0, edit.start) +
        edit.text +
        updatedContent.slice(edit.end);
    });

  return { content: updatedContent, occurrenceCount };
}

/**
 * Plans the edits that turn every parser-recognized occurrence of one tag
 * into another.
 *
 * Where the new tag already sits in the same run of tags on a line, or in the
 * same front-matter list, the old occurrence is removed instead, so a merge
 * never leaves `#atlas #atlas` behind. A tag inside a sentence is always
 * replaced, because removing it would change the sentence.
 */
export function planTagEdits(
  content: string,
  sourceKey: string,
  replacement: TagReference,
  options: RenameTagOptions = {},
): { edits: TagEdit[]; occurrenceCount: number } {
  const spans = extractTagSpans(
    content,
    true,
    options.entityNamespaceAliases,
    options.personMarker,
  );
  const sourceSpans = spans
    .filter((span) => span.key === sourceKey)
    .sort(
      (left, right) =>
        left.lineNumber - right.lineNumber ||
        left.startColumn - right.startColumn,
    );
  if (sourceSpans.length === 0) {
    return { edits: [], occurrenceCount: 0 };
  }

  const lines = content.split(/\r?\n/);
  const lineStarts = getLineStarts(content);
  // A duplicate of the new tag counts only when it sits in the same run of
  // tags or the same front-matter list, so a removal never reaches across
  // lines or into another field.
  const containerOf = (span: HeadingTagSpan): string => {
    const field = getFrontmatterField(content, span.lineNumber);
    return field ? `field:${field}` : `line:${span.lineNumber}`;
  };
  // Only a copy of the new tag that was already written counts, so a plain
  // rename still replaces every occurrence and keeps its source's shape.
  const holdsReplacement = new Set(
    spans.filter((span) => span.key === replacement.key).map(containerOf),
  );
  const removed = new Set<HeadingTagSpan>();

  const edits = sourceSpans.map((span): TagEdit => {
    const lineStart = lineStarts[span.lineNumber - 1];
    if (lineStart === undefined) {
      throw new Error(`Invalid tag line ${span.lineNumber}.`);
    }
    const removal = holdsReplacement.has(containerOf(span))
      ? getRemovalRange({
          line: lines[span.lineNumber - 1] ?? '',
          lineStart,
          nextLineStart: lineStarts[span.lineNumber],
          span,
          spans,
          removed,
          inFrontmatter: getFrontmatterField(content, span.lineNumber) !== undefined,
        })
      : undefined;
    if (removal) {
      removed.add(span);
      return { ...removal, text: '' };
    }
    return {
      start: lineStart + span.startColumn,
      end: lineStart + span.endColumn,
      text: getReplacementText(content, span, replacement, options),
    };
  });

  return {
    edits: joinTouchingEdits(edits),
    occurrenceCount: sourceSpans.length,
  };
}

/** Where one occurrence of the old tag sits, for deciding whether it can go. */
interface RemovalContext {
  /** The whole line the occurrence is on. */
  line: string;
  /** The offset in the note where that line starts. */
  lineStart: number;
  /** The offset where the next line starts, or undefined on the last line. */
  nextLineStart: number | undefined;
  span: HeadingTagSpan;
  /** Every tag span in the note, the old tag's and the others'. */
  spans: readonly HeadingTagSpan[];
  /** The occurrences already planned for removal. */
  removed: ReadonlySet<HeadingTagSpan>;
  inFrontmatter: boolean;
}

/**
 * The range to delete when an occurrence repeats the tag it becomes, or
 * undefined when deleting it would damage the text around it.
 */
function getRemovalRange(
  context: RemovalContext,
): Pick<TagEdit, 'start' | 'end'> | undefined {
  return context.inFrontmatter
    ? getFrontmatterRemovalRange(context)
    : getInlineRemovalRange(context);
}

/**
 * A front-matter list item to delete: a block item with its whole line, an
 * inline one with its quotes and one comma, or undefined when there is no
 * comma to take with it.
 */
function getFrontmatterRemovalRange({
  line,
  lineStart,
  nextLineStart,
  span,
}: RemovalContext): Pick<TagEdit, 'start' | 'end'> | undefined {
  if (/^\s*-\s/.test(line)) {
    return { start: lineStart, end: nextLineStart ?? lineStart + line.length };
  }
  let start = span.startColumn;
  let end = span.endColumn;
  const quote = line[start - 1];
  if ((quote === '"' || quote === "'") && line[end] === quote) {
    start -= 1;
    end += 1;
  }
  const commaBefore = line.slice(0, start).match(/,\s*$/);
  if (commaBefore) {
    return { start: lineStart + start - commaBefore[0].length, end: lineStart + end };
  }
  const commaAfter = line.slice(end).match(/^\s*,\s*/);
  return commaAfter
    ? { start: lineStart + start, end: lineStart + end + commaAfter[0].length }
    : undefined;
}

/**
 * An inline tag to delete, which goes only from a run of tags, with the
 * space on one side, or undefined when it stands among words.
 */
function getInlineRemovalRange({
  line,
  lineStart,
  span,
  spans,
  removed,
}: RemovalContext): Pick<TagEdit, 'start' | 'end'> | undefined {
  const lineSpans = spans.filter(
    (other) => other.lineNumber === span.lineNumber && other !== span,
  );
  const previous = lineSpans
    .filter((other) => other.endColumn <= span.startColumn)
    .sort((left, right) => right.endColumn - left.endColumn)[0];
  const next = lineSpans
    .filter((other) => other.startColumn >= span.endColumn)
    .sort((left, right) => left.startColumn - right.startColumn)[0];
  const joinsPrevious =
    previous !== undefined &&
    /^[ \t]+$/.test(line.slice(previous.endColumn, span.startColumn));
  const joinsNext =
    next !== undefined &&
    /^[ \t]+$/.test(line.slice(span.endColumn, next.startColumn));
  // Prefer the space before, unless that tag is itself being removed.
  if (joinsPrevious && !removed.has(previous)) {
    return {
      start: lineStart + previous.endColumn,
      end: lineStart + span.endColumn,
    };
  }
  if (joinsNext) {
    return {
      start: lineStart + span.startColumn,
      end: lineStart + next.startColumn,
    };
  }
  return joinsPrevious
    ? { start: lineStart + previous.endColumn, end: lineStart + span.endColumn }
    : undefined;
}

/** Joins edits that touch or overlap, which VS Code would otherwise reject. */
function joinTouchingEdits(edits: TagEdit[]): TagEdit[] {
  return [...edits]
    .sort((left, right) => left.start - right.start)
    .reduce<TagEdit[]>((joined, edit) => {
      const last = joined[joined.length - 1];
      if (last && edit.start <= last.end) {
        joined[joined.length - 1] = {
          start: last.start,
          end: Math.max(last.end, edit.end),
          text: last.text + edit.text,
        };
        return joined;
      }
      joined.push(edit);
      return joined;
    }, []);
}

/**
 * What an occurrence is rewritten as: the new label where the old one was
 * written with its marker, and the form its front-matter field writes
 * otherwise.
 */
function getReplacementText(
  content: string,
  span: HeadingTagSpan,
  replacement: TagReference,
  options: RenameTagOptions,
): string {
  const line = content.split(/\r?\n/)[span.lineNumber - 1] ?? '';
  const sourceText = line.slice(span.startColumn, span.endColumn);
  const activePersonMarker = getPersonMarker(options.personMarker);
  if (
    sourceText.startsWith('#') ||
    sourceText.startsWith('@') ||
    sourceText.startsWith(activePersonMarker)
  ) {
    return replacement.label;
  }

  const field = getFrontmatterField(content, span.lineNumber);
  if (!field) {
    return replacement.label;
  }

  return getFrontmatterReplacement(field, replacement, options);
}

/**
 * The new tag as a front-matter field writes it: without `#` in `tags`, as
 * a bare name in a field for its own kind, such as `people: dana`, and whole
 * anywhere else.
 */
function getFrontmatterReplacement(
  field: string,
  replacement: TagReference,
  options: RenameTagOptions,
): string {
  const normalizedField = field.toLowerCase();
  if (
    normalizedField === 'tag' ||
    normalizedField === 'tags' ||
    normalizedField === 'describes'
  ) {
    return replacement.key.startsWith('#')
      ? replacement.label.slice(1)
      : replacement.label;
  }

  const expectedKind = FRONTMATTER_KINDS.get(normalizedField);
  if (
    expectedKind === 'person' &&
    getEntityKind(replacement, options.entityNamespaceAliases) === 'person'
  ) {
    return replacement.label.slice(1);
  }
  if (
    expectedKind &&
    getEntityKind(replacement, options.entityNamespaceAliases) === expectedKind
  ) {
    return getTagName(replacement.label);
  }

  return replacement.label;
}

/**
 * The kind of entity each front-matter field names. A map rather than an
 * object, so a field such as `constructor` names no kind.
 */
const FRONTMATTER_KINDS: ReadonlyMap<string, string> = new Map([
  ['person', 'person'],
  ['people', 'person'],
  ['project', 'project'],
  ['projects', 'project'],
  ['topic', 'topic'],
  ['topics', 'topic'],
  ['organization', 'organization'],
  ['organizations', 'organization'],
  ['meeting', 'meeting'],
  ['meetings', 'meeting'],
]);

/** A tag's name without its marker or namespace: `#project/atlas` is `atlas`. */
function getTagName(label: string): string {
  const withoutMarker = label.slice(1);
  const separator = withoutMarker.indexOf('/');
  return separator >= 0
    ? withoutMarker.slice(separator + 1)
    : withoutMarker;
}

/**
 * The front-matter field a line belongs to, lowercased, or undefined when
 * the line is outside the front matter or before any field.
 */
function getFrontmatterField(
  content: string,
  lineNumber: number,
): string | undefined {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }

  let currentField: string | undefined;
  for (let lineIndex = 1; lineIndex < lineNumber; lineIndex += 1) {
    if (lines[lineIndex]?.trim() === '---') {
      return undefined;
    }
    const property = lines[lineIndex]?.match(
      /^\s*([A-Za-z][A-Za-z0-9_-]*):/,
    );
    if (property) {
      currentField = property[1].toLowerCase();
    }
  }
  return currentField;
}

/** The offset each line starts at, the first line's being 0. */
function getLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}
