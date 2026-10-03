/**
 * The Related Notes debug page's protocol, which is empty: the page runs no
 * script, so it sends nothing, and it is drawn whole each time it is shown,
 * so it is sent nothing either.
 */

/** What the debug page sends its host: nothing. */
export type RelatedNotesDebugPageToHost = Record<never, never>;

/** What the host sends the debug page: nothing, since its HTML is set anew. */
export type RelatedNotesDebugHostToPage = Record<never, never>;
