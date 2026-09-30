import * as vscode from 'vscode';

import {
  EntityNamespaceAliases,
  getEntityNamespaceAliases,
  getPersonMarker,
} from '../../domain/markdown/parser';

/**
 * The settings that decide how a line's tags are read, as the editor's
 * providers pass them to the parser. They are read in the scope of the
 * document being parsed, so each folder of a multi-root workspace can set
 * its own.
 */
export interface ParseOptions {
  /** `deckard.parseInlineTags`: whether a tag on a line that is not a heading makes that line an entry. */
  readonly parseInlineTags: boolean;
  /** `deckard.entityNamespaceAliases`, merged over the built-in aliases. */
  readonly entityNamespaceAliases: EntityNamespaceAliases;
  /** `deckard.personMarker`, or `@` when the setting is not one allowed character. */
  readonly personMarker: string;
}

/** All three parse settings for the document at `scope`. */
export function readParseOptions(scope: vscode.Uri): ParseOptions {
  const configuration = vscode.workspace.getConfiguration('deckard', scope);
  return {
    parseInlineTags: configuration.get<boolean>('parseInlineTags', true),
    entityNamespaceAliases: getEntityNamespaceAliases(configuration.get<unknown>('entityNamespaceAliases', {})),
    personMarker: getPersonMarker(configuration.get<unknown>('personMarker', '@')),
  };
}

/**
 * `deckard.entityNamespaceAliases` alone, for a provider that recognizes
 * entities but never reads inline tags on its own.
 */
export function readEntityNamespaceAliases(scope: vscode.Uri): EntityNamespaceAliases {
  return getEntityNamespaceAliases(
    vscode.workspace.getConfiguration('deckard', scope).get<unknown>('entityNamespaceAliases', {}),
  );
}

/**
 * `deckard.personMarker` alone, for completion, which must know the marker
 * before it reads anything else on the line.
 */
export function readPersonMarker(scope: vscode.Uri): string {
  return getPersonMarker(vscode.workspace.getConfiguration('deckard', scope).get<unknown>('personMarker', '@'));
}
