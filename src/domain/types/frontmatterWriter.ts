/**
 * Writing one key of a note's front matter (docs/implementation/30-databases.md
 * § Writes): what a field edit on the Note page writes.
 *
 * Only the key's own lines change. Every other key, its order, its quoting,
 * and every comment stay byte for byte, and so do the note's line endings.
 * The key keeps its place and its spelling; a value it holds in quotes keeps
 * them when the new value needs none. A key the note does not write yet is
 * added after its last key, and a note with no front matter gets one.
 *
 * Values are written in the form Deckard writes by kind: a tag or a link in
 * double quotes (`"@dana"`, `"#team/rates"`, `"[[RFQ outage]]"`), since YAML
 * reads a bare `#` as a comment and cannot start a plain value with `@` or
 * `[`; several as a flow list (`["#area/a", "#area/b"]`), or, when the key
 * already holds a block list, as that list, its kept items untouched.
 *
 * A value the writer cannot rewrite safely, such as a `|` or `>` block, a
 * nested map, or a list or quoted value across lines, is refused with the
 * line to open the editor at.
 */
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { formatYamlValue } from '../markdown/frontmatterTags';

/** One value to write, as text: `@dana`, `#team/rates`, `[[RFQ outage]]`, `Head of Rates`. */
export interface FrontmatterWriteValue {
  text: string;
  /** Written as it is, never quoted: a number, or a checkbox's `true` or `false`. */
  bare?: boolean;
}

/** What to write for a key: its values, none to take the key out. */
export interface FrontmatterFieldWrite {
  values: readonly FrontmatterWriteValue[];
  /** Whether the field holds several values, so that even one is written as a list. */
  list?: boolean;
}

/** Why a key cannot be written safely, so the editor is opened at it instead. */
export type FrontmatterRefusal = 'block-scalar' | 'nested' | 'unreadable' | 'bad-key';

/**
 * What writing a key comes to: the note's new text and the lines that
 * changed, which an editor applies as one replacement; nothing to do; or
 * why it was left alone and the one-based line to open the editor at.
 */
export type FrontmatterFieldEdit =
  | {
      kind: 'edit';
      content: string;
      /** The zero-based first line replaced, and how many of the old lines were replaced. */
      start: number;
      deleted: number;
      /** The lines written in their place, without line endings. */
      lines: string[];
      /** The one-based line the key is written on afterward, or undefined when it was taken out. */
      line?: number;
    }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: FrontmatterRefusal; line: number };

