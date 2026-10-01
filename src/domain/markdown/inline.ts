import { balanceDelimiters, Delimiter, scanDelimiterRun } from './emphasisDelimiters';
import { decodeNamedEntity, decodeNumericEntity } from './htmlEntities';
import {
  isLinkAccepted,
  isSafeLinkUrl,
  normalizeLink,
  parseLinkDestination,
  parseLinkTitle,
  skipBlank,
} from './linkTargets';
import { isAsciiPunctuation, isSpace } from './markdownCharacters';
import type { EmphasisToken, InlineToken } from '../model/inline';

/**
 * Inline Markdown as tokens: the words of a title or a paragraph with their
 * emphasis, code, links, and wiki links, as data a page draws with elements
 * and text nodes. Nothing here is HTML and nothing is parsed as HTML, so
 * there is nothing to sanitize: `<b>` in a note is three characters of text,
 * and a link token only ever carries an http, https, or mailto URL.
 *
 * The rules are markdown-it's, as Deckard configured it (`breaks: true`, no
 * HTML, no linkify), ported one for one, because titles and cards must read
 * as they did when markdown-it and sanitize-html drew them. Where the two
 * part ways it is on purpose and named where it happens: wiki links, links
 * to anything but the web and mail, and images. The tokens' types are the
 * domain model's (`model/inline.ts`), which the protocol carries to the
 * pages; they are exported here too.
 */

export type {
  BreakToken,
  CodeToken,
  EmphasisToken,
  InlineToken,
  LinkToken,
  TextToken,
  WikiLinkToken,
} from '../model/inline';

/**
 * Reads a line of inline Markdown, such as a task title, into tokens, as
 * markdown-it's `renderInline` read it: no blocks, and line breaks as breaks.
 */
export function tokenizeInline(source: string): InlineToken[] {
  const text = source.replace(/\r\n?/g, '\n').replace(/\0/g, String.fromCharCode(0xfffd));
  return tokenizeRange(text, 0, text.length);
}

/**
 * One entry of the flat list a pass writes before it becomes a tree: text,
 * a finished token, or where emphasis opens and closes once the delimiters
 * have paired.
 */
type FlatItem =
  | { kind: 'text'; text: string }
  | { kind: 'token'; token: InlineToken }
  | { kind: 'open' | 'close'; tag: EmphasisToken['kind'] };

/** One pass over `src` from `pos` to `max`: a whole title, or one link's label. */
interface InlineState {
  readonly src: string;
  pos: number;
  readonly max: number;
  /** Text read since the last item, written as one text item. */
  pending: string;
  readonly items: FlatItem[];
  readonly delimiters: Delimiter[];
  /** Where a skipped token ends, by where it starts, so nested labels stay linear. */
  readonly skipped: Map<number, number>;
}

/**
 * A rule reads one construct at `state.pos` and moves past it. A silent rule
 * only moves, for `parseLinkLabel`, which needs to know where a token ends.
 */
type InlineRule = (state: InlineState, silent: boolean) => boolean;

/**
 * Reads `src` from `start` to `end`. A link's label is read this way as a
 * pass of its own, so emphasis never pairs across a link's edge.
 */
function tokenizeRange(src: string, start: number, end: number): InlineToken[] {
  const state: InlineState = {
    src,
    pos: start,
    max: end,
    pending: '',
    items: [],
    delimiters: [],
    skipped: new Map(),
  };
  while (state.pos < state.max) {
    if (!RULES.some((rule) => rule(state, false))) {
      state.pending += src[state.pos];
      state.pos += 1;
    }
  }
  flushPending(state);
  balanceDelimiters(state.delimiters);
  closeStrikethrough(state);
  closeEmphasis(state);
  return buildTree(state.items);
}

/** Writes the pending text, if any, as a text item. */
function flushPending(state: InlineState): void {
  if (state.pending === '') {
    return;
  }
  state.items.push({ kind: 'text', text: state.pending });
  state.pending = '';
}

/** Writes a finished token after the pending text. */
function pushToken(state: InlineState, token: InlineToken): void {
  flushPending(state);
  state.items.push({ kind: 'token', token });
}

