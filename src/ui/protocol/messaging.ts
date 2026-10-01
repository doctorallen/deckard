/**
 * The shapes every page's protocol is built from. A page declares its
 * messages once in each direction as a map from type to message, so the
 * host's handlers, the page's narrowing table, and the page's own code are
 * all keyed by the same names, and a renamed field fails to compile on both
 * sides.
 */

/** A message between a page and its host: anything with a `type`. */
export interface PageMessage {
  type: string;
}

/**
 * A page's messages in one direction, keyed by type: each member's `type`
 * is its key, as in `{ openTag: OpenTagMessage }`.
 */
export type MessageMap<M> = { [K in keyof M]: { type: K } };

/** Any one message of a map: the union a handler map and a table cover. */
export type MessageOf<M> = M[keyof M];

/**
 * One type of a message that serves several, such as Park Tag and Unpark
 * Tag, as a map lists it under each: the shared shape, with `type` the key
 * it is listed under, as in `{ parkTag: MessageAs<ParkTagMessage, 'parkTag'> }`.
 */
export type MessageAs<M extends PageMessage, T extends M['type']> = M & { type: T };

/**
 * Carried by a message that expects an answer, and by the answer, so the
 * page can tell which of its requests a reply is about. The page mints the
 * id; the host only hands it back.
 */
export interface Correlated {
  requestId: number;
}

/** The host's whole snapshot of what a page draws, sent after every change. */
export interface StateMessage<TSnapshot> {
  type: 'state';
  data: TSnapshot;
}

/**
 * How far the first scan has got, sent until the index is ready, which a
 * page writes into its loading line; `null` before the scan has counted
 * the notes.
 */
export interface IndexingMessage {
  type: 'indexing';
  progress: { completed: number; total: number } | null;
}
