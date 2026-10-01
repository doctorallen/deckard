import { isSpace } from './markdownCharacters';

/**
 * A note's lines as the block reader sees them: where each line starts and
 * ends in the text, where its content starts, and how far it is indented.
 * Containers (quotes, list items) move a line's content start past their own
 * markers while they read their contents and put it back after, so one copy
 * of the text serves every nesting level. It is markdown-it's `StateBlock`
 * line model, kept so container edges fall exactly where markdown-it put
 * them.
 */
export interface BlockLines {
  readonly src: string;
  /** Where each line begins in `src`. */
  readonly lineStart: number[];
  /** Where each line ends in `src`, at its line break or the end of the text. */
  readonly lineEnd: number[];
  /** How many characters of indent precede each line's content, tabs not expanded. */
  readonly contentShift: number[];
  /**
   * Each line's indent in columns, tabs expanded to the next multiple of 4;
   * -1 for a line a quote took lazily, which only a paragraph may continue
   * with.
   */
  readonly indent: number[];
  /** The column each line's content would start at without its container's markers, for tab stops. */
  readonly baseIndent: number[];
  /** Lines past this one are out of reach of the container being read. */
  lineMax: number;
}

/** The lines of `src`, which has `\n` line breaks only, plus an empty line past the end. */
export function readBlockLines(src: string): BlockLines {
  const lines: BlockLines = {
    src,
    lineStart: [],
    lineEnd: [],
    contentShift: [],
    indent: [],
    baseIndent: [],
    lineMax: 0,
  };
  let start = 0;
  while (start < src.length) {
    const breakAt = src.indexOf('\n', start);
    const end = breakAt < 0 ? src.length : breakAt;
    addLine(lines, start, end);
    start = end + 1;
  }
  lines.lineMax = lines.lineStart.length;
  addLine(lines, src.length, src.length);
  return lines;
}

/** Records one line, measuring its indent. */
function addLine(lines: BlockLines, start: number, end: number): void {
  let position = start;
  let columns = 0;
  while (position < end && isSpace(lines.src.charCodeAt(position))) {
    columns += lines.src[position] === '\t' ? 4 - (columns % 4) : 1;
    position += 1;
  }
  lines.lineStart.push(start);
  lines.lineEnd.push(end);
  lines.contentShift.push(position - start);
  lines.indent.push(columns);
  lines.baseIndent.push(0);
}

/** Where a line's content starts in `src`. */
export function contentStart(lines: BlockLines, line: number): number {
  return lines.lineStart[line] + lines.contentShift[line];
}

/** Whether a line holds nothing but indent. */
export function isEmptyLine(lines: BlockLines, line: number): boolean {
  return contentStart(lines, line) >= lines.lineEnd[line];
}

/** The first line at or after `from` that is not empty, or `lineMax`. */
export function skipEmptyLines(lines: BlockLines, from: number): number {
  let line = from;
  while (line < lines.lineMax && isEmptyLine(lines, line)) {
    line += 1;
  }
  return line;
}

/** The index of the first character at or after `position` that is not a space or a tab. */
export function skipSpaces(lines: BlockLines, position: number): number {
  let index = position;
  while (index < lines.src.length && isSpace(lines.src.charCodeAt(index))) {
    index += 1;
  }
  return index;
}

/** The index just past the run of `character` at `position`. */
export function skipChars(lines: BlockLines, position: number, character: string): number {
  let index = position;
  while (index < lines.src.length && lines.src[index] === character) {
    index += 1;
  }
  return index;
}

/** Back from `position` over spaces and tabs, stopping at `min`. */
export function skipSpacesBack(lines: BlockLines, position: number, min: number): number {
  let index = position;
  while (index > min && isSpace(lines.src.charCodeAt(index - 1))) {
    index -= 1;
  }
  return index;
}

/** Back from `position` over a run of `character`, stopping at `min`. */
export function skipCharsBack(lines: BlockLines, position: number, character: string, min: number): number {
  let index = position;
  while (index > min && lines.src[index - 1] === character) {
    index -= 1;
  }
  return index;
}

/**
 * The text of lines `begin` up to `end`, each with up to `indent` columns
 * of its indent (and its container's markers) taken off. A tab that reaches
 * past `indent` leaves the columns it covers beyond it as spaces. Every
 * line keeps its line break but the last, which keeps it only with
 * `keepLastBreak`, as code does.
 */
export function getLines(lines: BlockLines, range: { begin: number; end: number }, indent: number, keepLastBreak: boolean): string {
  const parts: string[] = [];
  for (let line = range.begin; line < range.end; line += 1) {
    const last = line + 1 < range.end || keepLastBreak ? lines.lineEnd[line] + 1 : lines.lineEnd[line];
    parts.push(stripIndent(lines, line, indent, last));
  }
  return parts.join('');
}

/** One line from its start to `last`, with up to `indent` columns taken off. */
function stripIndent(lines: BlockLines, line: number, indent: number, last: number): string {
  const { src } = lines;
  const start = lines.lineStart[line];
  let first = start;
  let columns = 0;
  while (first < last && columns < indent) {
    const code = src.charCodeAt(first);
    if (code === 0x09) {
      columns += 4 - ((columns + lines.baseIndent[line]) % 4);
    } else if (code === 0x20 || first - start < lines.contentShift[line]) {
      // Characters before the content start are a container's markers,
      // which count as one column each.
      columns += 1;
    } else {
      break;
    }
    first += 1;
  }
  const kept = src.slice(first, last);
  return columns > indent ? ' '.repeat(columns - indent) + kept : kept;
}

/** Text with ASCII white space taken off both ends, as markdown-it trims a paragraph. */
export function asciiTrim(text: string): string {
  return text.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
}
