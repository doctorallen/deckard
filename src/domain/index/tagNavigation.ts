import { EntityNamespaceAliases, extractTags, getEntityNamespaceAliases } from '../markdown/parser';

/**
 * Resolves user-facing tag arguments to the canonical key stored by the index.
 *
 * Command URIs and webview state normally carry the marker, but command
 * callers may provide a namespaced value such as `project/neon-relay`. A
 * tag typed by a person may also spell its namespace by an alias, as
 * `#organization/acme` for the `#org/acme` the index holds: a key the index
 * has is taken as it is, and anything else is read through the aliases once,
 * as the parser read the notes. `entityNamespaceAliases` defaults to the
 * built-in ones; a caller with the workspace's passes those.
 */
export function resolveIndexedTagKey<T>(
  tags: ReadonlyMap<string, T>,
  requestedTagKey: string,
  entityNamespaceAliases?: EntityNamespaceAliases,
): string | undefined {
  const candidates = listTagKeyCandidates(requestedTagKey, entityNamespaceAliases);
  for (const candidate of candidates) {
    if (tags.has(candidate)) {
      return candidate;
    }
  }

  const lowercaseKeys = new Map(
    [...tags.keys()].map((key) => [key.toLowerCase(), key]),
  );
  for (const candidate of candidates) {
    const key = lowercaseKeys.get(candidate.toLowerCase());
    if (key) {
      return key;
    }
  }

  return undefined;
}

/**
 * The keys a tag argument may be held under, in the order they are tried:
 * as written, with a `#` when it has no marker, and each read through the
 * aliases as the parser reads a note's tag. None for a blank argument.
 * `resolveIndexedTagKey` takes the first the tags hold, else the first they
 * hold in another case; a search reads them once and tests every unit.
 */
export function listTagKeyCandidates(
  requestedTagKey: string,
  entityNamespaceAliases?: EntityNamespaceAliases,
): string[] {
  const requested = requestedTagKey.trim();
  if (!requested) {
    return [];
  }

  const written = [
    requested,
    requested.startsWith('#') || requested.startsWith('@')
      ? undefined
      : `#${requested}`,
  ].filter((candidate): candidate is string => candidate !== undefined);
  const aliases = getEntityNamespaceAliases(entityNamespaceAliases);
  return [
    ...written,
    ...written.flatMap((candidate) => {
      const [tag] = extractTags(candidate, aliases);
      // Only a candidate that is one whole tag, read as written.
      return tag && tag.label === candidate && tag.key !== candidate ? [tag.key] : [];
    }),
  ];
}