/**
 * Writes text as an item of its own, so a delimiter can point at it and turn
 * it into where emphasis opens or closes.
 * @returns The item's index.
 */
function pushTextItem(state: InlineState, text: string): number {
  flushPending(state);
  state.items.push({ kind: 'text', text });
  return state.items.length - 1;
}

/** The characters any rule but plain text starts at. */
const TERMINATORS = new Set('\n!#$%&*+-:<=>@[\\]^_`{}~');

/** A run of characters no other rule starts at, read as text in one step. */
function textRule(state: InlineState, silent: boolean): boolean {
  let position = state.pos;
  while (position < state.max && !TERMINATORS.has(state.src[position])) {
    position += 1;
  }
  if (position === state.pos) {
    return false;
  }
  if (!silent) {
    state.pending += state.src.slice(state.pos, position);
  }
  state.pos = position;
  return true;
}

/**
 * A line break. Spaces before it are dropped, as both a soft and a hard break
 * drop them, and so are spaces and tabs at the start of the next line.
 */
function newlineRule(state: InlineState, silent: boolean): boolean {
  if (state.src[state.pos] !== '\n') {
    return false;
  }
  if (!silent) {
    state.pending = state.pending.replace(/ +$/, '');
    pushToken(state, { kind: 'break' });
  }
  state.pos = skipSpaces(state, state.pos + 1);
  return true;
}

/** The index of the first character at or after `position` that is not a space or a tab. */
function skipSpaces(state: InlineState, position: number): number {
  let index = position;
  while (index < state.max && isSpace(state.src.charCodeAt(index))) {
    index += 1;
  }
  return index;
}

/**
 * A backslash: before punctuation it makes the character text, before a line
 * break it is a hard break, and before anything else it is itself.
 */
function escapeRule(state: InlineState, silent: boolean): boolean {
  const { src, pos } = state;
  if (src[pos] !== '\\' || pos + 1 >= state.max) {
    return false;
  }
  const next = src.charCodeAt(pos + 1);
  if (next === 0x0a) {
    if (!silent) {
      pushToken(state, { kind: 'break' });
    }
    state.pos = skipSpaces(state, pos + 2);
    return true;
  }
  if (next === 0x20) {
    state.pending += silent ? '' : '\\';
    state.pos = pos + 1;
    return true;
  }
  const escaped = String.fromCodePoint(src.codePointAt(pos + 1) ?? next);
  if (!silent) {
    state.pending += isAsciiPunctuation(next) ? escaped : `\\${escaped}`;
  }
  state.pos = pos + 1 + escaped.length;
  return true;
}

/**
 * A code span: a run of backticks closed by the next run of exactly as many.
 * A run nothing closes is text. Inside, line breaks read as spaces, and one
 * space is taken off each end when both ends have one.
 */
function backtickRule(state: InlineState, silent: boolean): boolean {
  const { src, max } = state;
  if (src[state.pos] !== '`') {
    return false;
  }
  const start = state.pos;
  const contentStart = runEnd(src, start, max);
  const length = contentStart - start;
  let searchFrom = contentStart;
  for (;;) {
    const closeStart = src.indexOf('`', searchFrom);
    if (closeStart < 0 || closeStart >= max) {
      break;
    }
    searchFrom = runEnd(src, closeStart, max);
    if (searchFrom - closeStart === length) {
      if (!silent) {
        const text = src.slice(contentStart, closeStart).replace(/\n/g, ' ').replace(/^ (.+) $/, '$1');
        pushToken(state, { kind: 'code', text });
      }
      state.pos = searchFrom;
      return true;
    }
  }
  state.pending += silent ? '' : src.slice(start, contentStart);
  state.pos = contentStart;
  return true;
}

/** The index just past the run of the character at `start`. */
function runEnd(src: string, start: number, max: number): number {
  let position = start;
  while (position < max && src[position] === src[start]) {
    position += 1;
  }
  return position;
}

/**
 * A run of two or more tildes, as `~~` delimiters to pair later. An odd
 * tilde is text, and a lone `~` is never strikethrough.
 */
