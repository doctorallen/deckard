import type { Disposable } from '../../ports/events';

/**
 * How soon a view redraws after the index changes, lowest first. A save used
 * to redraw every open view back to back in one turn of the extension host,
 * so the one in front waited on the ones behind it, and so did every other
 * extension.
 */
export const VIEW_PRIORITY = {
  /** The editor-area panel in front. */
  active: 0,
  /** A panel, side view, or editor the reader can see. */
  visible: 1,
  /** Hidden: its refresh only notes that it is out of date. */
  hidden: 2,
  /** Bookkeeping nothing on screen waits for. */
  housekeeping: 3,
} as const;

/** What a view says about itself when it asks to redraw in a turn of its own. */
export interface ViewUpdateOptions {
  /** Named in the log: "Refresh {name} after an index update". */
  name: string;
  /** Read when the index is published, so it says what is on screen then. */
  priority: () => number;
}

/**
 * An index that can publish to views one host turn at a time. A view reads
 * the index when its turn comes, so the listener is given nothing.
 */
export interface ViewUpdateSource {
  onDidUpdate(listener: () => void): Disposable;
  onDidUpdateView?(
    listener: () => void,
    options: ViewUpdateOptions,
  ): Disposable;
}

/**
 * Redraws a view after each index update in a host turn of its own, or, on an
 * index that cannot (a test's fake), as a plain listener.
 */
export function onIndexUpdateInTurn(
  source: ViewUpdateSource,
  options: ViewUpdateOptions,
  listener: () => void,
): Disposable {
  return source.onDidUpdateView
    ? source.onDidUpdateView(listener, options)
    : source.onDidUpdate(listener);
}

/**
 * Resolves once the index has something to show: the notes as the cache
 * last saw them on a warm start, or the first scan. A surface that only
 * displays notes waits for this; one that writes, or answers for the whole
 * workspace, waits for `ready`, when the notes have been checked.
 */
export function whenPublished(source: {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
}): Promise<void> {
  return source.published ?? source.ready;
}
