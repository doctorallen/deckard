// Which surfaces a Node harness draws, and the name each is written and
// reported by.
//
// Two surfaces can draw one page: the Task Board is drawn grouped by status
// (taskBoard) and by a tag (taskBoardByTag). A harness that names a surface
// by its page writes both to one file, the second over the first, and
// cannot pick one of them alone, so each is named by its surface name.

/**
 * The surfaces `only` picks, each with its name: the surface's own name,
 * else its page's.
 *
 * @param {Array<{ page: string, name?: string }>} surfaces Every surface, in order.
 * @param {string | undefined} only A surface's name, a page (every surface
 *   of it), a pass label such as `fellowship+zen`, or `label:name` or
 *   `label:page`; unset or empty picks every surface.
 * @param {string} label The pass being drawn, such as `fellowship+zen`.
 * @returns {Array<{ surface: object, name: string }>} The picked surfaces, in order.
 */
function pickSurfaces(surfaces, only, label) {
  return surfaces
    .map((surface) => ({ surface, name: surface.name || surface.page }))
    .filter(({ surface, name }) =>
      !only || [name, surface.page, label, `${label}:${name}`, `${label}:${surface.page}`].includes(only));
}

module.exports = { pickSurfaces };
