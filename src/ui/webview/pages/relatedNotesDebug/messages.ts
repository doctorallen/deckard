/**
 * The Related Notes debug page's narrowing table, which is empty: the page
 * runs no script, so anything that arrives is refused.
 */
import type { RelatedNotesDebugPageToHost } from '../../../protocol/relatedNotesDebug';
import { NarrowingTable, narrowWith } from '../../host/narrowing';

/** The messages the debug page may send: none. */
export const RELATED_NOTES_DEBUG_MESSAGES: NarrowingTable<RelatedNotesDebugPageToHost> = {};

/** Refuses whatever arrives, since the debug page sends nothing. */
export const narrowRelatedNotesDebugMessage = narrowWith(RELATED_NOTES_DEBUG_MESSAGES);
