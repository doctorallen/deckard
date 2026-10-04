/**
 * A page's eyebrow, DECKARD / where you are, whose DECKARD is the way to
 * every other page: selecting it opens Go to…, the list the Pages view
 * shows. The page's listener for it is installed once for every page, in
 * `startPage`.
 */

/** The eyebrow, with `trail` after DECKARD, such as `TASK BOARD`. */
export function Eyebrow({ trail }: { readonly trail: string }) {
  return (
    <p class="eyebrow">
      <button type="button" class="eyebrow-home" data-go-to="" aria-label="Deckard: go to another page" data-tip="Go to another page">DECKARD ▾</button>
      {` / ${trail}`}
    </p>
  );
}
