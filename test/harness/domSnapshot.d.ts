/**
 * An element and everything under it as normalized HTML, as test:dom and
 * the DOM recorder compare two drawings. See domSnapshot.js.
 */
export function normalizeBody(body: Element, options?: { nonce?: string; captured?: boolean }): string;

/** The same normalized HTML without the whitespace between tags. */
export function withoutSpacing(normalized: string): string;
