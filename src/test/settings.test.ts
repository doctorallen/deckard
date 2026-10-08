import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  clearSetting,
  describeUnregisteredSetting,
  isUnregisteredSettingError,
  writeSetting,
} from '../ui/commands/settings';

suite('Settings writes', () => {
  test('tells the registry error apart from any other', () => {
    assert.ok(
      isUnregisteredSettingError(
        new Error(
          'Unable to write to User Settings because deckard.tasks.viewQuery is not a registered configuration.',
        ),
      ),
    );
    assert.ok(!isUnregisteredSettingError(new Error('EACCES: permission denied')));
    assert.ok(!isUnregisteredSettingError(undefined));
  });

  test('writes through, and reports success', async () => {
    const written: unknown[] = [];
    const ok = await writeSetting(
      'tasks.viewQuery',
      'is:open',
      vscode.ConfigurationTarget.Global,
      { update: async (...args: unknown[]) => void written.push(args) },
    );
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(written, [
      ['tasks.viewQuery', 'is:open', vscode.ConfigurationTarget.Global],
    ]);
  });

  test('turns an unregistered setting into a sentence, and says it did not write', async () => {
    const ok = await writeSetting(
      'tasks.viewQuery',
      'is:open',
      vscode.ConfigurationTarget.Global,
      {
        update: async () => {
          throw new Error(
            'Unable to write to User Settings because deckard.tasks.viewQuery is not a registered configuration.',
          );
        },
      },
    );
    assert.strictEqual(ok, false);
    assert.match(describeUnregisteredSetting('tasks.viewQuery'), /Quit and reopen VS Code/);
    assert.match(describeUnregisteredSetting('tasks.viewQuery'), /"Tasks: View Query" setting/);
    assert.doesNotMatch(describeUnregisteredSetting('tasks.viewQuery'), /deckard\.tasks/);
  });

  test('lets any other failure through as it was', async () => {
    await assert.rejects(
      writeSetting('tasks.viewQuery', 'is:open', vscode.ConfigurationTarget.Global, {
        update: async () => {
          throw new Error('EACCES: permission denied');
        },
      }),
      /EACCES/,
    );
  });

  test('clears where the value in force is set, and keeps a user value from showing through', async () => {
    const cleared = async (inspected: Record<string, unknown>) => {
      const written: unknown[] = [];
      await clearSetting('tasks.viewQuery', '', {
        inspect: () => ({ key: 'deckard.tasks.viewQuery', ...inspected }) as never,
        update: async (...args: unknown[]) => void written.push(args),
      });
      return written;
    };
    const { Global, Workspace } = vscode.ConfigurationTarget;
    assert.deepStrictEqual(await cleared({ globalValue: '#a' }), [['tasks.viewQuery', undefined, Global]]);
    assert.deepStrictEqual(await cleared({ workspaceValue: '#a' }), [['tasks.viewQuery', undefined, Workspace]]);
    assert.deepStrictEqual(await cleared({ globalValue: '', workspaceValue: '#a' }), [['tasks.viewQuery', undefined, Workspace]]);
    assert.deepStrictEqual(
      await cleared({ globalValue: '#b', workspaceValue: '#a' }),
      [['tasks.viewQuery', '', Workspace]],
      "the user's search would show through, so the workspace keeps an empty one",
    );
  });
});
