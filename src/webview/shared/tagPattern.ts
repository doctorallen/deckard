/** A character a pattern must escape to match itself; `-` is not one outside a class, where `u` refuses it. */
const PATTERN_SYNTAX = new Set('[]{}()|^$+*?./\\');

/**
 * A pattern that finds any of `labels`, longest first, as whole tags: not
 * inside a word, an email address, or a path, so `@dana` is not found in
 * `bob@danaher.com` nor `#atlas` at the end of a link. None when no label
 * is given.
 */
export function createTagLabelPattern(labels: readonly string[]): RegExp | undefined {
  const sorted = labels.filter(Boolean).sort((left, right) => right.length - left.length);
  if (!sorted.length) {
    return undefined;
  }
  const alternatives = sorted.map((label) => [...String(label)].map((character) =>
    (PATTERN_SYNTAX.has(character) ? `\\${character}` : character),
  ).join(''));
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_@#/.-])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}\\p{M}_/-])`, 'gu');
}
