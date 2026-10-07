import * as vscode from 'vscode';

import { EntityNamespaceAliases, getEntityNamespaceAliases } from '../../domain/markdown/parser';
import { readTaskStatusSettings, type TaskStatusDefinition } from '../../domain/tasks/taskStatuses';

/**
 * The settings that decide how a line's tags are read, as the editor's
 * providers pass them to the parser. They are read in the scope of the
 * document being parsed, so each folder of a multi-root workspace can set
 * its own.
 */
export interface ParseOptions {
  /** `deckard.entityNamespaceAliases`, merged over the built-in aliases. */
  readonly entityNamespaceAliases: EntityNamespaceAliases;
  /** `deckard.tasks.statuses`: what each checkbox character means. */
  readonly taskStatuses: readonly TaskStatusDefinition[];
}

/** The parse settings for the document at `scope`. */
export function readParseOptions(scope: vscode.Uri): ParseOptions {
  const configuration = vscode.workspace.getConfiguration('deckard', scope);
  return {
    entityNamespaceAliases: getEntityNamespaceAliases(configuration.get<unknown>('entityNamespaceAliases', {})),
    taskStatuses: readTaskStatusSettings(configuration),
  };
}

/** `deckard.tasks.statuses` alone, in the scope of the document at `scope`, or the workspace's. */
export function readTaskStatusOptions(scope?: vscode.Uri): TaskStatusDefinition[] {
  return readTaskStatusSettings(vscode.workspace.getConfiguration('deckard', scope));
}

/**
 * `deckard.entityNamespaceAliases` alone, merged over the built-in aliases:
 * for a provider that recognizes entities but never reads inline tags on its
 * own, in its document's scope, or, with no scope, for reading a tag someone
 * typed the way the index read the notes, from the workspace as a whole.
 */
export function readEntityNamespaceAliases(scope?: vscode.Uri): EntityNamespaceAliases {
  return getEntityNamespaceAliases(
    vscode.workspace.getConfiguration('deckard', scope).get<unknown>('entityNamespaceAliases', {}),
  );
}
