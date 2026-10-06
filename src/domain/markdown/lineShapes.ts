/**
 * The shapes a Markdown line is recognized by: a checkbox task line, an ATX
 * heading, a code fence. Each rule is spelled here once.
 *
 * The copies these replace did not agree, and a note is read the way each
 * caller has always read it, so the differences are options rather than one
 * rule for everyone: whether `[>]` counts as a task, whether the indent may be
 * any whitespace or only spaces and tabs, what must follow the checkbox, and
 * whether a bare `#` is a heading. A caller names its shape once, as a
 * constant, and passes it in.
 */

/**
 * Which leading whitespace a task line may have: `whitespace` is anything
 * `\s` matches, a no-break space included; `spaces-and-tabs` is only those
 * two; `none` is a line that starts with its bullet.
 */
export type TaskLineIndent = 'whitespace' | 'spaces-and-tabs' | 'none';

/**
 * The marks a checkbox may hold, as the characters allowed between its
 * brackets: ` ` open, `x` or `X` done, `>` migrated to another day; or
 * `STATUS_MARKS`, any status's character.
 */
export type TaskLineMarks = ' ' | 'xX' | ' xX' | ' xX>' | '>' | typeof STATUS_MARKS | typeof STATUS_OR_MIGRATED_MARKS | typeof OTHER_MARKS;

/**
 * Any status's character (taskStatuses.ts): ` `, `x`, or `X` as always,
 * and any other but `>` (a migrated task) and `]`, which, so that a link
 * such as `- [a](https://…)` is not read as a task, must have a space or a
 * tab after its box. Every task line is recognized by this one rule, so a
 * new status is a task everywhere at once; what the character means is
 * looked up in the statuses.
 */
export const STATUS_MARKS = 'status';

/** Any status's character, or `>`: a task, or one migrated to another day. */
export const STATUS_OR_MIGRATED_MARKS = 'status-or-migrated';

/**
 * Any mark but ` `, `x`, `X`, and `>`: a character whose status may make it
 * a task or, for a `nonTask` status, text.
 */
export const OTHER_MARKS = '^ xX>\\]';

/**
 * A status's character as a pattern, for a regular expression of a line's
 * box: ` `, `x`, or `X`, or any other but `>` and `]` that has a space or a
 * tab after its `]`. It captures nothing.
 */
export const STATUS_CHARACTER = String.raw`(?:[ xX]|[^\s>\]](?=\][ \t]))`;

/** What each status shape's mark compiles to, captured. */
const STATUS_MARK_PATTERNS: Readonly<Record<string, string>> = {
  [STATUS_MARKS]: `(${STATUS_CHARACTER})`,
  [STATUS_OR_MIGRATED_MARKS]: `(>|${STATUS_CHARACTER})`,
};

/**
 * What must follow a checkbox's `]`:
 *
 * - `anything`: nothing is required, so `- [ ]word` is a task;
 * - `gap`: one or more spaces or tabs;
 * - `optional-blank`: nothing is required, and one space or tab after the
 *   box, if there is one, is read as part of it;
 * - `gap-then-words`: spaces or tabs, then something that is not a space;
 * - `one-space`: exactly one space, as a line Deckard writes has.
 */
export type TaskLineAfter = 'anything' | 'gap' | 'optional-blank' | 'gap-then-words' | 'one-space';

/** What opens a task line, up to its checkbox's `[`. */
interface TaskLineStart {
  indent: TaskLineIndent;
  /**
   * What sits between the bullet and the box: one or more spaces or tabs, or
   * exactly one space. Spaces or tabs when not said.
   */
  bulletGap?: 'spaces-and-tabs' | 'one-space';
}

/**
 * A task-line rule. With `marks: 'unread'` only the box's opening `[` is
 * required and nothing after it is looked at, for a caller that wants the
 * mark's column on a line another rule has already accepted.
 */
export type TaskLineShape = TaskLineStart &
  (
    | { marks: 'unread' }
    | {
        marks: TaskLineMarks;
        /** Anything, when not said. */
        after?: TaskLineAfter;
        /**
         * The rest of the line must hold no line terminator (`\r`, U+2028,
         * U+2029), as the parser's `(.*)$` has always demanded.
         */
        oneLine?: boolean;
      }
  );

/** A task line taken apart, each part as it is written. */
export interface TaskLineMatch {
  indent: string;
  bullet: string;
  /** The line through the box's `[`: its length is the mark's column. */
  opening: string;
  /** The character between the brackets; empty when the shape does not read it. */
  mark: string;
  /** The line through the box's `]`, or through `[` when the mark is not read. */
  head: string;
  /** What the shape's `after` rule took after the box. */
  gap: string;
  /** The rest of the line, after the gap. */
  body: string;
}

