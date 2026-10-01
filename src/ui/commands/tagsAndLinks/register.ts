import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { getCommandTagArgument } from '../commandArguments';
import { extractHeadingCommand } from '../extractHeading';
import { linkCurrentHeading } from '../linkEntity';
import {
  CREATE_LINKED_NOTE_COMMAND,
  CREATE_MISSING_NOTES_COMMAND,
  createLinkedNote,
  createMissingNotes,
} from '../linkHealth';
import { renameHeadingCommand } from '../linkMaintenance';
import { moveInlineTagsToFrontmatter } from '../moveTagsToFrontmatter';
import { mergeIndexedTag, renameIndexedTag } from '../renameTag';
import { LINK_MENTIONS_COMMAND, linkMentions } from '../unlinkedMentions';

/**
 * Tags and links: the notes a link names, linking mentions, extracting and
 * linking a heading, renaming a heading, and moving, renaming, and merging
 * tags.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, history } = services;
  const { service: links, notes: linkNotes } = services.links;
  const tagWrites = services.writes.tags;
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CREATE_LINKED_NOTE_COMMAND,
      (documentUri: unknown, name: unknown) =>
        typeof documentUri === 'string' && typeof name === 'string'
          ? createLinkedNote(indexer, vscode.Uri.parse(documentUri), name, linkNotes)
          : undefined,
    ),
    vscode.commands.registerCommand(
      CREATE_MISSING_NOTES_COMMAND,
      (documentUri: unknown, names: unknown) =>
        typeof documentUri === 'string' &&
        Array.isArray(names) &&
        names.every((name) => typeof name === 'string')
          ? createMissingNotes(indexer, vscode.Uri.parse(documentUri), names, { notes: linkNotes })
          : undefined,
    ),
    vscode.commands.registerCommand(
      LINK_MENTIONS_COMMAND,
      (documentUri: unknown) =>
        typeof documentUri === 'string'
          ? linkMentions(indexer, history, vscode.Uri.parse(documentUri), links)
          : undefined,
    ),
    vscode.commands.registerCommand('deckard.extractHeading', () =>
      extractHeadingCommand(indexer, linkNotes),
    ),
    vscode.commands.registerCommand('deckard.linkCurrentHeading', () =>
      linkCurrentHeading(indexer),
    ),
    vscode.commands.registerCommand('deckard.moveTagsToFrontmatter', () =>
      moveInlineTagsToFrontmatter(),
    ),
    vscode.commands.registerCommand(
      'deckard.renameTag',
      (requestedTagKey?: unknown) =>
        renameIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
          tagWrites,
        ),
    ),
    vscode.commands.registerCommand('deckard.renameHeading', () =>
      renameHeadingCommand(indexer, history, links),
    ),
    vscode.commands.registerCommand(
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
