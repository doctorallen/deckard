/**
 * Ranks things by how often and how recently they were opened.
 *
 * Firefox's address bar calls this frecency. Deckard keeps only a count and
 * the last time for each tag and note entry, so the score is the count,
 * softened with a logarithm so a habit does not drown out something opened
 * yesterday, decayed by the time since it was last opened. Something never
 * timed, such as a count recorded before times were kept, decays as if it
 * were opened one half-life ago.
 */
export const FRECENCY_HALF_LIFE_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

export function frecencyScore(
  count: number,
  lastAccess: number | undefined,
  now: number = Date.now(),
  halfLifeDays = FRECENCY_HALF_LIFE_DAYS,
): number {
  if (count <= 0 && lastAccess === undefined) {
    return 0;
  }
  const ageDays =
    lastAccess === undefined
      ? halfLifeDays
      : Math.max(0, (now - lastAccess) / DAY);
  return Math.log2(2 + Math.max(0, count)) * 0.5 ** (ageDays / halfLifeDays);
}
