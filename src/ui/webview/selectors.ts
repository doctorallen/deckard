/**
 * Selector pieces the shared sheet, the themes, and the pages all write.
 *
 * Its own module so `themes.ts` can take it without importing
 * `components.ts`, which imports the themes.
 */

/**
 * What a hover rule on a control adds, so a disabled control, or one that
 * holds its place with aria-disabled, does not light up under the pointer.
 * `:where()` weighs nothing, so the guard changes no cascade outcome.
 */
export const ENABLED = ':where(:not(:disabled):not([aria-disabled="true"]))';
