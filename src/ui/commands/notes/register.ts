import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { noteActionsCommand, openRelatedNotesCommand } from '../noteActions';
import { copyAsPlainMarkdownCommand } from '../copyPlainMarkdown';
import { registerCommand } from '../runCommand';

/**
 * Note Actions: the menu of what can be done where the cursor is in a note.
 * It reads the pins to offer Pin or Unpin, but runs every action through
 * its own command, so it belongs to none of the features it lists. Open
 * Related Notes, one of its rows, for the entry the cursor is in or the
 * note. And Copy as Plain Markdown, which writes the note out for elsewhere.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const pins = services.preferences.pins;
  context.subscriptions.push(
    registerCommand('deckard.noteActions', () =>
      noteActionsCommand({ index: indexer, preferences: pins }),
    ),
    registerCommand('deckard.openRelatedNotes', () =>
      openRelatedNotesCommand({ index: indexer, preferences: pins }),
    ),
    registerCommand('deckard.copyAsPlainMarkdown', () => copyAsPlainMarkdownCommand(indexer)),
  );
}
