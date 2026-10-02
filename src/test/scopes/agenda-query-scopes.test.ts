import * as assert from 'assert';

import * as vscode from 'vscode';

import { activateDeckard, arrange, arrangementsOf, clearEverywhere, deckard, isMultiRoot, levels } from './scopes';

/**
 * Clear Search in the Tasks view clears `deckard.agenda.query` so the view
 * lists every open task, wherever the search in force is set, and leaves
 * a user's search, which other windows read, alone when the workspace's
 * is the one in force.
 */
suite(`Clearing the Tasks view's search, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  suiteSetup(() => activateDeckard());

  teardown(() => clearEverywhere('agenda.query'));

  for (const arrangement of arrangementsOf('#project/atlas', 'due:today')) {
    test(`${arrangement.name}: Clear Search lists every open task`, async () => {
      await arrange('agenda.query', arrangement);

      await vscode.commands.executeCommand('deckard.clearAgendaQuery');

      assert.strictEqual(deckard().get('agenda.query'), '', `the window reads no search, ${JSON.stringify(levels('agenda.query'))}`);
      if (arrangement.values.workspace !== undefined) {
        assert.strictEqual(levels('agenda.query').user, arrangement.values.user, "the user's search is left alone");
      }
    });
  }
});
