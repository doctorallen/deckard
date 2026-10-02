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
 * brackets: ` ` open, `x` or `X` done, `>` migrated to another day.
 */
export type TaskLineMarks = ' ' | 'xX' | ' xX' | ' xX>' | '>';

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
      : `([${shape.marks}])\\]${AFTER_PATTERNS[shape.after ?? 'anything']}${shape.oneLine ? '(?=.*$)' : ''}`;
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

/**
 * Which lines open an ATX heading. Half the callers take `#` alone, or `##`
 * alone, as a heading and half do not, so the choice is the caller's.
 */
export interface HeadingShape {
  /**
   * Whether hashes with nothing after them are a heading. Either way, hashes
   * followed by a space or a tab are, and `#tag` is not.
   */
  allowBare: boolean;
}

const BARE_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SPACED_HEADING = /^ {0,3}#{1,6}[ \t]+/;

/** Whether a line opens an ATX heading of the given shape: up to three spaces, then one to six `#`. */
export function isHeadingLine(line: string, shape: HeadingShape): boolean {
  return (shape.allowBare ? BARE_HEADING : SPACED_HEADING).test(line);
}

/** A heading's level and its words, as `matchHeading` reads them. */
export interface HeadingMatch {
  /** 1 for `#`, up to 6. */
  level: number;
  text: string;
}

/**
 * How a heading's words are read. Words need a space or a tab between them
 * and the hashes, and neither reads words with a line terminator (`\r`,
 * U+2028, U+2029) inside them.
 *
 * - `kept`: the words run to the end of the line, closing hashes included,
 *   with trailing whitespace off (a trailing `\r` counts as whitespace).
 *   The words may be empty: `#`, `# `, and `#  ` are each a heading with no
 *   words, as CommonMark and so the preview read them. The parser reads
 *   headings this way and strips closing hashes itself.
 * - `dropped`: closing hashes and the spaces and tabs around them are off,
 *   and the words may be empty, so `# ` and `# #` are headings with no
 *   words; a trailing `\r` makes the line not a heading.
 */
export type HeadingClosingHashes = 'kept' | 'dropped';

const HEADING_TEXT_PATTERNS: Readonly<Record<HeadingClosingHashes, RegExp>> = {
  kept: /^ {0,3}(#{1,6})(?:[ \t]+(.*?)\s*|\r?)$/,
  dropped: /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*(?:#+[ \t]*)?$/,
};

/** A heading line's level and words, or undefined for a line that is not one. */
export function matchHeading(line: string, closingHashes: HeadingClosingHashes): HeadingMatch | undefined {
  const match = HEADING_TEXT_PATTERNS[closingHashes].exec(line);
  return match ? { level: match[1].length, text: match[2] ?? '' } : undefined;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The lines of fenced code blocks, fences included, 0-based: marked in one
 * pass so every Markdown feature can ignore examples without keeping a
 * second parser. A fence closes only on the character that opened it, so a
 * `~~~` line inside a backtick block is part of the block. An unclosed fence
 * runs to the end of the note.
 */
export function findFencedLines(lines: readonly string[]): Set<number> {
  const fencedLines = new Set<number>();
  let fenceCharacter: '`' | '~' | undefined;

  lines.forEach((line, lineIndex) => {
    const fence = line.match(FENCE);
    if (fence) {
      fencedLines.add(lineIndex);
      const nextFenceCharacter = fence[1][0] as '`' | '~';
      if (fenceCharacter === undefined) {
        fenceCharacter = nextFenceCharacter;
      } else if (fenceCharacter === nextFenceCharacter) {
        fenceCharacter = undefined;
      }
      return;
    }

    if (fenceCharacter !== undefined) {
      fencedLines.add(lineIndex);
    }
  });

  return fencedLines;
}
