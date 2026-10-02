import * as assert from 'assert';

import * as vscode from 'vscode';

import { outlineFollowCursorContextKey } from '../../ui/views/outlineTree';
import {
  activateDeckard,
  arrange,
  arrangementsOf,
  assertWrittenWhereSet,
  clearEverywhere,
  deckard,
  isMultiRoot,
  recordContextKeys,
  settled,
} from './scopes';

/**
 * The Outline's Follow Cursor buttons write `deckard.outline.followCursor`
 * where the value in force is set, so a workspace that sets it is followed
 * or not as the reader asks, and the title's button follows.
 */
suite(`The Outline following the cursor, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  let contextKeys: ReturnType<typeof recordContextKeys>;

  suiteSetup(async () => {
    await activateDeckard();
    contextKeys = recordContextKeys();
  });

  suiteTeardown(() => contextKeys.dispose());

  teardown(() => clearEverywhere('outline.followCursor'));

  /** Runs the button the reader is offered for `value`, and waits for the title to follow. */
  const follow = async (value: boolean): Promise<void> => {
    await vscode.commands.executeCommand(value ? 'deckard.outline.enableFollowCursor' : 'deckard.outline.disableFollowCursor');
    assert.ok(
      await settled(() => contextKeys.value(outlineFollowCursorContextKey) === deckard().get('outline.followCursor')),
      `the title's button follows the setting, not ${String(contextKeys.value(outlineFollowCursorContextKey))}`,
    );
  };

  for (const arrangement of arrangementsOf(false, true)) {
    test(`${arrangement.name}: the buttons change what is in force, and back`, async () => {
      await arrange('outline.followCursor', arrangement);
      await assertWrittenWhereSet('outline.followCursor', follow, [false, true]);
    });
  }
});
