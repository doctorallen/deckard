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
 *
 * A value is written in quotes when YAML would read it as something else
 * unquoted, such as `#atlas`, which YAML reads as a comment, and plain
 * otherwise. A tags line that ends in a comment is never rewritten, since
 * the rewrite would either lose the comment or read it as a tag.
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

/** Characters that make a value something other than text when it opens with one. */
const YAML_INDICATOR_START = /^[#@&*!|>'"%`[\]{},?]/;
/** Words YAML reads as a true, a false, or nothing rather than as text. */
const YAML_KEYWORD = /^(?:true|false|yes|no|on|off|null|~)$/i;
/** Characters that end a value inside a `[a, b]` list. */
const FLOW_INDICATOR = /[,[\]{}]/;

/**
 * A value as YAML reads it back as the same text: in double quotes when it
 * would be misread unquoted, and as written otherwise. Unquoted, YAML
 * misreads a value that opens with an indicator such as `#` or `@`, opens
 * with `- `, `? `, or `: `, holds `: ` or ` #`, ends in a colon, or is a
 * keyword such as `yes` or `null`; inside a `[a, b]` list, also one that
 * holds a comma, a bracket, or a brace. A value holding a double quote or a
 * backslash is written in single quotes, where neither is an escape.
 */
export function formatYamlValue(value: string, place: 'list' | 'line'): string {
  const misread =
    YAML_INDICATOR_START.test(value) ||
    /^[-?:](?:[ \t]|$)/.test(value) ||
    /:(?:[ \t]|$)|[ \t]#/.test(value) ||
    YAML_KEYWORD.test(value) ||
    value !== value.trim() ||
    (place === 'list' && FLOW_INDICATOR.test(value));
  if (!misread) {
    return value;
  }
  return /["\\]/.test(value) ? `'${value.replace(/'/g, "''")}'` : `"${value}"`;
}

/**
 * Whether a value written after a field's colon, or after a list item's
 * dash, ends in a YAML comment: a `#` after a space or a tab, outside
 * quotes, or anything after a `[a, b]` list's closing bracket that opens
 * with `#`. A value that opens with `#` is read as the tag it names, as the
 * parser reads it, not as a comment.
 */
export function endsInComment(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const close = trimmed.lastIndexOf(']');
    return close >= 0 && trimmed.slice(close + 1).trim().startsWith('#');
  }
  // A `#` inside a quoted value is text; only what follows the closing quote can be a comment.
  const quote = /^['"]/.exec(trimmed)?.[0];
  if (!quote) {
    return /[ \t]#/.test(trimmed);
  }
  const close = trimmed.indexOf(quote, 1);
  return close >= 0 && /[ \t]#/.test(trimmed.slice(close + 1));
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
 * Why a tags field cannot be rewritten: it ends in a YAML comment, which a
 * rewrite would lose or read as a tag, or it is a shape Deckard cannot
 * safely rewrite, such as a list across lines.
 */
export type TagsFieldProblem = 'comment' | 'unreadable';

/**
 * What the front matter says about tags: a field Deckard cannot safely
 * rewrite, and why, or the fields the parser reads tags from, which may be
 * none.
 */
type TagsFieldsReading = { kind: 'unreadable'; problem: TagsFieldProblem } | { kind: 'fields'; fields: TagsField[] };

/**
 * Reads the tags fields between the front matter's fences, `end` being the
 * closing one, as the parser reads them: `tags` and `tag` are two fields,
 * both read, and a field written twice is read where it is written last,
 * in any case. They come in the order the note writes them. Unreadable
 * when either one Deckard would read is a shape it cannot rewrite.
 */
function findTagsFields(lines: readonly string[], end: number): TagsFieldsReading {
  const read = new Map<string, TagsField | TagsFieldProblem>();
  for (let line = 1; line < end; line += 1) {
    const match = lines[line].match(TAGS_FIELD);
    if (match) {
      read.set(match[1].toLowerCase(), readTagsField(lines, end, line, match));
    }
  }
  const fields: TagsField[] = [];
  for (const field of read.values()) {
    if (typeof field === 'string') {
      return { kind: 'unreadable', problem: field };
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
): TagsField | TagsFieldProblem {
  const inline = match[2];
  const items: TagsField['items'] = [];
  let commented = endsInComment(inline);
  for (let next = line + 1; next < end; next += 1) {
    const item = lines[next].match(LIST_ITEM);
    if (!item) {
      break;
    }
    commented ||= endsInComment(item[2]);
    items.push({ line: next, value: unquote(item[2]), indent: item[1] });
  }
  if (commented) {
    return 'comment';
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
  // YAML reads `["a, b"]` as one value, and the parser as two, so neither
  // reading can be written back.
  if (inline.startsWith('[') && hasQuotedComma(inline)) {
    return 'unreadable';
  }
  return { line, name: match[1], inline, items };
}

/**
 * Whether a `[a, b]` list holds a comma inside a quoted value. Only a quote
 * that opens a value starts one, so the `'` in `it's` does not.
 */
function hasQuotedComma(list: string): boolean {
  let quote: string | undefined;
  let valueStart = true;
  for (const character of list) {
    if (quote) {
      if (character === ',') {
        return true;
      }
      quote = character === quote ? undefined : quote;
    } else if (valueStart && (character === '"' || character === "'")) {
      quote = character;
      valueStart = false;
    } else if (character === ',' || character === '[') {
      valueStart = true;
    } else if (!/\s/.test(character)) {
      valueStart = false;
    }
  }
  return false;
}

/** A field's values written back on its own line, each quoted only where YAML needs it. */
function writeInlineList(name: string, values: readonly string[]): string {
  return `${name}: [${values.map((value) => formatYamlValue(value, 'list')).join(', ')}]`;
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
    return `---${eol}${writeInlineList('tags', [value])}${eol}---${eol}${content}`;
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
    lines.splice(bounds.end, 0, writeInlineList('tags', [value]));
    return lines.join(eol);
  }
  if (field.items.length > 0) {
    const last = field.items[field.items.length - 1];
    lines.splice(last.line + 1, 0, `${last.indent}- ${formatYamlValue(value, 'line')}`);
    // The empty items all sit above the new one, so their lines are unmoved.
    const empty = new Set(field.items.filter((item) => isEmptyItem(item)).map((item) => item.line));
    return lines.filter((_, index) => !empty.has(index)).join(eol);
  }
  lines[field.line] = writeInlineList(field.name, [...splitValues(field.inline), value]);
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
  lines[field.line] = writeInlineList(field.name, kept);
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

/**
 * Why the front matter's tags cannot be rewritten, or undefined when they
 * can: what Park Note and Unpark Note say when they leave a note alone.
 */
export function findTagsFieldProblem(content: string): TagsFieldProblem | undefined {
  const lines = content.split(/\r?\n/);
  const bounds = getFrontmatterBounds(lines);
  if (!bounds) {
    return undefined;
  }
  const reading = findTagsFields(lines, bounds.end);
  return reading.kind === 'unreadable' ? reading.problem : undefined;
}
