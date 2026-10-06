import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { countOtherCheckboxes } from '../domain/index/otherCheckboxes';
import { parseMarkdown } from '../domain/markdown/parser';
import { readTaskStatuses } from '../domain/tasks/taskStatuses';
import {
  describeOtherCheckboxes,
  noticeOtherCheckboxesOnce,
  OPEN_STATS_BUTTON,
  OTHER_CHECKBOXES_NOTICED,
} from '../ui/commands/otherCheckboxes';

function memento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: <T>(key: string, fallback?: T) => (store.has(key) ? (store.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => void store.set(key, value),
  };
}

const VAULT = [
  '# Launch',
  '- [ ] Draft the plan',
  '- [x] Book the room',
  '- [/] Write the release notes',
  '- [-] Order the banner',
  '  - [?] Ask about swag',
  '- [>] Moved to Friday',
  '```',
  '- [/] An example in code',
  '```',
].join('\n');

suite('Checkbox lines that are not tasks', () => {
  test('are counted apart from tasks, leaving out migrated lines and code', () => {
    // `[/]`, `[-]`, and `[?]` are tasks now; a status of the nonTask type is text.
    const taskStatuses = readTaskStatuses([
      { symbol: '/', name: 'Pro', type: 'nonTask' },
      { symbol: '-', name: 'Con', type: 'nonTask' },
      { symbol: '?', name: 'Question', type: 'nonTask' },
    ]);
    const file = parseMarkdown('launch.md', VAULT, undefined, { taskStatuses });
    assert.strictEqual(file.tasks.length, 2);
    assert.strictEqual(file.otherCheckboxes, 3);
    assert.strictEqual(parseMarkdown('launch.md', VAULT).otherCheckboxes, undefined);
    assert.strictEqual(parseMarkdown('plain.md', '- [ ] Only a task\n').otherCheckboxes, undefined);
    assert.strictEqual(countOtherCheckboxes(buildWorkspaceIndex(new Map([['launch.md', file]]))), 3);
  });

  test('are said once per workspace, with a way to Stats', async () => {
    const state = memento();
    const shown: string[][] = [];
    const ran: string[] = [];
    const options = {
      show: async (message: string, ...buttons: string[]) => {
        shown.push([message, ...buttons]);
        return OPEN_STATS_BUTTON;
      },
      run: async (command: string) => void ran.push(command),
    };
    await noticeOtherCheckboxesOnce(state, 0, options);
    assert.deepStrictEqual(shown, []);
    await noticeOtherCheckboxesOnce(state, 3, options);
    await noticeOtherCheckboxesOnce(state, 3, options);
    assert.deepStrictEqual(shown, [[describeOtherCheckboxes(3), OPEN_STATS_BUTTON]]);
    assert.deepStrictEqual(ran, ['deckard.showStats']);
    assert.strictEqual(state.get(OTHER_CHECKBOXES_NOTICED), true);
    assert.match(describeOtherCheckboxes(1), /^1 checkbox line .* is text to Deckard, not a task, so no task count includes it\./);
  });
});
