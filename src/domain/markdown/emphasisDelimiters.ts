import { isPunctuation, isWhiteSpace } from './markdownCharacters';

/**
 * Which `*`, `_`, and `~~` runs pair up as emphasis: CommonMark's delimiter
 * algorithm, ported from markdown-it's `scanDelims` and `balance_pairs` so a
 * card emphasizes exactly the words markdown-it emphasized.
 */

/** One emphasis marker, waiting to be paired. */
export interface Delimiter {
  /** `*`, `_`, or `~`. */
  marker: string;
  /**
   * The length of the run the marker came from, for the rule of three; 0 for
   * a `~~` pair, which that rule leaves alone.
   */
  length: number;
  /** Where the marker's text sits in the tokenizer's flat list. */
  item: number;
  /** The index of the delimiter this one is closed by, or -1. */
  end: number;
  open: boolean;
  close: boolean;
}

/** What a run of markers can do, read from the characters on either side. */
export interface DelimiterRun {
  length: number;
  canOpen: boolean;
  canClose: boolean;
}

/**
 * The code point before `start`, with the start of the text read as a space
 * and a broken surrogate pair as U+FFFD, as markdown-it reads it.
 */
function codeBefore(source: string, start: number): number {
  if (start === 0) {
    return 0x20;
  }
  const code = source.codePointAt(start - 1) ?? 0x20;
  if (code >= 0xdc00 && code <= 0xdfff) {
    const pair = start >= 2 ? source.codePointAt(start - 2) ?? 0 : 0;
    return pair > 0xffff ? pair : 0xfffd;
  }
  return code >= 0xd800 && code <= 0xdbff ? 0xfffd : code;
}

/** The code point at `position`, with the end of the text read as a space. */
function codeAt(source: string, position: number, max: number): number {
  if (position >= max) {
    return 0x20;
  }
  const code = source.codePointAt(position) ?? 0x20;
  return code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
}

/**
 * The run of markers at `start` and whether it can open or close emphasis.
 * `*` and `~` may split a word; `_` may not, so `snake_case_name` stays text.
 */
export function scanDelimiterRun(source: string, start: number, max: number, canSplitWord: boolean): DelimiterRun {
  const marker = source[start];
  let position = start;
  while (position < max && source[position] === marker) {
    position += 1;
  }
  const before = codeBefore(source, start);
  const after = codeAt(source, position, max);
  const punctuationBefore = isPunctuation(before);
  const punctuationAfter = isPunctuation(after);
  const spaceBefore = isWhiteSpace(before);
  const spaceAfter = isWhiteSpace(after);
  const leftFlanking = !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore);
  const rightFlanking = !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter);
  return {
    length: position - start,
    canOpen: leftFlanking && (canSplitWord || !rightFlanking || punctuationBefore),
    canClose: rightFlanking && (canSplitWord || !leftFlanking || punctuationAfter),
  };
}

/**
 * Whether pairing an opener with a closer breaks the rule of three: when
 * either could both open and close, their lengths may not sum to a multiple
 * of three unless both are multiples of three, so `*foo**bar*` is one em.
 */
function isOddMatch(opener: Delimiter, closer: Delimiter): boolean {
  if (!opener.close && !closer.open) {
    return false;
  }
  if ((opener.length + closer.length) % 3 !== 0) {
    return false;
  }
  return opener.length % 3 !== 0 || closer.length % 3 !== 0;
}

/** Where the search for an opener stops, per marker and per kind of closer. */
type OpenersBottom = Map<string, number[]>;

/**
 * Pairs the delimiters of one nesting level, setting each opener's `end` to
 * its closer. It is markdown-it's `processDelimiters`, jumps and all: the
 * jumps skip runs already matched, so a long line of markers stays linear.
 */
export function balanceDelimiters(delimiters: Delimiter[]): void {
  const bottoms: OpenersBottom = new Map();
  const jumps: number[] = [];
  let headerIndex = 0;
  let lastItem = -2;
  for (let closerIndex = 0; closerIndex < delimiters.length; closerIndex += 1) {
    const closer = delimiters[closerIndex];
    jumps.push(0);
    if (delimiters[headerIndex].marker !== closer.marker || lastItem !== closer.item - 1) {
      headerIndex = closerIndex;
    }
    lastItem = closer.item;
    if (!closer.close) {
      continue;
    }
    const matched = findOpener(delimiters, jumps, { closerIndex, headerIndex, bottoms });
    if (matched) {
      lastItem = -2;
    }
  }
}

/** Where a closer looks for its opener. */
interface OpenerSearch {
  closerIndex: number;
  headerIndex: number;
  bottoms: OpenersBottom;
}

/**
 * Finds the nearest opener a closer can pair with and pairs them, or records
 * how far down the next closer of its kind need not look again.
 * @returns Whether a pair was made.
 */
function findOpener(delimiters: Delimiter[], jumps: number[], search: OpenerSearch): boolean {
  const { closerIndex, headerIndex, bottoms } = search;
  const closer = delimiters[closerIndex];
  const slots = bottoms.get(closer.marker) ?? [-1, -1, -1, -1, -1, -1];
  bottoms.set(closer.marker, slots);
  const slot = (closer.open ? 3 : 0) + (closer.length % 3);
  let openerIndex = headerIndex - jumps[headerIndex] - 1;
  const bottom = openerIndex;
  for (; openerIndex > slots[slot]; openerIndex -= jumps[openerIndex] + 1) {
    const opener = delimiters[openerIndex];
    if (opener.marker !== closer.marker || !opener.open || opener.end >= 0 || isOddMatch(opener, closer)) {
      continue;
    }
    const lastJump = openerIndex > 0 && !delimiters[openerIndex - 1].open ? jumps[openerIndex - 1] + 1 : 0;
    jumps[closerIndex] = closerIndex - openerIndex + lastJump;
    jumps[openerIndex] = lastJump;
    closer.open = false;
    opener.end = closerIndex;
    opener.close = false;
    return true;
  }
  slots[(closer.open ? 3 : 0) + (closer.length % 3)] = bottom;
  return false;
}