function strikethroughRule(state: InlineState, silent: boolean): boolean {
  if (silent || state.src[state.pos] !== '~') {
    return false;
  }
  const run = scanDelimiterRun(state.src, state.pos, state.max, true);
  if (run.length < 2) {
    return false;
  }
  if (run.length % 2 === 1) {
    pushTextItem(state, '~');
  }
  for (let pairs = Math.floor(run.length / 2); pairs > 0; pairs -= 1) {
    const item = pushTextItem(state, '~~');
    state.delimiters.push({ marker: '~', length: 0, item, end: -1, open: run.canOpen, close: run.canClose });
  }
  state.pos += run.length;
  return true;
}

/** A run of `*` or `_`, one delimiter per character, to pair later. */
function emphasisRule(state: InlineState, silent: boolean): boolean {
  const marker = state.src[state.pos];
  if (silent || (marker !== '*' && marker !== '_')) {
    return false;
  }
  const run = scanDelimiterRun(state.src, state.pos, state.max, marker === '*');
  for (let index = 0; index < run.length; index += 1) {
    const item = pushTextItem(state, marker);
    state.delimiters.push({ marker, length: run.length, item, end: -1, open: run.canOpen, close: run.canClose });
  }
  state.pos += run.length;
  return true;
}

/**
 * A `[[wiki link]]` or `![[embed]]` closed on the same line. markdown-it had
 * no such rule and showed one as its literal text, which the token keeps; it
 * is read before links so `[[a]]` is never mistaken for a label.
 */
function wikiLinkRule(state: InlineState, silent: boolean): boolean {
  const { src, pos } = state;
  const embed = src[pos] === '!';
  const open = embed ? pos + 1 : pos;
  if (silent || !src.startsWith('[[', open)) {
    return false;
  }
  const close = src.indexOf(']]', open + 2);
  if (close < 0 || close + 2 > state.max || src.slice(open + 2, close).includes('\n')) {
    return false;
  }
  const target = src.slice(open + 2, close).split('|')[0].trim();
  pushToken(state, { kind: 'wikiLink', text: src.slice(pos, close + 2), target, embed });
  state.pos = close + 2;
  return true;
}

/** A link's target: where it ends, its URL (empty when refused), and its title. */
interface LinkTarget {
  end: number;
  url: string;
  title: string;
}

/**
 * The `(destination "title")` after a label's `]`. A destination markdown-it
 * refuses, such as `javascript:`, makes the whole link text.
 */
function parseTarget(state: InlineState, start: number): LinkTarget | undefined {
  const { src, max } = state;
  if (start >= max || src[start] !== '(') {
    return undefined;
  }
  let position = skipBlank(src, start + 1, max);
  if (position >= max) {
    return undefined;
  }
  let url = '';
  let title = '';
  const destination = parseLinkDestination(src, position, max);
  if (destination) {
    const normalized = normalizeLink(destination.text);
    if (isLinkAccepted(normalized)) {
      url = normalized;
      position = destination.end;
    }
    const beforeGap = position;
    position = skipBlank(src, position, max);
    const parsedTitle = parseLinkTitle(src, position, max);
    if (parsedTitle && position < max && beforeGap !== position) {
      title = parsedTitle.text;
      position = skipBlank(src, parsedTitle.end, max);
    }
  }
  if (position >= max || src[position] !== ')') {
    return undefined;
  }
  return { end: position + 1, url, title };
}

/**
 * Where a link label that opens at `start` closes, or -1. Labels nest by
 * brackets, and code spans, escapes, and autolinks inside are skipped whole.
 * With `disableNested`, a label holding a link is refused, since a link
 * cannot hold a link.
 */
function parseLinkLabel(state: InlineState, start: number, disableNested: boolean): number {
  const saved = state.pos;
  state.pos = start + 1;
  let level = 1;
  let end = -1;
  while (state.pos < state.max) {
    const marker = state.src[state.pos];
    if (marker === ']') {
      level -= 1;
      if (level === 0) {
        end = state.pos;
        break;
      }
    }
    const before = state.pos;
    skipToken(state);
    if (marker === '[' && before === state.pos - 1) {
      level += 1;
    } else if (marker === '[' && disableNested) {
      state.pos = saved;
      return -1;
    }
  }
  state.pos = saved;
  return end;
}

