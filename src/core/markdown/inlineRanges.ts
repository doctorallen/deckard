/**
 * The parts of a line that are code, where a `#` or `@` is text and never a
 * tag: inline code spans.
 *
 * Every place that finds, colors, completes, or rewrites tags asks this, so a
 * tag the index holds is a tag the editor shows and Rename Tag changes, and a
 * `` `#tag` `` in code is none of them.
 */

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
 * plain text. A backslash before a backtick makes it plain text.
 */
export function findCodeAndLinkRanges(text: string): InlineRange[] {
  const ranges: InlineRange[] = [];
  if (!text.includes('`')) {
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
    index += 1;
  }
  return ranges;
}

/** Whether a column falls inside one of the ranges. */
export function isInRanges(ranges: readonly InlineRange[], column: number): boolean {
  return ranges.some((range) => column >= range.start && column < range.end);
}

/** Whether a column of a line is inside code or a link. */
export function isInCodeOrLink(text: string, column: number): boolean {
  return isInRanges(findCodeAndLinkRanges(text), column);
}

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
