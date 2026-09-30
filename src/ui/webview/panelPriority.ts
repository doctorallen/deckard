import * as vscode from 'vscode';

import { VIEW_PRIORITY } from '../../core/workspace/publishing';

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
