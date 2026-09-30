/**
 * Small text helpers that commands, views, and view models each used to
 * write for themselves. They hold no Deckard rules, only wording, so every
 * layer may import them; nothing here reaches `vscode`.
 */

/** The two ways a count's wording differs between the places that write one. */
export interface PluralizeOptions {
  /**
   * Writes the number with `en-US` digit grouping, as "1,204", for a count
   * that can run into the thousands, such as the first index's summary.
   */
  readonly locale?: boolean;
  /**
   * Returns '' for a count of zero, for a list that drops the kinds it has
   * none of rather than saying "0 pinned notes".
   */
  readonly emptyForZero?: boolean;
}

/**
 * A count and its noun, as "1 note" or "3 notes": `one` for exactly one and
 * `many` for everything else, zero included. `many` defaults to `one` with
 * an `s`, which suits every noun but the irregular ones ("entry", "search").
 * `options` asks for digit grouping, or for nothing at all when there are
 * none.
 */
export function pluralize(count: number, one: string, many = `${one}s`, options: PluralizeOptions = {}): string {
  if (options.emptyForZero && count === 0) {
    return '';
  }
  const number = options.locale ? count.toLocaleString('en-US') : `${count}`;
  return `${number} ${count === 1 ? one : many}`;
}