const INDENT_PATTERNS: Readonly<Record<TaskLineIndent, string>> = {
  whitespace: String.raw`\s*`,
  'spaces-and-tabs': String.raw`[ \t]*`,
  none: '',
};

const BULLET_GAP_PATTERNS: Readonly<Record<NonNullable<TaskLineStart['bulletGap']>, string>> = {
  'spaces-and-tabs': String.raw`[ \t]+`,
  'one-space': ' ',
};

/** Each `after` rule, with the gap it takes as the pattern's last group. */
const AFTER_PATTERNS: Readonly<Record<TaskLineAfter, string>> = {
  anything: '()',
  gap: String.raw`([ \t]+)`,
  'optional-blank': String.raw`([ \t]?)`,
  'gap-then-words': String.raw`([ \t]+)(?=\S)`,
  'one-space': '( )',
};

/** Each shape's compiled pattern, kept so a shape declared once compiles once. */
const compiled = new WeakMap<TaskLineShape, RegExp>();

/**
 * The pattern a shape compiles to. Its groups are, in order: the indent, the
 * bullet, the gap before the box, the mark, and the gap after the box.
 */
function taskLinePattern(shape: TaskLineShape): RegExp {
  const known = compiled.get(shape);
  if (known) {
    return known;
  }
  const start = `^(${INDENT_PATTERNS[shape.indent]})([-*+])(${BULLET_GAP_PATTERNS[shape.bulletGap ?? 'spaces-and-tabs']})\\[`;
  const rest =
    shape.marks === 'unread'
      ? '()()'
      : `${STATUS_MARK_PATTERNS[shape.marks] ?? `([${shape.marks}])`}\\]${AFTER_PATTERNS[shape.after ?? 'anything']}${shape.oneLine ? '(?=.*$)' : ''}`;
  const pattern = new RegExp(start + rest);
  compiled.set(shape, pattern);
  return pattern;
}

/** Whether a line is a task line of the given shape. */
export function isTaskLineOf(line: string, shape: TaskLineShape): boolean {
  return taskLinePattern(shape).test(line);
}

/** A task line of the given shape taken apart, or undefined for any other line. */
export function matchTaskLine(line: string, shape: TaskLineShape): TaskLineMatch | undefined {
  const match = taskLinePattern(shape).exec(line);
  if (!match) {
    return undefined;
  }
  const [whole, indent, bullet, bulletGap, mark, gap] = match;
  const opening = `${indent}${bullet}${bulletGap}[`;
  return {
    indent,
    bullet,
    opening,
    mark,
    head: shape.marks === 'unread' ? opening : `${opening}${mark}]`,
    gap,
    body: line.slice(whole.length),
  };
}

const OPENS_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

/**
 * Whether a line opens an ATX heading, read from its start alone: up to
 * three spaces, one to six `#`, then a space, a tab, or the end of the
 * line, so `#` alone is one and `#tag` is not.
 */
export function isHeadingLine(line: string): boolean {
  return OPENS_HEADING.test(line);
}

/** A heading's level and its words, as `matchHeading` reads them. */
export interface HeadingMatch {
  /** 1 for `#`, up to 6. */
  level: number;
  text: string;
}

/**
 * A heading as the parser reads one. The words need a space or a tab
 * between them and the hashes, and run to the end of the line, closing
 * hashes included, with trailing whitespace off (a trailing `\r` counts as
 * whitespace); they never hold a line terminator (`\r`, U+2028, U+2029).
 * The words may be empty: `#`, `# `, and `#  ` are each a heading with no
 * words, as CommonMark and so the preview read them.
 */
const HEADING_TEXT = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)\s*|\r?)$/;

/**
 * A heading line's level and words, closing hashes kept, or undefined for a
 * line that is not one. The parser strips the closing hashes itself.
 */
export function matchHeading(line: string): HeadingMatch | undefined {
  const match = HEADING_TEXT.exec(line);
  return match ? { level: match[1].length, text: match[2] ?? '' } : undefined;
}

/**
 * Whether a line is a heading as the parser reads one: up to three spaces,
 * one to six `#`, then a space, a tab, or nothing, so `#` alone is an empty
 * heading, as CommonMark and the preview read it. A feature that asks
 * whether a line is a heading asks this, so none of them disagrees with the
 * Outline about where a section starts.
 */
export function isHeading(line: string): boolean {
  return matchHeading(line) !== undefined;
}

