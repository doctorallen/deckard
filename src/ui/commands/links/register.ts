import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { extractHeadingCommand } from '../extractHeading';
import { linkCurrentHeading } from '../linkEntity';
import {
  CREATE_LINKED_NOTE_COMMAND,
  CREATE_MISSING_NOTES_COMMAND,
  createLinkedNote,
  createMissingNotes,
} from '../linkHealth';
import { renameHeadingCommand } from '../linkMaintenance';
import { LINK_MENTIONS_COMMAND, linkMentions } from '../unlinkedMentions';
import { registerCommand } from '../runCommand';

/**
 * Links: the notes a link names, linking mentions, extracting and linking a
 * heading, and renaming a heading with the links to it.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, history } = services;
  const { service: links, notes: linkNotes } = services.links;
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
    registerCommand('deckard.renameHeading', () =>
      renameHeadingCommand(indexer, history, links),
    ),
  );
}
