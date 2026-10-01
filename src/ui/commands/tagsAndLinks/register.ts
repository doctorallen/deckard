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
import { registerCommand } from '../runCommand';

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
    registerCommand(
      CREATE_LINKED_NOTE_COMMAND,
      (documentUri: unknown, name: unknown) =>
        typeof documentUri === 'string' && typeof name === 'string'
          ? createLinkedNote(indexer, vscode.Uri.parse(documentUri), name, linkNotes)
          : undefined,
    ),
    registerCommand(
      CREATE_MISSING_NOTES_COMMAND,
      (documentUri: unknown, names: unknown) =>
        typeof documentUri === 'string' &&
        Array.isArray(names) &&
        names.every((name) => typeof name === 'string')
          ? createMissingNotes(indexer, vscode.Uri.parse(documentUri), names, { notes: linkNotes })
          : undefined,
    ),
    registerCommand(
      LINK_MENTIONS_COMMAND,
      (documentUri: unknown) =>
        typeof documentUri === 'string'
          ? linkMentions(indexer, history, vscode.Uri.parse(documentUri), links)
          : undefined,
    ),
    registerCommand('deckard.extractHeading', () =>
      extractHeadingCommand(indexer, linkNotes),
    ),
    registerCommand('deckard.linkCurrentHeading', () =>
      linkCurrentHeading(indexer),
    ),
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
    registerCommand('deckard.renameHeading', () =>
      renameHeadingCommand(indexer, history, links),
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
