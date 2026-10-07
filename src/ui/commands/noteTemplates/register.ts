import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { newNoteFromTemplate } from '../templates';
import { registerCommand } from '../runCommand';

/** New Note from Template, from the palette and from a folder in the Explorer. */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const { templates } = services.writes;
  context.subscriptions.push(
    registerCommand('deckard.newNoteFromTemplate', () =>
      newNoteFromTemplate(indexer, templates),
    ),
    // The Explorer passes the folder that was right-clicked.
    registerCommand('deckard.newNoteFromTemplateHere', (folder?: unknown) =>
      newNoteFromTemplate(indexer, templates, folder instanceof vscode.Uri ? folder : undefined),
    ),
  );
}
