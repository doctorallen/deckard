/**
 * Small text helpers that commands, views, and view models each used to
 * write for themselves. They hold no Deckard rules, only wording, so every
 * layer may import them; nothing here reaches `vscode`.
 */

/** The two ways a count's wording differs between the places that write one. */
export interface PluralizeOptions {
  /**
   * Writes the number with `en-US` digit grouping, as "1,204", for a count
   * that can run into the thousands, such as the first index's summary.
   */
  readonly locale?: boolean;
  /**
   * Returns '' for a count of zero, for a list that drops the kinds it has
   * none of rather than saying "0 pinned notes".
   */
  readonly emptyForZero?: boolean;
}

/**
 * A count and its noun, as "1 note" or "3 notes": `one` for exactly one and
 * `many` for everything else, zero included. `many` defaults to `one` with
 * an `s`, which suits every noun but the irregular ones ("entry", "search").
 * `options` asks for digit grouping, or for nothing at all when there are
 * none.
 */
export function pluralize(count: number, one: string, many = `${one}s`, options: PluralizeOptions = {}): string {
  if (options.emptyForZero && count === 0) {
    return '';
  }
  const number = options.locale ? count.toLocaleString('en-US') : `${count}`;
  return `${number} ${count === 1 ? one : many}`;
}

/**
 * The characters each Markdown surface escapes, by name. Each caller keeps
 * the set it was written with, since changing a set changes what a hover or
 * tooltip shows:
 *
 * - `punctuation`: the backslash and every punctuation character Markdown
 *   gives a meaning, for the editor's tag and reference hovers.
 * - `punctuationAndHyphen`: the same with `-`, for the agenda's task
 *   tooltip.
 * - `inline`: only code, emphasis, link, and HTML characters, for the task
 *   status bar's list of overdue titles.
 */
export type MarkdownEscapeSet = 'punctuation' | 'punctuationAndHyphen' | 'inline';

/** The pattern for each escape set; `replace` resets a global pattern, so they are shared. */
const MARKDOWN_ESCAPES: Readonly<Record<MarkdownEscapeSet, RegExp>> = {
  punctuation: /[\\`*_[\]{}()#+.!|<>]/g,
  punctuationAndHyphen: /[\\`*_{}[\]()#+\-.!|<>]/g,
  inline: /[\\`*_[\]<>]/g,
};

/**
 * Backslash-escapes the characters of `set` in `value`, so a note's title or
 * a tag's label shows as written inside a `MarkdownString` rather than as
 * formatting.
 */
export function escapeMarkdown(value: string, set: MarkdownEscapeSet = 'punctuation'): string {
  return value.replace(MARKDOWN_ESCAPES[set], '\\$&');
}

/** `value` with every regular-expression metacharacter escaped, to match it literally inside a larger pattern. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The bytes of a UTF-8 byte order mark, which some Windows editors write first in a file. */
export const UTF8_BOM = Uint8Array.of(0xef, 0xbb, 0xbf);

/** How many bytes a UTF-8 byte order mark takes at the start of a file. */
export const UTF8_BOM_BYTES = UTF8_BOM.length;

/** Whether a file's bytes start with a UTF-8 byte order mark. */
export function startsWithUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

/**
 * `text` without a leading byte order mark, as decodeUtf8Text and VS Code's
 * document hold a note's text, for text that may have been read some other
 * way.
 */
export function withoutByteOrderMark(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/**
 * A file's bytes as UTF-8 text, without the byte order mark some Windows
 * editors write first. Left in, the mark is the first character of the
 * first line, so a heading or front matter there is not read as one.
 */
export function decodeUtf8Text(bytes: Uint8Array): string {
  // TextDecoder drops a leading byte order mark; Buffer's toString keeps it.
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * A short hash of some text: two 32-bit hashes, each in base 36, so a key
 * kept in storage stays short and a collision among a few thousand texts is
 * remote. Not for security.
 */
export function shortHash(text: string): string {
  let first = 0;
  let second = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    first = ((first << 5) - first + code) | 0;
    second = Math.imul(second ^ code, 0x01000193);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
