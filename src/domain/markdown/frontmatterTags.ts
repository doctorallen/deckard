import { findFrontmatterEnd, splitFrontmatterValues, unquote } from './frontmatter';

export { unquote } from './frontmatter';

/**
 * Adding a tag to a note's front matter, and taking tags out of it, without
 * touching anything else the front matter says.
 *
 * Park Note writes `tags: [parked]` and Unpark Note takes it back out, so
 * these read the shapes people write: `tags: [a, b]`, `tags: a`, a YAML
 * block list under `tags:`, `tag:` as the field's name, quoted values, and
 * values written with their `#`. Line endings are kept as the note has them.
 */

/**
 * The line the front matter closes on, when the note opens with one. Only
 * `---` closes it here, trimmed, as the parser reads it.
 */
export function getFrontmatterBounds(lines: readonly string[]): { end: number } | undefined {
  const end = findFrontmatterEnd(lines, 'dashes');
  return end === undefined ? undefined : { end };
}

/**
 * The values of a front-matter field written on its own line; a lone value
 * that is empty once unquoted is dropped.
 */
export function splitValues(value: string): string[] {
  return splitFrontmatterValues(value);
}

/** A tag as front matter compares it: no `#`, no quotes, any case. */
function sameTag(written: string, tag: string): boolean {
  const bare = (value: string) => unquote(value.trim()).replace(/^#/, '').toLowerCase();
  return bare(written) === bare(tag);
}

const TAGS_FIELD = /^(tags?)[ \t]*:[ \t]*(.*?)[ \t]*$/i;
const LIST_ITEM = /^([ \t]+)-[ \t]+(.*?)[ \t]*$/;

interface TagsField {
  /** The field's line. */
  line: number;
  /** What follows the colon. */
  inline: string;
  /** The block list's lines under it, with their values. */
  items: { line: number; value: string; indent: string }[];
}

function findTagsField(lines: readonly string[], end: number): TagsField | undefined | 'unreadable' {
  for (let line = 1; line < end; line += 1) {
    const match = lines[line].match(TAGS_FIELD);
    if (!match) {
      continue;
    }
    const inline = match[2];
    const items: TagsField['items'] = [];
    for (let next = line + 1; next < end; next += 1) {
      const item = lines[next].match(LIST_ITEM);
      if (!item) {
        break;
      }
      items.push({ line: next, value: unquote(item[2]), indent: item[1] });
    }
    // A value on the field's line and a list under it is not YAML Deckard
    // can safely rewrite.
    if (inline && items.length > 0) {
      return 'unreadable';
    }
    // A flow list across lines, or any other value Deckard cannot read.
    if (inline.startsWith('[') && !inline.endsWith(']')) {
      return 'unreadable';
    }
    return { line, inline, items };
  }
  return undefined;
}

function lineEnding(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * The note with `tag` added to its front matter's tags, creating the field,
 * or the front matter, when there is none. Undefined when the tag is there
 * already or the front matter cannot be read safely.
 */
export function addFrontmatterTag(content: string, tag: string): string | undefined {
  const value = tag.replace(/^#/, '');
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const bounds = getFrontmatterBounds(lines);
  if (!bounds) {
    return `---${eol}tags: [${value}]${eol}---${eol}${content}`;
  }
  const field = findTagsField(lines, bounds.end);
  if (field === 'unreadable') {
    return undefined;
  }
  if (!field) {
    lines.splice(bounds.end, 0, `tags: [${value}]`);
    return lines.join(eol);
  }
  const name = lines[field.line].match(TAGS_FIELD)?.[1] ?? 'tags';
  if (field.items.length > 0) {
    if (field.items.some((item) => sameTag(item.value, value))) {
      return undefined;
    }
    const last = field.items[field.items.length - 1];
    lines.splice(last.line + 1, 0, `${last.indent}- ${value}`);
    return lines.join(eol);
  }
  const values = splitValues(field.inline);
  if (values.some((written) => sameTag(written, value))) {
    return undefined;
  }
  lines[field.line] = `${name}: [${[...values, value].join(', ')}]`;
  return lines.join(eol);
}

/**
 * The note with every one of `tags` taken out of its front matter's tags.
 * An emptied field goes, and so does a front matter left with nothing in it.
 * Undefined when none was there, or the front matter cannot be read safely.
 */
export function removeFrontmatterTags(
  content: string,
  tags: readonly string[],
): string | undefined {
  const eol = lineEnding(content);
  const lines = content.split(/\r?\n/);
  const bounds = getFrontmatterBounds(lines);
  if (!bounds) {
    return undefined;
  }
  const field = findTagsField(lines, bounds.end);
  if (!field || field === 'unreadable') {
    return undefined;
  }
  const removes = (written: string) => tags.some((tag) => sameTag(written, tag));
  const drop = new Set<number>();
  if (field.items.length > 0) {
    const gone = field.items.filter((item) => removes(item.value));
    if (gone.length === 0) {
      return undefined;
    }
    gone.forEach((item) => drop.add(item.line));
    if (gone.length === field.items.length) {
      drop.add(field.line);
    }
  } else {
    const values = splitValues(field.inline);
    const kept = values.filter((written) => !removes(written));
    if (kept.length === values.length) {
      return undefined;
    }
    if (kept.length === 0) {
      drop.add(field.line);
    } else {
      const name = lines[field.line].match(TAGS_FIELD)?.[1] ?? 'tags';
      lines[field.line] = `${name}: [${kept.join(', ')}]`;
    }
  }
  const next = lines.filter((_, index) => !drop.has(index));
  const end = bounds.end - drop.size;
  // Nothing left between the fences: the front matter goes too.
  if (next.slice(1, end).every((line) => line.trim() === '')) {
    return next.slice(end + 1).join(eol);
  }
  return next.join(eol);
}

/** The values of the front matter's tags field, as written. */
export function readFrontmatterTagValues(content: string): string[] | undefined {
  const lines = content.split(/\r?\n/);
  const bounds = getFrontmatterBounds(lines);
  if (!bounds) {
    return [];
  }
  const field = findTagsField(lines, bounds.end);
  if (field === 'unreadable') {
    return undefined;
  }
  if (!field) {
    return [];
  }
  return field.items.length > 0 ? field.items.map((item) => item.value) : splitValues(field.inline);
}