/** Moves past one token without writing it: the rules run silent. */
function skipToken(state: InlineState): void {
  const start = state.pos;
  const known = state.skipped.get(start);
  if (known !== undefined) {
    state.pos = known;
    return;
  }
  if (!RULES.some((rule) => rule(state, true))) {
    state.pos += 1;
  }
  state.skipped.set(start, state.pos);
}

/**
 * A `[label](target)` link. A link to the web or to mail becomes a link
 * token; a link to anything else (a relative path, `ftp:`, `obsidian:`) is
 * read as its label's tokens alone, where markdown-it drew an anchor whose
 * href the sanitizer then removed or a page could not follow.
 */
function linkRule(state: InlineState, silent: boolean): boolean {
  if (state.src[state.pos] !== '[') {
    return false;
  }
  const labelEnd = parseLinkLabel(state, state.pos, true);
  if (labelEnd < 0) {
    return false;
  }
  const target = parseTarget(state, labelEnd + 1);
  if (!target) {
    return false;
  }
  if (!silent) {
    const children = tokenizeRange(state.src, state.pos + 1, labelEnd);
    pushLink(state, target, children);
  }
  state.pos = target.end;
  return true;
}

/**
 * Writes a link, or only its words when the URL is not one a token may hold.
 * An empty item goes on each side either way: markdown-it had an opening and
 * a closing token there, and emphasis pairs by what is next to what.
 */
function pushLink(state: InlineState, target: LinkTarget, children: InlineToken[]): void {
  pushTextItem(state, '');
  if (isSafeLinkUrl(target.url)) {
    pushToken(state, { kind: 'link', url: target.url, ...(target.title ? { title: target.title } : {}), children });
  } else {
    children.forEach((child) => pushToken(state, child));
  }
  pushTextItem(state, '');
}

/**
 * An image, `![alt](src)`, which shows nothing: markdown-it drew an `<img>`
 * and the sanitizer removed it, alt text and all.
 */
function imageRule(state: InlineState, silent: boolean): boolean {
  if (state.src[state.pos] !== '!' || state.src[state.pos + 1] !== '[') {
    return false;
  }
  const labelEnd = parseLinkLabel(state, state.pos + 1, false);
  const target = labelEnd < 0 ? undefined : parseTarget(state, labelEnd + 1);
  if (!target) {
    return false;
  }
  if (!silent) {
    pushTextItem(state, '');
  }
  state.pos = target.end;
  return true;
}

const AUTOLINK = /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\x00-\x20]*$/;
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** The URL an autolink's body points to, or undefined when it is not one. */
function autolinkUrl(body: string): string | undefined {
  if (AUTOLINK.test(body)) {
    return normalizeLink(body);
  }
  return EMAIL.test(body) ? normalizeLink(`mailto:${body}`) : undefined;
}

/**
 * An autolink, `<https://…>` or `<name@example.com>`. Like a link, one to a
 * scheme other than http, https, or mailto is its words alone.
 */
function autolinkRule(state: InlineState, silent: boolean): boolean {
  const { src, pos, max } = state;
  if (src[pos] !== '<') {
    return false;
  }
  let end = pos + 1;
  while (end < max && src[end] !== '<' && src[end] !== '>') {
    end += 1;
  }
  const url = end < max && src[end] === '>' ? autolinkUrl(src.slice(pos + 1, end)) : undefined;
  if (url === undefined || !isLinkAccepted(url)) {
    return false;
  }
  if (!silent) {
    const words: InlineToken = { kind: 'text', text: decodeLinkText(src.slice(pos + 1, end)) };
    pushLink(state, { end: end + 1, url, title: '' }, [words]);
  }
  state.pos = end + 1;
  return true;
}

