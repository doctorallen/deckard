/**
 * The surfaces `only` picks, each with its name: the surface's own name, else its page's.
 * @param only A surface's name, a page, a pass label, or `label:name` or `label:page`; empty picks every surface.
 * @param label The pass being drawn, such as `fellowship+zen`.
 */
export function pickSurfaces<S extends { page: string; name?: string }>(
  surfaces: readonly S[],
  only: string | undefined,
  label: string,
): Array<{ surface: S; name: string }>;
