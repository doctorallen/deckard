import * as assert from 'assert';

import * as vscode from 'vscode';

import { activateDeckard, arrange, arrangementsOf, clearEverywhere, deckard, isMultiRoot, levels } from './scopes';

/**
 * Clear Search in the Tasks view clears `deckard.tasks.viewQuery` so the view
 * lists every open task, wherever the search in force is set, and leaves
 * a user's search, which other windows read, alone when the workspace's
 * is the one in force.
 */
suite(`Clearing the Tasks view's search, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  suiteSetup(() => activateDeckard());

  teardown(() => clearEverywhere('tasks.viewQuery'));

  for (const arrangement of arrangementsOf('#project/atlas', 'due:today')) {
    test(`${arrangement.name}: Clear Search lists every open task`, async () => {
      await arrange('tasks.viewQuery', arrangement);

      await vscode.commands.executeCommand('deckard.clearAgendaQuery');

      assert.strictEqual(deckard().get('tasks.viewQuery'), '', `the window reads no search, ${JSON.stringify(levels('tasks.viewQuery'))}`);
      if (arrangement.values.workspace !== undefined) {
        assert.strictEqual(levels('tasks.viewQuery').user, arrangement.values.user, "the user's search is left alone");
      }
    });
  }
});
