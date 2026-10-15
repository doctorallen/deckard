import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { FILE_LINE_COMMAND, FILE_LINE_UNDER_COMMAND, fileLine, fileLineUnder, FileThisActions, SET_FIELD_FROM_LINE_COMMAND, setFieldFromLine } from '../fileThis';
import { registerCommand } from '../runCommand';

/**
 * File this (docs/implementation/43-file-this.md): the lightbulb's Set …,
 * Add this line to …’s notes, and File under… on a note's line, and the
 * commands they run, which the palette does not list: each needs the line
 * it was offered on.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const writes = { indexer: services.indexer, history: services.history, preferences: services.preferences.move };
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ pattern: '**/*.md' }, new FileThisActions(writes), {
      providedCodeActionKinds: FileThisActions.kinds,
    }),
    registerCommand(FILE_LINE_COMMAND, (documentUri: unknown, line: unknown, hubPath: unknown) => fileLine(writes, documentUri, line, hubPath)),
    registerCommand(FILE_LINE_UNDER_COMMAND, (documentUri: unknown, line: unknown) => fileLineUnder(writes, documentUri, line)),
    registerCommand(SET_FIELD_FROM_LINE_COMMAND, (...args: unknown[]) => setFieldFromLine(writes, ...args)),
  );
}
