import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { registerCommand } from '../runCommand';

/**
 * Undo Last Change: takes back the latest write Deckard made, from any
 * command, view, or page, then reads the notes again.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, history } = services;
  context.subscriptions.push(
    registerCommand('deckard.undoLastChange', () =>
      history.undoLast(() => indexer.refresh()),
    ),
  );
}