/** A front-matter key as the parser reads one: a letter, then letters, digits, `_`, and `-`. */
const KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** A key's line: the key, its colon with any spaces before it, and what follows. */
const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*)([ \t]*:)(.*)$/;
/** One item of a block list: its indentation, its dash and space, and its value. */
const LIST_ITEM = /^([ \t]*)-(?:[ \t]+(.*?))?[ \t]*$/;
/** A line that is only a comment, indented or not. */
const COMMENT_LINE = /^[ \t]*#/;
/** A YAML block scalar's opening: `|` or `>` with its chomping and indent marks, and maybe a comment. */
const BLOCK_SCALAR = /^[|>][+-]?\d*[+-]?(?:[ \t]+#.*)?$/;

/** One key as the front matter writes it, with the lines under it. */
interface WrittenKey {
  /** The zero-based line of the key. */
  line: number;
  /** The key and its colon, as written: `lead:`, `Lead :`. */
  head: string;
  /** The spaces after the colon, the value, and a comment after it, as written. */
  gap: string;
  value: string;
  comment: string;
  /** The zero-based lines under it that belong to it: its list's items, indented lines, and comments among them. */
  under: number[];
}

/**
 * The note with one key of its front matter set to `write`'s values, or
 * taken out when there are none; see the module comment for what is kept.
 * `key` is matched in any case, as the parser reads it; a key written twice
 * is written where the parser reads it, the last time.
 */
export function setFrontmatterField(content: string, key: string, write: FrontmatterFieldWrite): FrontmatterFieldEdit {
  if (!KEY.test(key)) {
    return { kind: 'refused', reason: 'bad-key', line: 1 };
  }
  const note: Note = { lines: content.split(/\r?\n/), eol: content.includes('\r\n') ? '\r\n' : '\n' };
  const values = write.values.filter((value) => value.text.trim() !== '');
  const list = write.list === true || values.length > 1;
  const end = findFrontmatterEnd(note.lines);
  const keys = end === undefined ? [] : readKeys(note.lines, end);
  const written = [...keys].reverse().find((each) => each.head.replace(/[ \t]*:$/, '').toLowerCase() === key.toLowerCase());
  if (!written) {
    if (values.length === 0) {
      return { kind: 'unchanged' };
    }
    const line = writeKeyLine({ head: `${key}:`, gap: ' ', comment: '' }, values, list);
    if (end === undefined) {
      return replaceLines(note, { start: 0, count: 0, next: ['---', line, '---'], line: 2 });
    }
    const last = keys[keys.length - 1];
    const at = last ? Math.max(last.line, ...last.under) + 1 : 1;
    return replaceLines(note, { start: at, count: 0, next: [line], line: at + 1 });
  }
  return rewriteKey(note, written, values, list);
}

/** A note's lines, and the line ending it writes them with. */
interface Note {
  lines: string[];
  eol: string;
}

/** A key the note writes, rewritten to `values`, or taken out when there are none; or why it cannot be. */
function rewriteKey(note: Note, written: WrittenKey, values: readonly FrontmatterWriteValue[], list: boolean): FrontmatterFieldEdit {
  const refusal = checkWritable(note.lines, written);
  if (refusal) {
    return refusal;
  }
  const start = written.line;
  const count = Math.max(start, ...written.under) - start + 1;
  if (values.length === 0) {
    return replaceLines(note, { start, count, next: [] });
  }
  const blockList = written.under.some((line) => LIST_ITEM.test(note.lines[line]));
  if (blockList && list) {
    return replaceLines(note, { start, count, next: rewriteBlockList(note.lines, written, values), line: start + 1 });
  }
  const quote = list ? undefined : /^(['"])/.exec(written.value)?.[1];
  const next = writeKeyLine({ head: written.head, gap: written.gap || ' ', comment: written.comment, quote }, values, list);
  return replaceLines(note, { start, count, next: [next], line: start + 1 });
}

/**
 * Every key between the fences, `end` the closing one, in the order
 * written, each with the lines under it: list items at its own column or
 * deeper, indented lines, and comments among them. Blank lines and
 * comments after the last of those are left to no key.
 */
function readKeys(lines: readonly string[], end: number): WrittenKey[] {
  const keys: WrittenKey[] = [];
  let current: WrittenKey | undefined;
  let pending: number[] = [];
  for (let line = 1; line < end; line += 1) {
    const text = lines[line];
    const match = KEY_LINE.exec(text);
    if (match) {
      const { gap, value, comment } = splitValue(match[3]);
      current = { line, head: `${match[1]}${match[2]}`, gap, value, comment, under: [] };
      keys.push(current);
      pending = [];
      continue;
    }
    if (!current) {
      continue;
    }
    if (text.trim() === '' || COMMENT_LINE.test(text)) {
      pending.push(line);
      continue;
    }
    if (LIST_ITEM.test(text) || /^[ \t]+\S/.test(text)) {
      current.under.push(...pending, line);
      pending = [];
      continue;
    }
    // Anything else at the left edge ends the key.
    current = undefined;
    pending = [];
  }
  return keys;
}

/**
 * What follows a key's colon, split into the spaces before the value, the
 * value, and a comment after it with the spaces before that: a `#` after a
 * space outside quotes, or after a flow list's closing bracket. A value
 * that opens with `#` is a tag, as the parser reads it, not a comment.
 */
function splitValue(rest: string): { gap: string; value: string; comment: string } {
  const gap = /^[ \t]*/.exec(rest)?.[0] ?? '';
  const after = rest.slice(gap.length);
  // `# ask` after an empty value is a comment; `#team` is a tag.
  if (/^#(?:[ \t]|$)/.test(after)) {
    return { gap: '', value: '', comment: rest };
  }
  const end = valueEnd(after);
  const value = after.slice(0, end).replace(/[ \t]+$/, '');
  return { gap, value, comment: after.slice(value.length) };
}

/** Where a value written after a colon ends: before a comment, or at the end of the line. */
function valueEnd(text: string): number {
  if (text.startsWith('[') || text.startsWith('{')) {
    const close = closingBracket(text);
    if (close < 0) {
      return text.length;
    }
    const comment = /[ \t]#/.exec(text.slice(close + 1));
    return comment ? close + 1 + comment.index : text.length;
  }
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const close = closingQuote(text, quote);
    if (close < 0) {
      return text.length;
    }
    const comment = /[ \t]#/.exec(text.slice(close + 1));
    return comment ? close + 1 + comment.index : text.length;
  }
  const comment = /[ \t]#/.exec(text);
  return comment ? comment.index : text.length;
}

/** The index of the quote that closes one opening `text`, or -1: `''` inside single quotes, `\"` inside double. */
function closingQuote(text: string, quote: string): number {
  for (let at = 1; at < text.length; at += 1) {
    if (quote === '"' && text[at] === '\\') {
      at += 1;
    } else if (text[at] === quote) {
      if (quote === "'" && text[at + 1] === "'") {
        at += 1;
      } else {
        return at;
      }
    }
  }
  return -1;
}

/** The index of the bracket or brace that closes the one opening `text`, quotes inside it skipped, or -1. */
function closingBracket(text: string): number {
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if ((character === '"' || character === "'") && /^[[{,\s]?$/.test(text[at - 1] ?? '')) {
      const close = closingQuote(text.slice(at), character);
      if (close < 0) {
        return -1;
      }
      at += close;
    } else if (character === '[' || character === '{') {
      depth += 1;
    } else if (character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) {
        return at;
      }
    }
  }
  return -1;
}

/**
 * Why a written key cannot be rewritten safely, with the line to open the
 * editor at, or undefined when it can: a `|` or `>` block; a nested map,
 * written under the key or as `{…}`; a list or quoted value that runs
 * across lines; a value on the key's line with a list under it; or an
 * anchor, alias, or YAML tag, which a rewrite would lose.
 */
function checkWritable(lines: readonly string[], key: WrittenKey): FrontmatterFieldEdit | undefined {
  const at = key.line + 1;
  const value = key.value;
  const refuse = (reason: FrontmatterRefusal, line = at): FrontmatterFieldEdit => ({ kind: 'refused', reason, line });
  if (BLOCK_SCALAR.test(value)) {
    return refuse('block-scalar');
  }
  if (value.startsWith('{')) {
    return refuse('nested');
  }
  if (/^[&*!]/.test(value)) {
    return refuse('unreadable');
  }
  if ((value.startsWith('[') && closingBracket(value) !== value.length - 1) || (/^['"]/.test(value) && closingQuote(value, value[0]) !== value.length - 1)) {
    return refuse('unreadable');
  }
  const content = key.under.filter((line) => lines[line].trim() !== '' && !COMMENT_LINE.test(lines[line]));
  const nested = content.find((line) => !LIST_ITEM.test(lines[line]) || /^[ \t]*-[ \t]+[A-Za-z][\w-]*[ \t]*:(?:[ \t]|$)/.test(lines[line]));
  if (nested !== undefined) {
    return refuse(value === '' ? 'nested' : 'unreadable', nested + 1);
  }
  if (value !== '' && content.length > 0) {
    return refuse('unreadable', content[0] + 1);
  }
  return undefined;
}

/**
 * A block list rewritten to `values`: each item whose value stays is kept
 * as written, comment and all, in its place; the others go; new values
 * follow the last item at its indentation; comments among the items stay.
 */
function rewriteBlockList(lines: readonly string[], key: WrittenKey, values: readonly FrontmatterWriteValue[]): string[] {
  const left = values.map((value) => value.text);
  const kept: string[] = [lines[key.line]];
  let indent = '';
  key.under.forEach((line) => {
    const item = LIST_ITEM.exec(lines[line]);
    if (!item) {
      kept.push(lines[line]);
      return;
    }
    indent = item[1];
    const at = left.indexOf(readItemValue(item[2] ?? ''));
    if (at < 0) {
      return;
    }
    left.splice(at, 1);
    kept.push(lines[line]);
  });
  const added = values.filter((value) => left.includes(value.text)).map((value) => `${indent}- ${formatValue(value, 'line')}`);
  // Comments trailing the list stay after it, and the new items go after the last item.
  const lastItem = kept.reduce((last, text, at) => (LIST_ITEM.test(text) && at > 0 ? at : last), 0);
  return [...kept.slice(0, lastItem + 1), ...added, ...kept.slice(lastItem + 1)];
}

/** A block list item's value as read: its comment dropped, its quotes taken off. */
function readItemValue(written: string): string {
  const { value } = splitValue(written);
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return value;
}

/** How a key's line is written around its value: its head and the gap after it, and the comment after the value. */
interface KeyLineShape {
  head: string;
  gap: string;
  comment: string;
  /** The quote a single value had, kept when the new one needs none. */
  quote?: string;
}

/** A key's line: its head as written, the gap after it, and its value, a flow list when `list`, then the comment it had. */
function writeKeyLine(shape: KeyLineShape, values: readonly FrontmatterWriteValue[], list: boolean): string {
  const value = list
    ? `[${values.map((each) => formatValue(each, 'list')).join(', ')}]`
    : formatValue(values[0], 'line', shape.quote);
  return `${shape.head}${shape.gap}${value}${shape.comment}`;
}

/**
 * A value as Deckard writes it: as it is when bare; a tag or link in double
 * quotes; anything else quoted only where YAML would misread it, in the
 * quote the key had when it had one and the text allows it.
 */
function formatValue(value: FrontmatterWriteValue, place: 'list' | 'line', quote?: string): string {
  const text = value.text.trim();
  if (value.bare) {
    return text;
  }
  const formatted = formatYamlValue(text, place);
  if (formatted !== text || !quote) {
    return formatted;
  }
  if (quote === "'") {
    return `'${text.replace(/'/g, "''")}'`;
  }
  return /["\\]/.test(text) ? formatted : `"${text}"`;
}

/** Lines to put in place of others: `count` lines from `start`, and the one-based line the key ends on. */
interface LineChange {
  start: number;
  count: number;
  next: string[];
  line?: number;
}

/** The edit that makes a change, or nothing when the lines are the same. */
function replaceLines(note: Note, change: LineChange): FrontmatterFieldEdit {
  const { start, count, next, line } = change;
  const old = note.lines.slice(start, start + count);
  if (old.length === next.length && old.every((text, at) => text === next[at])) {
    return { kind: 'unchanged' };
  }
  const result = [...note.lines.slice(0, start), ...next, ...note.lines.slice(start + count)];
  return { kind: 'edit', content: result.join(note.eol), start, deleted: count, lines: next, ...(line === undefined ? {} : { line }) };
}
