import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { registerCommand } from '../runCommand';
import {
  copyFieldValue,
  COPY_FIELD_VALUE_COMMAND,
  CREATE_TYPE_COMMAND,
  CREATE_TYPE_ROW_COMMAND,
  createTypeFromTags,
  createTypeNote,
} from '../typeNotes';
import { editActiveNoteFields, newTypedNote, openTypeNoteForm } from '../typeNoteForm';

/**
 * Types: Create Type from Tags…, New Note from Type…, Edit Fields… on the
 * note in front (docs/implementation/34-edit-fields-form.md), and the commands the
 * type quick fixes and hovers run: Create person "Omar H"…, which opens
 * the new note's form on its title, Create a <Type> type, and Copy email
 * (docs/implementation/30-databases.md, 31-type-note-form.md).
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const writes = { indexer: services.indexer, history: services.history };
  context.subscriptions.push(
    registerCommand('deckard.createTypeFromTags', (namespace?: unknown) =>
      createTypeFromTags(writes, typeof namespace === 'string' ? namespace : undefined),
    ),
    registerCommand('deckard.newTypedNote', () => newTypedNote(writes)),
    registerCommand('deckard.editFields', () => editActiveNoteFields(writes)),
    registerCommand(CREATE_TYPE_ROW_COMMAND, (documentUri: unknown, typeKey: unknown, title: unknown) =>
      typeof typeKey === 'string' && typeof title === 'string'
        ? openTypeNoteForm(writes, {
            typeKey,
            start: { title },
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
