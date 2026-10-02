/**
 * Selector pieces the style sheets under src/webview write by hand, named
 * once so a test can look for them (components-primitives.test.ts).
 */

/**
 * What a hover rule on a control adds, so a disabled control, or one that
 * holds its place with aria-disabled, does not light up under the pointer.
 * `:where()` weighs nothing, so the guard changes no cascade outcome.
 */
export const ENABLED = ':where(:not(:disabled):not([aria-disabled="true"]))';
