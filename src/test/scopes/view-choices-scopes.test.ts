import * as assert from 'assert';

import * as vscode from 'vscode';

import { readViewChoice } from '../../core/storage/preferencesViewChoices';
import { VIEW_CHOICE_CONTEXT_KEYS, VIEW_TOGGLES } from '../../ui/commands/toggles/viewToggles';
import { activateDeckard, isMultiRoot, recordContextKeys, settled } from './scopes';

/**
 * The Calendar's day panel and weekends, and the Outline following the
 * cursor, are kept in the preferences, the same whatever a workspace's
 * settings say. Each pair of commands turns its choice away from its
 * default and back, and the context key the view's title or menu reads
 * follows, so the view offers the command that changes something.
 */
suite(`View choices kept in the preferences (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  let contextKeys: ReturnType<typeof recordContextKeys>;

  suiteSetup(async () => {
    await activateDeckard();
    contextKeys = recordContextKeys();
  });

  suiteTeardown(() => contextKeys.dispose());

  for (const toggle of VIEW_TOGGLES) {
    test(`${toggle.choice}: its commands turn it from its default and back, and its context key follows`, async () => {
      const key = VIEW_CHOICE_CONTEXT_KEYS[toggle.choice];
      const fallback = readViewChoice({}, toggle.choice);
      for (const on of [!fallback, fallback]) {
        await vscode.commands.executeCommand(on ? toggle.enable : toggle.disable);
        assert.ok(
          await settled(() => contextKeys.value(key) === on),
          `${key} follows the choice to ${on}, not ${String(contextKeys.value(key))}`,
        );
      }
    });
  }
});
