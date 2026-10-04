import * as vscode from 'vscode';

import { EditorToggle, isEditorToggleOn, readEditorPreset } from '../../domain/editor/editorPresets';

/**
 * Whether a `deckard.editor.*` switch is on for a note: its own value when
 * it was set at any scope, otherwise what `deckard.editor.preset` says.
 */
export function readEditorToggle(toggle: EditorToggle, scope?: vscode.Uri): boolean {
  const configuration = vscode.workspace.getConfiguration('deckard.editor', scope);
  const inspected = configuration.inspect<boolean>(toggle);
  const setByHand = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
  return isEditorToggleOn(toggle, readEditorPreset(configuration.get('preset')), setByHand);
}
