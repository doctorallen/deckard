import * as vscode from 'vscode';

import { chooseNoteTarget, NoteTarget, readNoteTarget } from '../../domain/notes/noteTarget';
import { openResultAt, ResultOpening } from './navigation';

/** How a note was asked for: beside the page, kept, and whether Shift asked for the other place. */
export interface NoteOpening extends ResultOpening {
  /** Shift was held: open it where `deckard.openNotesIn` does not. */
  opposite?: boolean;
}

/** Where `deckard.openNotesIn` opens a note: the editor unless it says `page`. */
export function readOpenNotesIn(): NoteTarget {
  return readNoteTarget(vscode.workspace.getConfiguration('deckard').get<unknown>('openNotesIn', 'editor'));
}

/**
 * Opens a note or an entry where the reader reads them: in the editor at
 * its line, as a result has always opened, or on the note page scrolled to
 * it, as `deckard.openNotesIn` says, the other way when Shift was held.
 * Every page, the Hubs view, Find, and the breadcrumb lens open a note
 * through here.
 */
export async function openNoteAt(filePath: string, line: number, how: NoteOpening = {}): Promise<void> {
  if (chooseNoteTarget(readOpenNotesIn(), how.opposite === true) === 'page') {
    await vscode.commands.executeCommand('deckard.openNotePage', filePath, line, { beside: how.beside === true });
    return;
  }
  await openResultAt(filePath, line, { ...(how.beside ? { beside: true } : {}), ...(how.pin ? { pin: true } : {}) });
}
