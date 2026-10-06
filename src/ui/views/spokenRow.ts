import type * as vscode from 'vscode';

import { speakProgressText } from '../../domain/tasks/progressCount';

/**
 * What a screen reader is given for a tree row whose description holds a
 * progress figure, "Atlas, 3 of 8 done, 38%" for "3/8 done (38%)", since
 * "3/8" can be read as a fraction or a date. Undefined for any other row,
 * which VS Code reads as it draws it.
 */
export function speakRow(label: string, description: string | undefined): vscode.AccessibilityInformation | undefined {
  if (!description) {
    return undefined;
  }
  const spoken = speakProgressText(description);
  return spoken === description ? undefined : { label: `${label}, ${spoken}` };
}
