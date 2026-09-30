/**
 * Small readings of a condition's value that the query parser, evaluator,
 * formatter, and editor each need, kept here once so they cannot drift.
 */

/** Whether a value is a glob: it holds `*` or `?`, so it matches by pattern rather than exactly. */
export function isWildcard(value: string): boolean {
  return value.includes('*') || value.includes('?');
}

/**
 * An `in:` folder as a query keeps it: without a leading `./` or trailing
 * slashes, case as written. Empty when the value names no folder.
 */
export function normalizeFolder(value: string): string {
  return value.replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Text with every character a regular expression treats specially escaped, to match it literally. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
