/**
 * An element and everything under it as normalized HTML, as the DOM recorder
 * and the contrast check's drawn surfaces read it. See domSnapshot.js.
 */
export function normalizeBody(body: Element, options?: { nonce?: string; captured?: boolean }): string;

/** The same normalized HTML without the whitespace between tags. */
export function withoutSpacing(normalized: string): string;
