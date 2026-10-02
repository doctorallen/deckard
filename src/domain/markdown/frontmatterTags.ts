import { findFrontmatterEnd, splitFrontmatterValues, unquote } from './frontmatter';

/**
 * Adding a tag to a note's front matter, and taking tags out of it, without
 * touching anything else the front matter says.
 *
 * Park Note writes `tags: [parked]` and Unpark Note takes it back out, so
 * these read the shapes people write: `tags: [a, b]`, `tags: a`, a YAML
 * block list under `tags:`, `tag:` as the field's name, quoted values, and
 * values written with their `#`. A note may write both `tags:` and `tag:`,
 * and the parser reads both, so these do too. Line endings are kept as the
 * note has them.
 *
 * An empty value, such as `tags: ''` or a block list's `- ''`, names no tag,
 * as the parser reads it: it is never read as a tag, and a rewrite of the
 * field drops it rather than leave it behind.
 */

/**
 * The line the front matter closes on, when the note opens with one. Only
 * `---` closes it here, trimmed, as the parser reads it.
 */
export function getFrontmatterBounds(lines: readonly string[]): { end: number } | undefined {
  const end = findFrontmatterEnd(lines);
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

/** The tags field's line: its name, `tag` or `tags` in any case, and what follows the colon. */
const TAGS_FIELD = /^(tags?)[ \t]*:[ \t]*(.*?)[ \t]*$/i;
/**
 * One item of a YAML block list: its indentation and its value. YAML lets a
 * list under a field sit at the field's own column, and the parser reads
 * `- parked` there, so no indentation is needed.
 */
const LIST_ITEM = /^([ \t]*)-[ \t]+(.*?)[ \t]*$/;

/** Whether a block list's item is empty once unquoted, and so names no tag. */
function isEmptyItem(item: { value: string }): boolean {
  return item.value.trim() === '';
}

/** The tags field as written. */
interface TagsField {
  /** The field's line. */
  line: number;
  /** The field's name as written, `tags` or `tag` in its own case. */
  name: string;
  /** What follows the colon. */
  inline: string;
  /** The block list's lines under it, with their values. */
  items: { line: number; value: string; indent: string }[];
}

/**
 * What the front matter says about tags: a field Deckard cannot safely
 * rewrite, or the fields the parser reads tags from, which may be none.
 */
type TagsFieldsReading = { kind: 'unreadable' } | { kind: 'fields'; fields: TagsField[] };

/**
 * Reads the tags fields between the front matter's fences, `end` being the
 * closing one, as the parser reads them: `tags` and `tag` are two fields,
 * both read, and a field written twice is read where it is written last,
 * in any case. They come in the order the note writes them. Unreadable
 * when either one Deckard would read is a shape it cannot rewrite.
 */
function findTagsFields(lines: readonly string[], end: number): TagsFieldsReading {
  const read = new Map<string, TagsField | 'unreadable'>();
  for (let line = 1; line < end; line += 1) {
    const match = lines[line].match(TAGS_FIELD);
    if (match) {
      read.set(match[1].toLowerCase(), readTagsField(lines, end, line, match));
    }
  }
  const fields: TagsField[] = [];
  for (const field of read.values()) {
    if (field === 'unreadable') {
      return { kind: 'unreadable' };
    }
    fields.push(field);
  }
  return { kind: 'fields', fields: fields.sort((left, right) => left.line - right.line) };
}

/** The tags field on `line`, whose TAGS_FIELD match is `match`, with the block list under it. */
function readTagsField(
  lines: readonly string[],
  end: number,
  line: number,
  match: RegExpMatchArray,
): TagsField | 'unreadable' {
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
  return { line, name: match[1], inline, items };
}

/** The tags a field names, as written: its block list's items, or its line's values. */
function fieldValues(field: TagsField): string[] {
  return field.items.length > 0
    ? field.items.filter((item) => !isEmptyItem(item)).map((item) => item.value)
    : splitValues(field.inline);
}

/** The note's line ending, CRLF when any line has one, so a rewrite keeps it. */
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
  const reading = findTagsFields(lines, bounds.end);
  if (reading.kind === 'unreadable') {
    return undefined;
  }
  if (reading.fields.some((each) => fieldValues(each).some((written) => sameTag(written, value)))) {
    return undefined;
  }
  // Into the first field that names a tag already, so `tags: ''` above a
  // `tag:` list is not the one written; the first field when none does.
  const field = reading.fields.find((each) => fieldValues(each).length > 0) ?? reading.fields[0];
  if (!field) {
    lines.splice(bounds.end, 0, `tags: [${value}]`);
    return lines.join(eol);
  }
  if (field.items.length > 0) {
    const last = field.items[field.items.length - 1];
    lines.splice(last.line + 1, 0, `${last.indent}- ${value}`);
    // The empty items all sit above the new one, so their lines are unmoved.
    const empty = new Set(field.items.filter((item) => isEmptyItem(item)).map((item) => item.line));
    return lines.filter((_, index) => !empty.has(index)).join(eol);
  }
  const values = splitValues(field.inline);
  lines[field.line] = `${field.name}: [${[...values, value].join(', ')}]`;
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
  const reading = findTagsFields(lines, bounds.end);
  if (reading.kind === 'unreadable') {
    return undefined;
  }
  const removes = (written: string) => tags.some((tag) => sameTag(written, tag));
  // A field rewritten on its own line keeps its place, so each field's
  // lines are where they were when the next is read.
  const drops = reading.fields
    .map((field) => (field.items.length > 0 ? dropFromBlockList(field, removes) : dropFromInline(lines, field, removes)))
    .filter((each): each is Set<number> => each !== undefined);
  if (drops.length === 0) {
    return undefined;
  }
  const drop = new Set(drops.flatMap((each) => [...each]));
  const next = lines.filter((_, index) => !drop.has(index));
  const end = bounds.end - drop.size;
  // Nothing left between the fences: the front matter goes too.
  if (next.slice(1, end).every((line) => line.trim() === '')) {
    return next.slice(end + 1).join(eol);
  }
  return next.join(eol);
}

