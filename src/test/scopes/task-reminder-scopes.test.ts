import * as assert from 'assert';

import { turnOffReminders } from '../../ui/views/taskStatusBar';
import { activateDeckard, arrange, arrangementsOf, clearEverywhere, deckard, isMultiRoot, levels } from './scopes';

/**
 * The reminder's Turn Off Reminders clears `deckard.taskReminderTime`, so
 * no reminder comes, wherever the hour in force is set, and leaves a
 * user's hour, which other windows read, alone when the workspace's is the
 * one in force.
 */
suite(`Turning off task reminders, with settings at every level (${isMultiRoot() ? 'multi-root' : 'single folder'})`, () => {
  suiteSetup(() => activateDeckard());

  teardown(() => clearEverywhere('taskReminderTime'));

  for (const arrangement of arrangementsOf('09:00', '17:30')) {
    test(`${arrangement.name}: Turn Off Reminders leaves no hour in force`, async () => {
      await arrange('taskReminderTime', arrangement);

      assert.strictEqual(await turnOffReminders(), true);

      assert.strictEqual(deckard().get('taskReminderTime'), '', `the window reads no hour, ${JSON.stringify(levels('taskReminderTime'))}`);
      if (arrangement.values.workspace !== undefined) {
        assert.strictEqual(levels('taskReminderTime').user, arrangement.values.user, "the user's hour is left alone");
      }
    });
  }
});
