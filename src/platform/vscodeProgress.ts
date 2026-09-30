import * as vscode from 'vscode';

import type { Progress } from '../ports/progress';

/**
 * Progress shown in the window's status bar, as `vscode.window.withProgress`
 * shows it at `ProgressLocation.Window`, with the title the caller gives and
 * no cancel button.
 */
export function createVscodeProgress(): Progress {
  return {
    withProgress: (title, task) =>
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title,
          cancellable: false,
        },
        (progress) => task(progress),
      ),
  };
}
