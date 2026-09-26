import * as vscode from 'vscode';

import { findFencedLines } from '../../core/markdown/parser';

/** Context key for whether a section is focused, which offers the way back. */
export const SECTION_FOCUSED = 'deckard.sectionFocused';

/** The note a section was focused in, so leaving it clears the state. */
let focusedIn: string | undefined;

/** The zero-based line of the heading a line is under, outside code. */
export function findHeadingLineAbove(lines: readonly string[], line: number): number | undefined {
  const fenced = findFencedLines([...lines]);
  for (let at = Math.min(line, lines.length - 1); at >= 0; at -= 1) {
    if (!fenced.has(at) && /^#{1,6}[ \t]/.test(lines[at])) {
      return at;
    }
  }
  return undefined;
}

/** What Focus Section runs, so a test can watch it. */
export interface FocusDeps {
  execute(command: string, ...args: unknown[]): Thenable<unknown>;
  inform(message: string): void;
}

const defaultDeps: FocusDeps = {
  execute: (command, ...args) => vscode.commands.executeCommand(command, ...args),
  inform: (message) => void vscode.window.showInformationMessage(message),
};

/**
 * Folds everything in the note except one section, and opens that section's
 * own sub-headings: a way to write in one part of a long note with the rest
 * out of sight. `headingLine` is one-based, from the Outline; otherwise the
 * section is the one the cursor is in.
 */
export async function focusSectionCommand(
  headingLine?: number,
  deps: FocusDeps = defaultDeps,
): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    deps.inform('Put the cursor under a heading to focus its section.');
    return false;
  }
  const document = editor.document;
  if (
    vscode.workspace
      .getConfiguration('editor', { uri: document.uri, languageId: document.languageId })
      .get<boolean>('folding', true) === false
  ) {
    deps.inform('Focus Section folds the rest of the note, and folding is turned off (editor.folding).');
    return false;
  }
  const lines = Array.from({ length: document.lineCount }, (_, at) => document.lineAt(at).text);
  const heading =
    headingLine !== undefined ? headingLine - 1 : findHeadingLineAbove(lines, editor.selection.active.line);
  if (heading === undefined) {
    deps.inform('Put the cursor under a heading to focus its section.');
    return false;
  }
  const position = new vscode.Position(heading, 0);
  editor.selection = new vscode.Selection(position, position);
  await deps.execute('editor.foldAllExcept');
  await deps.execute('editor.unfoldRecursively');
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
  await deps.execute('setContext', SECTION_FOCUSED, true);
  focusedIn = document.uri.toString();
  return true;
}

/** Unfolds every section again, after Focus Section. */
export async function unfoldAllSectionsCommand(deps: FocusDeps = defaultDeps): Promise<void> {
  await deps.execute('editor.unfoldAll');
  await deps.execute('setContext', SECTION_FOCUSED, false);
  focusedIn = undefined;
}

/** Clears the focused state when the editor moves to another note. */
export function trackSectionFocus(): vscode.Disposable {
  return vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (focusedIn !== undefined && editor?.document.uri.toString() !== focusedIn) {
      focusedIn = undefined;
      void vscode.commands.executeCommand('setContext', SECTION_FOCUSED, false);
    }
  });
}
