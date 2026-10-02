/**
 * How a tag's key is read: the namespace a `#namespace/name` key is written
 * under, and a namespace or a name worded for a title. The parser reads a
 * tag's entity with these, and the Dashboard's Tags tab groups and names its
 * tags by them, so the page and the host read a key alike.
 *
 * A pure module the page imports (decision D1 of
 * docs/implementation/20-webviews.md): no `vscode`, no I/O, no parser.
 */

/**
 * The namespace a generic `@` tag is kept under when the people marker is
 * customized: never one a reader wrote, so never a namespace.
 */
const RESERVED_NAMESPACE = 'tag-at';

/**
 * The namespace a `#namespace/name` key is written under, as written:
 * `project` for `#project/atlas`. Nothing for an `@` key, for a tag with no
 * namespace, and for the reserved `tag-at`.
 */
export function readTagNamespace(key: string): string | undefined {
  if (!key.startsWith('#')) {
    return undefined;
  }
  const value = key.slice(1);
  const separator = value.indexOf('/');
  if (separator <= 0) {
    return undefined;
  }
  const namespace = value.slice(0, separator);
  return namespace.toLowerCase() === RESERVED_NAMESPACE ? undefined : namespace;
}

/**
 * A namespace or a name as a title writes it: dashes and underscores as
 * spaces, and each word's first letter in capitals, `Follow Up` for
 * `follow-up`.
 */
export function formatKeyWords(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}
