import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  describeUnregisteredSetting,
  isUnregisteredSettingError,
  writeSetting,
} from '../ui/commands/settings';

suite('Settings writes', () => {
  test('tells the registry error apart from any other', () => {
    assert.ok(
      isUnregisteredSettingError(
        new Error(
          'Unable to write to User Settings because deckard.agenda.groupBy is not a registered configuration.',
        ),
      ),
    );
    assert.ok(!isUnregisteredSettingError(new Error('EACCES: permission denied')));
    assert.ok(!isUnregisteredSettingError(undefined));
  });

  test('writes through, and reports success', async () => {
    const written: unknown[] = [];
    const ok = await writeSetting(
      'agenda.groupBy',
      'priority',
      vscode.ConfigurationTarget.Global,
      { update: async (...args: unknown[]) => void written.push(args) },
    );
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(written, [
      ['agenda.groupBy', 'priority', vscode.ConfigurationTarget.Global],
    ]);
  });

  test('turns an unregistered setting into a sentence, and says it did not write', async () => {
    const ok = await writeSetting(
      'agenda.groupBy',
      'priority',
      vscode.ConfigurationTarget.Global,
      {
        update: async () => {
          throw new Error(
            'Unable to write to User Settings because deckard.agenda.groupBy is not a registered configuration.',
          );
        },
      },
    );
    assert.strictEqual(ok, false);
    assert.match(describeUnregisteredSetting('agenda.groupBy'), /Quit and reopen VS Code/);
    assert.match(describeUnregisteredSetting('agenda.groupBy'), /deckard\.agenda\.groupBy/);
  });

  test('lets any other failure through as it was', async () => {
    await assert.rejects(
      writeSetting('agenda.groupBy', 'priority', vscode.ConfigurationTarget.Global, {
        update: async () => {
          throw new Error('EACCES: permission denied');
        },
      }),
      /EACCES/,
    );
  });
});