/**
 * The lines to drop to take tags out of a block list: each item that goes,
 * with the empty items, which name no tag, and the field's own line when no
 * tag is left in it. Undefined when no tag goes.
 */
function dropFromBlockList(field: TagsField, removes: (written: string) => boolean): Set<number> | undefined {
  const gone = field.items.filter((item) => !isEmptyItem(item) && removes(item.value));
  if (gone.length === 0) {
    return undefined;
  }
  const drop = new Set(
    field.items.filter((item) => isEmptyItem(item) || gone.includes(item)).map((item) => item.line),
  );
  if (drop.size === field.items.length) {
    drop.add(field.line);
  }
  return drop;
}

/**
 * Takes tags out of a field written on one line: rewrites the line in
 * `lines` with the values kept, or, when none is kept, says to drop the
 * line. Undefined when no value goes.
 */
function dropFromInline(
  lines: string[],
  field: TagsField,
  removes: (written: string) => boolean,
): Set<number> | undefined {
  const values = splitValues(field.inline);
  const kept = values.filter((written) => !removes(written));
  if (kept.length === values.length) {
    return undefined;
  }
  if (kept.length === 0) {
    return new Set([field.line]);
  }
  lines[field.line] = `${field.name}: [${kept.join(', ')}]`;
  return new Set();
}

/** The values of the front matter's tags fields, as written, `tags` and `tag` in the note's order. */
export function readFrontmatterTagValues(content: string): string[] | undefined {
  const lines = content.split(/\r?\n/);
  const bounds = getFrontmatterBounds(lines);
  if (!bounds) {
    return [];
  }
  const reading = findTagsFields(lines, bounds.end);
  return reading.kind === 'unreadable' ? undefined : reading.fields.flatMap(fieldValues);
}
