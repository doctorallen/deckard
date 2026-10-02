import * as assert from 'assert';

import * as vscode from 'vscode';

import { createPreferences } from './preferenceServices';
import type { Task } from '../domain/model';
import { QuickFind } from '../ui/commands/quickFind';
import type { RowActionHost } from '../ui/commands/quickFindActions';
import { createTaskWrites } from './taskWrites';

/** Find's Edit task… opens the task's note first, and edits only there. */
suite('Find: Edit task', () => {
  test('a task whose note will not open is not edited in whatever editor is active', async () => {
    const workspace = vscode.workspace as unknown as Record<string, unknown>;
    const window = vscode.window as unknown as Record<string, unknown>;
    const commands = vscode.commands as unknown as Record<string, unknown>;
    const originals = [workspace.openTextDocument, window.showErrorMessage, commands.executeCommand] as const;
    const ran: unknown[][] = [];
    const errors: string[] = [];
    workspace.openTextDocument = async () => {
      throw new Error('The note was deleted.');
    };
    window.showErrorMessage = async (message: string) => void errors.push(message);
    commands.executeCommand = async (...call: unknown[]) => void ran.push(call);
    const find = new QuickFind({
      indexer: {} as never,
      preferences: createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never),
      actions: { openTag: async () => undefined, openSavedFilter: async () => undefined, showSearch: async () => undefined },
      writes: createTaskWrites(),
    });
    try {
      const host = (find as unknown as { rowActionHost(): RowActionHost }).rowActionHost();
      await host.editTask({ filePath: '/notes/deleted.md', lineNumber: 3, id: 't' } as Task);
    } finally {
      [workspace.openTextDocument, window.showErrorMessage, commands.executeCommand] = originals;
      find.dispose();
    }
    assert.deepStrictEqual(errors, ['Deckard could not open /notes/deleted.md.']);
    assert.deepStrictEqual(ran, [], 'Edit Task did not run on the editor that was active');
  });
});
