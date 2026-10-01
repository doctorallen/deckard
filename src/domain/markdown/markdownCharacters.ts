/**
 * The character classes CommonMark reads Markdown by, spelled as markdown-it
 * spells them, so the token tree and the block excerpt agree with what
 * markdown-it drew on the pages before them.
 */

/** A space or a tab: what CommonMark skips around line breaks, in indents, and in link targets. */
export function isSpace(code: number): boolean {
  return code === 0x09 || code === 0x20;
}

/** Characters besides U+2000–U+200A that count as white space for emphasis. */
const WHITE_SPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x202f, 0x205f, 0x3000]);

/**
 * Unicode white space as markdown-it's `isWhiteSpace` reads it. Whether an
 * emphasis marker can open or close depends on it.
 */
export function isWhiteSpace(code: number): boolean {
  return (code >= 0x2000 && code <= 0x200a) || WHITE_SPACE.has(code);
}

const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/** ASCII punctuation: what a backslash escapes, and half of what flanking reads. */
export function isAsciiPunctuation(code: number): boolean {
  return code < 0x80 && ASCII_PUNCTUATION.includes(String.fromCharCode(code));
}

const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;

/**
 * Punctuation or a symbol anywhere in Unicode, which CommonMark 0.31 and
 * markdown-it 14 count alike when deciding whether emphasis can open or close.
 */
export function isPunctuation(code: number): boolean {
  return isAsciiPunctuation(code) || UNICODE_PUNCTUATION.test(String.fromCodePoint(code));
}
