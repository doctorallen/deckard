import * as vscode from 'vscode';

import {
  activateDeckard,
  answerQuickPicks,
  arrange,
  arrangementsOf,
  assertWrittenWhereSet,
  clearEverywhere,
  isMultiRoot,
} from './scopes';

/**
 * Group Tasks By… writes `deckard.agenda.groupBy` (and, for a tag,
 * `deckard.agenda.groupNamespace`, through the same writer) where the
 * value in force is set, so the Tasks view groups as the reader chose in a
 * workspace that sets its own grouping too.
 */
suite(`The Tasks view's grouping, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  suiteSetup(() => activateDeckard());

  teardown(() => clearEverywhere('agenda.groupBy'));

  /** Chooses `grouping` in Group Tasks By…, as the reader would. */
  const groupBy = async (grouping: string): Promise<void> => {
    const answering = answerQuickPicks((items) => items.find((item) => (item as { id?: string }).id === grouping));
    try {
      await vscode.commands.executeCommand('deckard.agenda.setGrouping');
    } finally {
      answering.dispose();
    }
  };

  for (const arrangement of arrangementsOf('priority', 'status')) {
    test(`${arrangement.name}: Group Tasks By… changes what is in force, and back`, async () => {
      await arrange('agenda.groupBy', arrangement);
      await assertWrittenWhereSet('agenda.groupBy', groupBy, ['priority', 'status']);
    });
  }
});
