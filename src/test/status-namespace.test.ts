import * as assert from 'assert';

import * as vscode from 'vscode';

import { createQueryContext } from '../domain/query/queryContext';
import { readTaskBoardOptions } from '../ui/commands/taskBoardActions';

/**
 * `deckard.board.statusNamespace` names the tag namespace a task's status
 * is written in. settings.json is edited by hand, so it can hold anything.
 */
suite('The status namespace setting', () => {
  const configuration = () => vscode.workspace.getConfiguration('deckard');
  const write = (value: unknown) => configuration().update('board.statusNamespace', value, vscode.ConfigurationTarget.Global);

  teardown(() => write(undefined));

  test('a value that is not a string reads as status, as an empty one does', async () => {
    for (const value of [null, ['doing'], 7, '']) {
      await write(value);
      assert.strictEqual(readTaskBoardOptions(createQueryContext(Date.now())).statusNamespace, 'status', JSON.stringify(value));
    }
  });
});
