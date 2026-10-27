import { extractTags, findTagSpans, type EntityNamespaceAliases, type TagMatch } from './parser';
import { findTaskMetadataSpans } from './taskFields';

/**
 * Taking a tag off one line, and writing another in its place, as a bulk
 * edit does to a search's results. Only what the line itself writes
 * changes: a tag a result inherits from a heading above it or from its
 * note's front matter is not on its line, and stays where it is written.
 * The rest of the line is kept as written.
 */

/** How a line's tags are read: the namespace aliases and person marker of the workspace. */
export interface TagLineOptions {
  entityNamespaceAliases?: EntityNamespaceAliases;
  personMarker?: string;
}

/**
 * The tag `tag` names, as the index keys it, or undefined when `tag` is not
 * exactly one tag: `#Project/Atlas` and `#project/atlas` are one tag.
 */
export function readTagKey(tag: string, options: TagLineOptions = {}): string | undefined {
  const written = extractTags(tag.trim(), options.entityNamespaceAliases, options.personMarker);
  return written.length === 1 && written[0].label === tag.trim() ? written[0].key : undefined;
}

/**
 * The tags written on a line, each with where it is, that a tag edit may
 * change: a person written in a task's 👤 or `[assignee:: …]` field is that
 * field, not a tag, and is left out.
 */
export function findLineTags(line: string, options: TagLineOptions = {}): TagMatch[] {
  const fields = findTaskMetadataSpans(line).filter((span) => span.field === 'assignee');
  return findTagSpans(line, options.entityNamespaceAliases, options.personMarker).filter(
    (tag) => !fields.some((field) => tag.start >= field.start && tag.end <= field.end),
  );
}

/**
 * The line with every writing of a tag taken out, each with the spaces or
 * tabs before it, so no gap is left; the line as it was when it does not
 * write the tag, or `tag` is not one tag.
 */
export function removeTagFromLine(line: string, tag: string, options: TagLineOptions = {}): string {
  const key = readTagKey(tag, options);
  if (key === undefined) {
    return line;
  }
  return cutTags(line, findLineTags(line, options).filter((found) => found.key === key));
}

/**
 * The line with a tag written in place of another: the first writing of
 * `from` becomes `to`, and any other writing of it is taken out. A line
 * that already writes `to` only loses `from`; one that does not write
 * `from` is left as it was, as it is when either is not one tag.
 */
export function replaceTagOnLine(line: string, from: string, to: string, options: TagLineOptions = {}): string {
  const fromKey = readTagKey(from, options);
  const toKey = readTagKey(to, options);
  if (fromKey === undefined || toKey === undefined || fromKey === toKey) {
    return line;
  }
  const tags = findLineTags(line, options);
  const old = tags.filter((found) => found.key === fromKey);
  if (old.length === 0) {
    return line;
  }
  if (tags.some((found) => found.key === toKey)) {
    return cutTags(line, old);
  }
  const [first, ...rest] = old;
  const cut = cutTags(line, rest);
  return `${cut.slice(0, first.start)}${to.trim()}${cut.slice(first.end)}`;
}

/**
 * The line with each tag cut out, from the last back, with the spaces or
 * tabs before it; a tag at the very start of the line takes those after
 * it instead, so the words that follow do not start with a gap.
 */
function cutTags(line: string, tags: readonly TagMatch[]): string {
  return [...tags]
    .sort((left, right) => right.start - left.start)
    .reduce((text, tag) => {
      let start = tag.start;
      while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
        start -= 1;
      }
      let end = tag.end;
      if (start === 0) {
        while (text[end] === ' ' || text[end] === '\t') {
          end += 1;
        }
      }
      return text.slice(0, start) + text.slice(end);
    }, line);
}
