/**
 * Returns the page with every script and style sheet it loads from the
 * extension inlined, each carrying the page's nonce. See loadPage.js.
 */
export function loadPage(html: string, options?: { root?: string }): string;
/** The file a page asset's URI names, or undefined when it names something outside the extension. */
export function resolveAsset(uri: string, root: string): string | undefined;
/** The nonce the page's Content-Security-Policy names, if any. */
export function readPageNonce(html: string): string | undefined;
