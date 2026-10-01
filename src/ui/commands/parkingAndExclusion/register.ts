import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { pickOutlineTag } from '../../views/outlineTree';
import { asOutlineNode, getCommandTagArgument } from '../commandArguments';
import { excludeFolderCommand, includeFolderCommand } from '../excludeFolders';
import { parkFolders, parkNotes, parkTag, unparkFolders, unparkNotes, unparkTag } from '../parking';

/**
 * Leaving notes out: excluding a folder from the index and taking it back,
 * and parking or unparking a note, a folder, or a tag.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const parkingCommands = services.writes.parking;
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.excludeFromIndex', (folder?: unknown) =>
      excludeFolderCommand(indexer, folder instanceof vscode.Uri ? folder : undefined),
    ),
    vscode.commands.registerCommand('deckard.includeInIndex', (folder?: unknown) =>
      includeFolderCommand(indexer, folder instanceof vscode.Uri ? folder : undefined),
    ),
    vscode.commands.registerCommand('deckard.parkNote', (uri?: unknown, uris?: unknown) =>
      parkNotes(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.unparkNote', (uri?: unknown, uris?: unknown) =>
      unparkNotes(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.parkFolder', (uri?: unknown, uris?: unknown) =>
      parkFolders(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.unparkFolder', (uri?: unknown, uris?: unknown) =>
      unparkFolders(parkingCommands, uri, uris),
    ),
    vscode.commands.registerCommand('deckard.parkTag', async (tag?: unknown) => {
      const outlineNode = asOutlineNode(tag);
      const key = outlineNode
        ? await pickOutlineTag(outlineNode, 'Choose a tag to park')
        : getCommandTagArgument(tag);
      if (outlineNode && !key) {
        return;
      }
      await parkTag(parkingCommands, key);
    }),
    vscode.commands.registerCommand('deckard.unparkTag', async (tag?: unknown) => {
      const outlineNode = asOutlineNode(tag);
      const key = outlineNode
        ? await pickOutlineTag(outlineNode, 'Choose a tag to unpark')
        : getCommandTagArgument(tag);
      if (outlineNode && !key) {
        return;
      }
      await unparkTag(parkingCommands, key);
    }),
  );
}
