import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { offerStatusMigrationOnce, STATUS_MOVE_NOTICED } from '../ui/commands/statusMove';

function memento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: <T>(key: string, fallback?: T) => (store.has(key) ? (store.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => void store.set(key, value),
  };
}

suite('The status-tag move notice', () => {
  test('is said once per workspace, while a task still keeps its status in a tag', async () => {
    const index = buildWorkspaceIndex(new Map([['plan.md', parseMarkdown('plan.md', '# Plan\n- [ ] Draft the brief #status/doing\n')]]));
    const shown: string[][] = [];
    const ran: string[] = [];
    const options = {
      show: async (message: string, ...buttons: string[]) => {
        shown.push([message, ...buttons]);
        return 'Later';
      },
      run: async (command: string) => void ran.push(command),
      hasObsidianStatuses: async () => false,
    };
    const state = memento();
    assert.strictEqual(await offerStatusMigrationOnce(state, { getSnapshot: () => index }, options), true);
    assert.strictEqual(state.get(STATUS_MOVE_NOTICED), true);
    // The next session says nothing: the board and the Tasks view still do.
    assert.strictEqual(await offerStatusMigrationOnce(state, { getSnapshot: () => index }, options), false);
    assert.strictEqual(shown.length, 1);
    assert.deepStrictEqual(shown[0].slice(1), ['Preview the Move', 'Later']);
    assert.deepStrictEqual(ran, []);
  });

  test('says nothing, and keeps its turn, while no task keeps its status in a tag', async () => {
    const index = buildWorkspaceIndex(new Map([['plan.md', parseMarkdown('plan.md', '# Plan\n- [/] Draft the brief\n')]]));
    const state = memento();
    const said = await offerStatusMigrationOnce(state, { getSnapshot: () => index }, {
      show: async () => assert.fail('nothing to say'),
      hasObsidianStatuses: async () => false,
    });
    assert.strictEqual(said, false);
    assert.strictEqual(state.get(STATUS_MOVE_NOTICED), undefined);
  });
});
