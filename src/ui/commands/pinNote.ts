import * as vscode from 'vscode';

import { pinKey } from '../../core/storage/preferences';
import { PinnedNote, WorkspaceIndex } from '../../core/types';
import { createPinForLine, resolvePin } from '../state/pinnedNotes';

/**
 * Pinning the note you are in, wherever you are in it.
 *
 * A note is an entry, so pinning happens where an entry is in front of you:
 * the cursor in a Markdown editor, a result on a search page, or the hover
 * that already offers that entry's related notes. Home shows the pins; it no
 * longer offers to make one, because Home is the one place where the note
 * being pinned is not in front of the reader.
 */

interface PinIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
}

interface PinStore {
  pinNote(pin: PinnedNote): Promise<void>;
  unpinNote(key: string): Promise<void>;
  isPinned(key: string): boolean;
}

/** Where a pin is being made from: a note, and a line in it. */
export interface PinTarget {
  filePath: string;
  line: number;
}

/**
 * Pins or unpins the entry at a line, and says which entry it was.
 *
 * Returns the pin it made or removed, or nothing when there was nothing at
 * that line to pin.
 */
export async function setPinned(
  index: WorkspaceIndex,
  preferences: PinStore,
  target: PinTarget,
  pinned: boolean,
): Promise<PinnedNote | undefined> {
  const pin = createPinForLine(index, target.filePath, target.line);
  if (!pin) {
    void vscode.window.showInformationMessage(
      'Deckard has not indexed that note yet, so it cannot be pinned.',
    );
    return undefined;
  }
  const name = resolvePin(index, pin)?.title ?? pin.filePath;
  const key = pinKey(pin);

  if (pinned) {
    if (preferences.isPinned(key)) {
      void vscode.window.showInformationMessage(
        `"${name}" is already pinned to Home.`,
      );
      return pin;
    }
    await preferences.pinNote(pin);
    // Pinning is one keystroke from a command palette, so the way back is
    // offered where the pin is announced rather than left to be found.
    void offerUndo(`Pinned "${name}" to Home.`, () =>
      preferences.unpinNote(key),
    );
    return pin;
  }

  if (!preferences.isPinned(key)) {
    void vscode.window.showInformationMessage(
      `"${name}" is not pinned to Home.`,
    );
    return undefined;
  }
  await preferences.unpinNote(key);
  void offerUndo(`Unpinned "${name}" from Home.`, () =>
    preferences.pinNote(pin),
  );
  return pin;
}

/** Says what was done, with the way back beside it. */
async function offerUndo(
  message: string,
  undo: () => Promise<void>,
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(message, 'Undo');
  if (choice === 'Undo') {
    await undo();
  }
}

/**
 * The command: the entry the cursor is in, or the one a hover link names.
 *
 * The hover passes the line it was shown on, so pinning from there pins the
 * entry the hover was about rather than wherever the cursor happens to be.
 */
export async function setNotePinnedCommand(
  indexer: PinIndexSource,
  preferences: PinStore,
  pinned: boolean,
  documentUri?: string,
  line?: number,
): Promise<PinnedNote | undefined> {
  await indexer.ready;
  const uri =
    documentUri !== undefined
      ? vscode.Uri.parse(documentUri)
      : vscode.window.activeTextEditor?.document.uri;
  if (!uri || !indexer.isNotesFile(uri)) {
    void vscode.window.showInformationMessage(
      'Open a note in the notes folder to pin it to Home.',
    );
    return undefined;
  }
  const at =
    line ?? (vscode.window.activeTextEditor?.selection.active.line ?? 0) + 1;
  return setPinned(
    indexer.getSnapshot(),
    preferences,
    { filePath: indexer.getFilePath(uri), line: at },
    pinned,
  );
}

/** The hover link that pins the entry it is shown on. */
export function createPinHoverUri(
  documentUri: string,
  lineNumber: number,
  pinned: boolean,
): vscode.Uri {
  return vscode.Uri.parse(
    `command:${pinned ? 'deckard.unpinNote' : 'deckard.pinNote'}?${encodeURIComponent(
      JSON.stringify([documentUri, lineNumber]),
    )}`,
  );
}
