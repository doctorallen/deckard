import * as vscode from 'vscode';

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
  onDidUpdate(listener: () => void): vscode.Disposable;
  onDidUpdateView?(
    listener: () => void,
    options: ViewUpdateOptions,
  ): vscode.Disposable;
}

/**
 * Redraws a view after each index update in a host turn of its own, or, on an
 * index that cannot (a test's fake), as a plain listener.
 */
export function onIndexUpdateInTurn(
  source: ViewUpdateSource,
  options: ViewUpdateOptions,
  listener: () => void,
): vscode.Disposable {
  return source.onDidUpdateView
    ? source.onDidUpdateView(listener, options)
    : source.onDidUpdate(listener);
}

/** A webview panel's priority: in front, visible, or hidden (or not open). */
export function panelPriority(
  panel: Pick<vscode.WebviewPanel, 'active' | 'visible'> | undefined,
): number {
  if (!panel) {
    return VIEW_PRIORITY.hidden;
  }
  return panel.active
    ? VIEW_PRIORITY.active
    : panel.visible
      ? VIEW_PRIORITY.visible
      : VIEW_PRIORITY.hidden;
}

/** A side view's priority: visible or hidden (or not open). */
export function viewPriority(
  view: Pick<vscode.WebviewView, 'visible'> | undefined,
): number {
  return view?.visible ? VIEW_PRIORITY.visible : VIEW_PRIORITY.hidden;
}
