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
 * an inline `[a, b]` list, read as YAML reads them (see splitFlowListItems
 * and readFlowListValue), or the one value, trimmed and unquoted. Empty list
 * items are dropped.
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
    return splitFlowListItems(trimmed.slice(1, -1))
      .map((item) => readFlowListValue(item.text.trim()))
      .filter(Boolean);
  }
  const single = unquote(trimmed);
  return single || options.keepEmptyValue ? [single] : [];
}

/**
 * The items of the inside of an inline `[a, b]` list, as written, each with
 * the offset it starts at: split at each comma outside a quoted value, as
 * YAML splits it, so `["a, b", c]` holds two items. Only a quote that opens
 * a value starts one, so the `'` in `it's` does not; inside single quotes,
 * `''` is one quote, not the end.
 */
export function splitFlowListItems(inner: string): { text: string; start: number }[] {
  const items: { text: string; start: number }[] = [];
  let start = 0;
  let quote: string | undefined;
  let valueStart = true;
  for (let at = 0; at < inner.length; at += 1) {
    const character = inner[at];
    if (quote) {
      if (character === "'" && quote === "'" && inner[at + 1] === "'") {
        at += 1;
      } else if (character === quote) {
        quote = undefined;
      }
    } else if (character === ',') {
      items.push({ text: inner.slice(start, at), start });
      start = at + 1;
      valueStart = true;
    } else {
      if (valueStart && (character === '"' || character === "'")) {
        quote = character;
      }
      valueStart &&= /\s/.test(character);
    }
  }
  items.push({ text: inner.slice(start), start });
  return items;
}

/** One trimmed `[a, b]` list item as YAML reads it: without its quotes, a single-quoted one's `''` read as `'`. */
export function readFlowListValue(item: string): string {
  return item.length >= 2 && item.startsWith("'") && item.endsWith("'")
    ? item.slice(1, -1).replace(/''/g, "'")
    : unquote(item);
}
