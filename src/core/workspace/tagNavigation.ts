/**
 * Resolves user-facing tag arguments to the canonical key stored by the index.
 *
 * Command URIs and webview state normally carry the marker, but command
 * callers may provide a namespaced value such as `project/neon-relay`.
 */
export function resolveIndexedTagKey<T>(
  tags: ReadonlyMap<string, T>,
  requestedTagKey: string,
): string | undefined {
  const requested = requestedTagKey.trim();
  if (!requested) {
    return undefined;
  }

  const candidates = [
    requested,
    requested.startsWith('#') || requested.startsWith('@')
      ? undefined
      : `#${requested}`,
  ].filter((candidate): candidate is string => candidate !== undefined);

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
