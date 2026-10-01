import { decodeNamedEntity, isValidEntityCode } from './htmlEntities';
import { isSpace } from './markdownCharacters';

/**
 * The target half of a Markdown link, `(destination "title")`, read as
 * markdown-it reads it, and the rule for which targets a page may follow.
 */

/** Where a link target ends, and what it held. */
export interface ParsedPart {
  /** The index just past what was read. */
  end: number;
  /** The text, with escapes and character references decoded. */
  text: string;
}

/** The schemes a link token may carry: the web and mail, nothing that runs or reads a file. */
const SAFE_SCHEME = /^(?:https?|mailto):/i;

/** Schemes markdown-it refuses outright, so `[x](javascript:…)` stays text. */
const REFUSED_SCHEME = /^(?:vbscript|javascript|file|data):/;
const IMAGE_DATA = /^data:image\/(?:gif|png|jpeg|webp);/;

const ESCAPE_OR_ENTITY = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&([a-z#][a-z0-9]{1,31});/gi;
const NUMERIC_REFERENCE = /^#(?:x[a-f0-9]{1,8}|[0-9]{1,8})$/i;

/**
 * Text with its backslash escapes and character references decoded, as a
 * link's destination and title are. A reference nobody knows stays as written.
 */
export function unescapeAll(text: string): string {
  if (!text.includes('\\') && !text.includes('&')) {
    return text;
  }
  return text.replace(ESCAPE_OR_ENTITY, (whole: string, escaped?: string, entity?: string) => {
    if (escaped) {
      return escaped;
    }
    return decodeReference(whole, entity ?? '');
  });
}

/** One `&…;` reference decoded, or the reference itself when it names nothing. */
function decodeReference(whole: string, name: string): string {
  if (name.startsWith('#')) {
    const hex = name[1] === 'x' || name[1] === 'X';
    const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return NUMERIC_REFERENCE.test(name) && isValidEntityCode(code) ? String.fromCodePoint(code) : whole;
  }
  return decodeNamedEntity(name) ?? whole;
}

/**
 * A link destination at `start`: `<…>` on one line, or a run with no spaces
 * or control characters whose parentheses balance.
 * @returns `undefined` when there is none, and for an empty unbracketed one.
 */
export function parseLinkDestination(source: string, start: number, max: number): ParsedPart | undefined {
  if (source[start] === '<') {
    return parseBracketedDestination(source, start, max);
  }
  let position = start;
  let depth = 0;
  while (position < max) {
    const code = source.charCodeAt(position);
    if (code === 0x20 || code < 0x20 || code === 0x7f) {
      break;
    }
    if (code === 0x5c && position + 1 < max) {
      // `\ ` is not an escape: the backslash is kept and the space ends the target.
      position += source[position + 1] === ' ' ? 1 : 2;
      continue;
    }
    if (code === 0x28) {
      depth += 1;
      if (depth > 32) {
        return undefined;
      }
    }
    if (code === 0x29) {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
    position += 1;
  }
  if (position === start || depth !== 0) {
    return undefined;
  }
  return { end: position, text: unescapeAll(source.slice(start, position)) };
}

/** A destination written as `<…>`, which may hold spaces but not a line break or `<`. */
function parseBracketedDestination(source: string, start: number, max: number): ParsedPart | undefined {
  let position = start + 1;
  while (position < max) {
    const character = source[position];
    if (character === '\n' || character === '<') {
      return undefined;
    }
    if (character === '>') {
      return { end: position + 1, text: unescapeAll(source.slice(start + 1, position)) };
    }
    position += character === '\\' && position + 1 < max ? 2 : 1;
  }
  return undefined;
}

/**
 * A link title at `start`, in `"…"`, `'…'`, or `(…)`.
 * @returns `undefined` when there is none or it never closes.
 */
export function parseLinkTitle(source: string, start: number, max: number): ParsedPart | undefined {
  if (start >= max) {
    return undefined;
  }
  const opener = source[start];
  if (opener !== '"' && opener !== "'" && opener !== '(') {
    return undefined;
  }
  const closer = opener === '(' ? ')' : opener;
  let position = start + 1;
  while (position < max) {
    const character = source[position];
    if (character === closer) {
      return { end: position + 1, text: unescapeAll(source.slice(start + 1, position)) };
    }
    if (character === '(' && closer === ')') {
      return undefined;
    }
    position += character === '\\' && position + 1 < max ? 2 : 1;
  }
  return undefined;
}

/** The index of the first character at or after `position` that is not a space, tab, or line break. */
export function skipBlank(source: string, position: number, max: number): number {
  let index = position;
  while (index < max && (isSpace(source.charCodeAt(index)) || source[index] === '\n')) {
    index += 1;
  }
  return index;
}

/** Characters a URL keeps as written; everything else is percent-encoded. */
const URL_KEPT = /[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]/;

/**
 * A destination percent-encoded as markdown-it's `normalizeLink` encodes it,
 * keeping any `%XX` already there. Host names are left as written, where
 * markdown-it would turn a non-ASCII one into punycode; the browser does that
 * itself.
 */
export function normalizeLink(url: string): string {
  let result = '';
  for (let index = 0; index < url.length; index += 1) {
    const character = url[index];
    if (character === '%' && /^[0-9a-f]{2}$/i.test(url.slice(index + 1, index + 3))) {
      result += url.slice(index, index + 3);
      index += 2;
      continue;
    }
    if (URL_KEPT.test(character)) {
      result += character;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < url.length) {
      result += encodeUtf16(character + url[index + 1]);
      index += 1;
      continue;
    }
    result += encodeUtf16(character);
  }
  return result;
}

/** One character percent-encoded as UTF-8, with a lone surrogate as U+FFFD. */
function encodeUtf16(character: string): string {
  try {
    return encodeURIComponent(character);
  } catch {
    return '%EF%BF%BD';
  }
}

/**
 * Whether markdown-it makes a link of a target at all. It refuses
 * `javascript:`, `vbscript:`, `file:`, and `data:` (but for a few image
 * types), and the Markdown around such a target stays text.
 */
export function isLinkAccepted(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return !REFUSED_SCHEME.test(lower) || IMAGE_DATA.test(lower);
}

/**
 * Whether a link token may carry a URL: http, https, or mailto, and nothing
 * else. A relative path or any other scheme is not followed from a page.
 */
export function isSafeLinkUrl(url: string): boolean {
  return SAFE_SCHEME.test(url);
}