/**
 * A heading's level and words as the parser reads them, the optional
 * closing hashes off, or undefined for a line that is not a heading.
 */
export function readHeading(line: string): HeadingMatch | undefined {
  const match = matchHeading(line);
  return match ? { level: match.level, text: stripClosingHeadingHashes(match.text.trim()) } : undefined;
}

/** Takes the optional closing hashes of an ATX heading off its words. */
export function stripClosingHeadingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/** A fence's run of three or more backticks or tildes, and what follows it on the line. */
const FENCE_RUN = /^(`{3,}|~{3,})(.*)$/;
/** A list item's marker: its indent, the bullet or number, and the spaces after it. */
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;

/** A fenced code block being read: its character, how long its fence is, and the column it is indented from. */
interface OpenFence {
  character: string;
  length: number;
  base: number;
}

/**
 * The lines of fenced code blocks, fences included, 0-based: marked in one
 * pass so every Markdown feature can ignore examples without keeping a
 * second parser. As CommonMark reads them:
 *
 * - a fence is three or more backticks or tildes, indented up to three
 *   spaces past the list item it sits in, or past the margin outside one;
 *   a backtick fence whose info string holds a backtick is not one;
 * - a block closes only on a fence of its own character at least as long
 *   as the one that opened it, with nothing after it, so a ```` fence can
 *   hold a ``` example;
 * - a block inside a list item closes when the item does, at a line less
 *   indented than the item's text; otherwise an unclosed block runs to the
 *   end of the note.
 */
export function findFencedLines(lines: readonly string[]): Set<number> {
  const fencedLines = new Set<number>();
  // A fence is a run of three backticks or tildes, so lines holding neither
  // open none, and most notes need no more reading than this.
  if (!lines.some((line) => line.includes('```') || line.includes('~~~'))) {
    return fencedLines;
  }
  // The column each open list item's text starts at, innermost last.
  const items: number[] = [];
  let fence: OpenFence | undefined;

  lines.forEach((line, lineIndex) => {
    const indent = indentWidth(line);
    const blank = line.trim() === '';
    if (!blank) {
      while (items.length > 0 && indent < items[items.length - 1]) {
        items.pop();
      }
    }
    if (fence && !blank && indent < fence.base) {
      // The list item the block sat in has ended, and the block with it.
      fence = undefined;
    }
    if (fence) {
      fencedLines.add(lineIndex);
      if (closesFence(line, indent, fence)) {
        fence = undefined;
      }
      return;
    }
    if (blank) {
      return;
    }
    fence = openFenceIn(line, indent, items);
    if (fence) {
      fencedLines.add(lineIndex);
    }
  });

  return fencedLines;
}

/**
 * The fence a line outside any block opens, if it opens one, either on its
 * own or right after a list item's marker; records the list item the line
 * starts in `items`.
 */
function openFenceIn(line: string, indent: number, items: number[]): OpenFence | undefined {
  const base = items.length > 0 ? items[items.length - 1] : 0;
  if (indent - base > 3) {
    return undefined;
  }
  const item = LIST_ITEM.exec(line);
  if (item) {
    const markerEnd = indentWidth(item[1]) + item[2].length;
    const spaces = indentWidth(`${item[1]}${' '.repeat(item[2].length)}${item[3]}`) - markerEnd;
    // Five or more spaces after the marker start indented code in the item.
    const text = item[3] === '' || spaces > 4 ? markerEnd + 1 : markerEnd + spaces;
    items.push(text);
    return readFenceOpening(line.slice(item[0].length), text);
  }
  return readFenceOpening(line.replace(/^[ \t]*/, ''), base);
}

/** The fence `text`, a line with its indent off, opens, indented from `base`. */
function readFenceOpening(text: string, base: number): OpenFence | undefined {
  const run = FENCE_RUN.exec(text);
  if (!run || (run[1][0] === '`' && run[2].includes('`'))) {
    return undefined;
  }
  return { character: run[1][0], length: run[1].length, base };
}

/** Whether a line inside `fence` closes it. */
function closesFence(line: string, indent: number, fence: OpenFence): boolean {
  if (indent - fence.base > 3) {
    return false;
  }
  const run = /^(`{3,}|~{3,})[ \t]*$/.exec(line.replace(/^[ \t]*/, ''));
  return run !== null && run[1][0] === fence.character && run[1].length >= fence.length;
}

/** How far a line's leading spaces and tabs reach, a tab to the next multiple of four. */
function indentWidth(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === ' ') {
      width += 1;
    } else if (character === '\t') {
      width += 4 - (width % 4);
    } else {
      break;
    }
  }
  return width;
}
