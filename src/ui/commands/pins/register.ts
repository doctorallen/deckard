import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { setNotePinnedCommand } from '../pinNote';
import { registerCommand } from '../runCommand';

/** Pins: pinning and unpinning a note, or the tagged entry a hover names. */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, tryNext } = services;
  const pins = services.preferences.pins;
  context.subscriptions.push(
    // The hover on a tagged entry passes the line it was shown on, so it
    // pins that entry rather than wherever the cursor happens to be.
    registerCommand(
      'deckard.pinNote',
      async (documentUri?: unknown, line?: unknown) => {
        const pinned = await setNotePinnedCommand(
          indexer,
          pins,
          true,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        );
        if (pinned) {
          await tryNext.retire('pinNote');
        }
        return pinned;
      },
    ),
    registerCommand(
      'deckard.unpinNote',
      (documentUri?: unknown, line?: unknown) =>
        setNotePinnedCommand(
          indexer,
          pins,
          false,
          typeof documentUri === 'string' ? documentUri : undefined,
          typeof line === 'number' ? line : undefined,
        ),
    ),
  );
}
