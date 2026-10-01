import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { capture } from '../capture';
import { newNoteFromTemplate } from '../templates';

/** Capture, to today's note or under a heading, and New Note from Template. */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const { capture: captureContext, templates } = services.writes;
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.capture', () =>
      capture(captureContext, 'today'),
    ),
    vscode.commands.registerCommand('deckard.captureUnderHeading', () =>
      capture(captureContext, 'heading'),
    ),
    vscode.commands.registerCommand('deckard.newNoteFromTemplate', () =>
      newNoteFromTemplate(indexer, templates),
    ),
    // The Explorer passes the folder that was right-clicked.
    vscode.commands.registerCommand('deckard.newNoteFromTemplateHere', (folder?: unknown) =>
      newNoteFromTemplate(indexer, templates, folder instanceof vscode.Uri ? folder : undefined),
    ),
  );
}
