/**
 * The parts of a line that are code or a link, where a `#` or `@` is text
 * and never a tag: inline code spans, `[[wiki links]]` (embeds included),
 * the target of a Markdown link, `[text](target)`, and a bare web address,
 * such as `https://example.com/#install`.
 *
 * Every place that finds, colors, completes, or rewrites tags asks this, so a
 * tag the index holds is a tag the editor shows and Rename Tag changes, and a
 * `#Heading` in `[[#Heading]]` or a `` `#tag` `` in code is none of them.
 */

/** A stretch of one line, by columns, where a `#` or `@` is text rather than a tag. */
export interface InlineRange {
  /** First column in the range. */
  start: number;
  /** Column just past the range. */
  end: number;
}

/**
 * Finds the code and link ranges of one line, in order and never
 * overlapping. Text holding several lines is read one line at a time: no
 * range crosses a line break.
 *
 * Code spans follow CommonMark: a run of backticks opens one that the next
 * run of exactly as many backticks closes, and a run that nothing closes is
 * plain text. A backslash before a backtick or bracket makes it plain text.
 * A `[[` with no `]]` after it on the line is not a link either.
 */
export function findCodeAndLinkRanges(text: string): InlineRange[] {
  const ranges: InlineRange[] = [];
  if (!/[`\]:]/.test(text)) {
    return ranges;
  }
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '`') {
      const run = measureRun(text, index);
      const closing = findClosingRun(text, index + run, run);
      if (closing === undefined) {
        index += run;
        continue;
      }
      ranges.push({ start: index, end: closing + run });
      index = closing + run;
      continue;
    }
    if (character === '[' && text[index + 1] === '[') {
      const close = findOnLine(text, ']]', index + 2);
      if (close !== undefined) {
        const start = index > 0 && text[index - 1] === '!' ? index - 1 : index;
        ranges.push({ start, end: close + 2 });
        index = close + 2;
        continue;
      }
    }
    const address = readBareAddress(text, index);
    if (address > 0) {
      ranges.push({ start: index, end: index + address });
      index += address;
      continue;
    }
    if (character === ']' && text[index + 1] === '(') {
      const close = findOnLine(text, ')', index + 2);
      if (close !== undefined) {
        ranges.push({ start: index + 1, end: close + 1 });
        index = close + 1;
        continue;
      }
    }
    index += 1;
  }
  return ranges;
}

/** A web address's scheme, `://`, and the rest up to a space or an angle bracket. */
const BARE_ADDRESS = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>`]*/y;

/**
 * How long the bare web address starting at `start` is, or 0 when none
 * starts there. A scheme starts a word, so the `s://` inside `xs://` is none.
 */
function readBareAddress(text: string, start: number): number {
  if (!/[A-Za-z]/.test(text[start]) || (start > 0 && /[A-Za-z0-9+.-]/.test(text[start - 1]))) {
    return 0;
  }
  BARE_ADDRESS.lastIndex = start;
  return BARE_ADDRESS.exec(text)?.[0].length ?? 0;
}

/** Whether a column falls inside one of the ranges. */
export function isInRanges(ranges: readonly InlineRange[], column: number): boolean {
  return ranges.some((range) => column >= range.start && column < range.end);
}

/** Whether a column of a line is inside code or a link. */
export function isInCodeOrLink(text: string, column: number): boolean {
  return isInRanges(findCodeAndLinkRanges(text), column);
}

/** How many backticks in a row start at `start`. */
function measureRun(text: string, start: number): number {
  let end = start;
  while (text[end] === '`') {
    end += 1;
  }
  return end - start;
}

/** The start of the next run of exactly `length` backticks on the line. */
function findClosingRun(text: string, from: number, length: number): number | undefined {
  let index = from;
  while (index < text.length && text[index] !== '\n') {
    if (text[index] === '`') {
      const run = measureRun(text, index);
      if (run === length) {
        return index;
      }
      index += run;
      continue;
    }
    index += 1;
  }
  return undefined;
}

/** Where `needle` next appears from `from` on the same line, or undefined past its end. */
function findOnLine(text: string, needle: string, from: number): number | undefined {
  const found = text.indexOf(needle, from);
  if (found < 0) {
    return undefined;
  }
  const lineEnd = text.indexOf('\n', from);
  return lineEnd >= 0 && lineEnd < found ? undefined : found;
}
