/**
 * Where a note's front matter ends, and how the values written in it are
 * read: the one copy of each rule that every reader of front matter shares,
 * from the parser and the tag editors to excerpts, embeds, and the editor's
 * decorations.
 *
 * The copies these replace disagreed on the closing line: some took YAML's
 * `...` and some did not, so a note closed with `...` had front matter for
 * one feature and none for the next. Every reader now takes both.
 */

/**
 * Whether a line closes front matter: `---`, or YAML's document end `...`,
 * once trimmed, so an indented `  ---` closes it as the parser has always
 * read it.
 */
export function isFrontmatterClose(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '---' || trimmed === '...';
}

/**
 * The 0-based line front matter closes on, or undefined when the note does
 * not open with a `---` line (whitespace around it allowed) or never closes
 * it.
 */
export function findFrontmatterEnd(lines: readonly string[]): number | undefined {
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > 0 && isFrontmatterClose(line));
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
