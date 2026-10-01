import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { getCommandTagArgument } from '../commandArguments';
import { moveInlineTagsToFrontmatter } from '../moveTagsToFrontmatter';
import { mergeIndexedTag, renameIndexedTag } from '../renameTag';
import { registerCommand } from '../runCommand';

/** Tag editing: moving a note's tags to its frontmatter, and renaming and merging a tag. */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const tagWrites = services.writes.tags;
  context.subscriptions.push(
    registerCommand('deckard.moveTagsToFrontmatter', () =>
      moveInlineTagsToFrontmatter(),
    ),
    registerCommand(
      'deckard.renameTag',
      (requestedTagKey?: unknown) =>
        renameIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
          tagWrites,
        ),
    ),
    registerCommand(
      'deckard.mergeTag',
      (requestedTagKey?: unknown, requestedTargetKey?: unknown) =>
        mergeIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
          tagWrites,
          getCommandTagArgument(requestedTargetKey),
        ),
    ),
  );
}
