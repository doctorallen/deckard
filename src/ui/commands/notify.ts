import * as path from 'path';

import * as vscode from 'vscode';

import { reportError } from '../../core/timing';

/**
 * How Deckard says that something did not happen.
 *
 * A failure says what did not happen and what to do about it, in the
 * reader's words; the raw error goes to Deckard's log, with **Open Log**
 * beside the message. Piece 8 routes every failure message through here.
 */

export interface MessageAction {
  /** The button, in Title Case: "Open Note". */
  title: string;
  run: () => unknown;
}

export interface Failure {
  /** What did not happen, and why, in the reader's words. Ends with a period. */
  outcome: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
  /** The raw error. Written to Deckard's log, never into the message. */
  error?: unknown;
  /** Error unless something was written. */
  severity?: 'error' | 'warning';
  /** At most one; Open Log follows it when there is an error. */
  action?: MessageAction;
}

const OPEN_LOG = 'Open Log';

/** The text and the buttons, in order. */
export function describeFailure(failure: Failure): { text: string; buttons: string[] } {
  return {
    text: failure.fix ? `${failure.outcome} ${failure.fix}` : failure.outcome,
    buttons: [
      ...(failure.action ? [failure.action.title] : []),
      ...(failure.error !== undefined ? [OPEN_LOG] : []),
    ],
  };
}

/** Shows a failure, logs its error, and runs the button chosen. */
export async function reportFailure(failure: Failure): Promise<void> {
  if (failure.error !== undefined) {
    reportError(failure.outcome, failure.error);
  }
  const { text, buttons } = describeFailure(failure);
  const choice =
    failure.severity === 'warning'
      ? await vscode.window.showWarningMessage(text, ...buttons)
      : await vscode.window.showErrorMessage(text, ...buttons);
  if (choice === OPEN_LOG) {
    await vscode.commands.executeCommand('deckard.showLog');
  } else if (choice && choice === failure.action?.title) {
    await failure.action.run();
  }
}

/** A note as a message names it: its file name, extension and all. */
export function noteName(uri: vscode.Uri): string {
  return path.basename(uri.path);
}

/** The one sentence for notes that changed after Deckard last read them. */
export function describeStale(names: readonly string[]): string {
  return names.length === 1
    ? `${names[0]} changed after Deckard last read it, so nothing was written.`
    : `${names.length} notes changed after Deckard last read them, so nothing was written.`;
}

/** Says a note changed underneath, with Open Note when there is one. */
export async function reportStale(uris: readonly vscode.Uri[]): Promise<void> {
  await reportFailure({
    outcome: describeStale(uris.map(noteName)),
    ...(uris.length === 1 ? { action: openNoteAction(uris[0]) } : {}),
  });
}

/** VS Code refused an edit to a note. */
export function describeRejectedEdit(name: string): Pick<Failure, 'outcome' | 'fix'> {
  return {
    outcome: `VS Code did not accept the change to ${name}, so nothing was written.`,
    fix: 'Check that the note is not read-only, then try again.',
  };
}

/** The Open Note button: opens the note and puts the focus in it. */
export function openNoteAction(uri: vscode.Uri): MessageAction {
  return {
    title: 'Open Note',
    run: async () =>
      vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), {
        preview: false,
      }),
  };
}

/**
 * A setting as the Settings editor labels it, for a message to quote:
 * 'mcpServer.port' becomes 'MCP Server: Port', 'templatesFolder' becomes
 * 'Templates Folder'. The key is the part after `deckard.`.
 */
export function settingLabel(key: string): string {
  const words = (segment: string) =>
    segment
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) =>
        word.toLowerCase() === 'mcp' ? 'MCP' : word[0].toUpperCase() + word.slice(1),
      )
      .join(' ');
  const segments = key.replace(/^deckard\./, '').split('.').map(words);
  const last = segments.pop() ?? '';
  return segments.length ? `${segments.join(' › ')}: ${last}` : last;
}

/** The Open Setting button for `deckard.<key>`. */
export function openSettingAction(key: string): MessageAction {
  return {
    title: 'Open Setting',
    run: () =>
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `deckard.${key.replace(/^deckard\./, '')}`,
      ),
  };
}

/** The Reindex button: reads every note again. */
export function reindexAction(): MessageAction {
  return {
    title: 'Reindex',
    run: () => vscode.commands.executeCommand('deckard.reindexWorkspace'),
  };
}

/** A tag asked for by key that no note has, or has any more. */
export function describeMissingTag(key: string): string {
  return `Deckard found no tag ${key.startsWith('#') ? key : `#${key}`} in your notes. It may have been renamed or merged.`;
}

/** What a command that creates notes says when no folder is open. */
export const NEEDS_FOLDER = 'Open a folder first: Deckard creates notes inside it.';

/** Says a folder is needed, with Open Folder…, which shows the dialog. */
export async function reportNeedsFolder(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(NEEDS_FOLDER, 'Open Folder…');
  if (choice === 'Open Folder…') {
    await vscode.commands.executeCommand('vscode.openFolder');
  }
}
