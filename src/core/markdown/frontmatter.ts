/**
 * Where a note's front matter ends, and how the values written in it are
 * read: the one copy of each rule the parser, the front-matter tag editors,
 * Move to…, excerpts, word counts, and tag targets share.
 *
 * The copies these replace disagreed on the closing line, so the rule is the
 * caller's: a note with `...` under its front matter has front matter for the
 * callers that take `...` and not for the others, as it always has.
 */

/**
 * Which line closes front matter opened by `---`:
 *
 * - `dashes`: a line that is `---` once trimmed, so an indented `  ---`
 *   closes it too. The parser, Move to…, and the tag editors read it so.
 * - `dashes-or-dots`: `---` or YAML's `...`, at the very start of the line,
 *   with only whitespace after it. Excerpts, word counts, and tag targets
 *   read it so.
 */
export type FrontmatterClosing = 'dashes' | 'dashes-or-dots';

const DASHES_OR_DOTS = /^(?:---|\.\.\.)\s*$/;

/**
 * The 0-based line front matter closes on, or undefined when the note does
 * not open with a `---` line (whitespace around it allowed) or never closes
 * it.
 */
export function findFrontmatterEnd(lines: readonly string[], closing: FrontmatterClosing): number | undefined {
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }
  const closes =
    closing === 'dashes' ? (line: string) => line.trim() === '---' : (line: string) => DASHES_OR_DOTS.test(line);
  const end = lines.findIndex((line, index) => index > 0 && closes(line));
  return end > 0 ? end : undefined;
}

/** A front-matter value without the one quote, single or double, at either end. */
export function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * The values of a front-matter field written on its own line: the items of
 * an inline `[a, b]` list, or the one value, each trimmed and unquoted.
 * Empty list items are dropped.
 *
 * `keepEmptyValue` keeps a single value that is empty once unquoted, such as
 * `''`, as one empty string: the parser has always kept it, and the tag
 * editors have always dropped it.
 */
export function splitFrontmatterValues(value: string, options: { keepEmptyValue?: boolean } = {}): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  const single = unquote(trimmed);
  return single || options.keepEmptyValue ? [single] : [];
}
