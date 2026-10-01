/**
 * A recorder for one mounted page, which writes its normalized body after
 * each step when DECKARD_DOM_RECORD names a folder, and does nothing otherwise.
 * See domRecorder.js.
 */
export function createDomRecorder(document: Document, html: string): { record(step: string): void };
