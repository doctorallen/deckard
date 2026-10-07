/**
 * A page's eyebrow, DECKARD / where you are, whose DECKARD is the way to
 * every other page: selecting it drops a menu of them under it, as the
 * top of Context lists them (`goToMenu.ts`, installed once for every page in
 * `startPage`).
 */

/** The eyebrow, with `trail` after DECKARD, such as `TASK BOARD`. */
export function Eyebrow({ trail }: { readonly trail: string }) {
  return (
    <p class="eyebrow">
      <button type="button" class="eyebrow-home" data-go-to="" aria-haspopup="menu" aria-expanded="false" aria-label="Deckard: go to another page">DECKARD ▾</button>
      <span class="eyebrow-trail">{` / ${trail}`}</span>
    </p>
  );
}