/** An autolink's words, with percent-escapes shown as characters where that is safe. */
function decodeLinkText(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

const NUMERIC_REFERENCE = /^&#((?:x[a-f0-9]{1,6}|[0-9]{1,7}));/i;
const NAMED_REFERENCE = /^&([a-z][a-z0-9]{1,31});/i;

/** A character reference, `&copy;` or `&#169;`. One that names nothing is text as written. */
function entityRule(state: InlineState, silent: boolean): boolean {
  if (state.src[state.pos] !== '&') {
    return false;
  }
  const rest = state.src.slice(state.pos, state.max);
  const numeric = NUMERIC_REFERENCE.exec(rest);
  const named = numeric ? undefined : NAMED_REFERENCE.exec(rest);
  const decoded = numeric ? decodeNumericEntity(`#${numeric[1]}`) : decodeNamedEntity(named?.[1] ?? '');
  const match = numeric ?? named;
  if (!match || decoded === undefined) {
    return false;
  }
  if (!silent) {
    state.pending += decoded;
  }
  state.pos += match[0].length;
  return true;
}

/** The rules in markdown-it's order, with wiki links ahead of links and images. */
const RULES: readonly InlineRule[] = [
  textRule,
  newlineRule,
  escapeRule,
  backtickRule,
  strikethroughRule,
  emphasisRule,
  wikiLinkRule,
  linkRule,
  imageRule,
  autolinkRule,
  entityRule,
];

/**
 * Turns paired `~~` delimiters into strikethrough. A lone `~` left inside a
 * closing run is moved after the close, as markdown-it moves it.
 */
function closeStrikethrough(state: InlineState): void {
  const { items, delimiters } = state;
  const lone: number[] = [];
  for (const opener of delimiters) {
    if (opener.marker !== '~' || opener.end === -1) {
      continue;
    }
    const closer = delimiters[opener.end];
    items[opener.item] = { kind: 'open', tag: 'del' };
    items[closer.item] = { kind: 'close', tag: 'del' };
    const before = items[closer.item - 1];
    if (before.kind === 'text' && before.text === '~') {
      lone.push(closer.item - 1);
    }
  }
  for (let index = lone.pop(); index !== undefined; index = lone.pop()) {
    let last = index + 1;
    while (last < items.length && isDelClose(items[last])) {
      last += 1;
    }
    last -= 1;
    [items[index], items[last]] = [items[last], items[index]];
  }
}

/** Whether an item closes strikethrough. */
function isDelClose(item: FlatItem): boolean {
  return item.kind === 'close' && item.tag === 'del';
}

/**
 * Turns paired `*` and `_` delimiters into emphasis, innermost last, so two
 * pairs that sit directly inside each other become one strong emphasis.
 */
function closeEmphasis(state: InlineState): void {
  const { items, delimiters } = state;
  for (let index = delimiters.length - 1; index >= 0; index -= 1) {
    const opener = delimiters[index];
    if ((opener.marker !== '*' && opener.marker !== '_') || opener.end === -1) {
      continue;
    }
    const closer = delimiters[opener.end];
    const outer = delimiters[index - 1];
    const strong =
      outer !== undefined &&
      outer.end === opener.end + 1 &&
      outer.marker === opener.marker &&
      outer.item === opener.item - 1 &&
      delimiters[opener.end + 1].item === closer.item + 1;
    const tag = strong ? 'strong' : 'em';
    items[opener.item] = { kind: 'open', tag };
    items[closer.item] = { kind: 'close', tag };
    if (strong) {
      items[outer.item] = { kind: 'text', text: '' };
      items[delimiters[opener.end + 1].item] = { kind: 'text', text: '' };
      index -= 1;
    }
  }
}

/** The flat list as a tree, with neighboring text joined and empty text dropped. */
function buildTree(items: readonly FlatItem[]): InlineToken[] {
  const root: InlineToken[] = [];
  const parents: InlineToken[][] = [];
  let current = root;
  for (const item of items) {
    switch (item.kind) {
      case 'text':
        appendToken(current, { kind: 'text', text: item.text });
        break;
      case 'token':
        appendToken(current, item.token);
        break;
      case 'open': {
        const node: EmphasisToken = { kind: item.tag, children: [] };
        current.push(node);
        parents.push(current);
        current = node.children;
        break;
      }
      case 'close':
        current = parents.pop() ?? root;
        break;
    }
  }
  return root;
}

/** Adds a token, joining text to the text before it. */
function appendToken(tokens: InlineToken[], token: InlineToken): void {
  if (token.kind !== 'text') {
    tokens.push(token);
    return;
  }
  if (token.text === '') {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last?.kind === 'text') {
    tokens[tokens.length - 1] = { kind: 'text', text: last.text + token.text };
    return;
  }
  tokens.push(token);
}
