import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { registerCommand } from '../runCommand';
import {
  copyFieldValue,
  COPY_FIELD_VALUE_COMMAND,
  CREATE_TYPE_COMMAND,
  CREATE_TYPE_ROW_COMMAND,
  createRowNote,
  createTypeFromTags,
  createTypeNote,
} from '../typeNotes';

/**
 * Types: Create Type from Tags…, and the commands the type quick fixes
 * and hovers run: Create person "Omar H", Create a <Type> type, and Copy
 * email (docs/implementation/30-databases.md).
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const writes = { indexer: services.indexer, history: services.history };
  context.subscriptions.push(
    registerCommand('deckard.createTypeFromTags', (namespace?: unknown) =>
      createTypeFromTags(writes, typeof namespace === 'string' ? namespace : undefined),
    ),
    registerCommand(CREATE_TYPE_ROW_COMMAND, (documentUri: unknown, typeKey: unknown, title: unknown) =>
      typeof typeKey === 'string' && typeof title === 'string'
        ? createRowNote(writes, {
            typeKey,
            title,
            ...(typeof documentUri === 'string' ? { near: vscode.Uri.parse(documentUri) } : {}),
            open: 'beside',
          })
        : undefined,
    ),
    registerCommand(CREATE_TYPE_COMMAND, (documentUri: unknown, type: unknown) => {
      const draft = readTypeArgument(type);
      return draft
        ? createTypeNote(writes, { ...draft, fields: [] }, typeof documentUri === 'string' ? vscode.Uri.parse(documentUri) : undefined)
        : undefined;
    }),
    registerCommand(COPY_FIELD_VALUE_COMMAND, (value: unknown) => copyFieldValue(value)),
  );
}

/** A quick fix's `{ key, name, rows }`, checked, since a command can be run with anything. */
function readTypeArgument(value: unknown): { key: string; name: string; rows: string } | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { key, name, rows } = value as Record<string, unknown>;
  return typeof key === 'string' && typeof name === 'string' && typeof rows === 'string' ? { key, name, rows } : undefined;
}
