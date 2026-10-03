import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { getCommandTagArgument } from '../commandArguments';
import { registerCommand } from '../runCommand';

/**
 * Find: Find in Notes, which opens Find on a query when one is given, and
 * the keys Find answers while it is open.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { quickFind } = services;
  context.subscriptions.push(
    registerCommand(
      'deckard.searchWorkspace',
      (initialQuery?: unknown) =>
        quickFind.show(getCommandTagArgument(initialQuery)),
    ),
    registerCommand('deckard.quickFind.complete', () =>
      quickFind.complete(),
    ),
    registerCommand('deckard.quickFind.openBeside', () =>
      quickFind.openBeside(),
    ),
    registerCommand('deckard.quickFind.insertLink', () =>
      quickFind.insertLinkFromActive(),
    ),
    registerCommand('deckard.quickFind.actions', () =>
      quickFind.showActions(),
    ),
  );
}
