import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { countOtherCheckboxes, countUnknownStatuses } from '../domain/index/otherCheckboxes';
import { parseMarkdown } from '../domain/markdown/parser';
import { readTaskStatuses } from '../domain/tasks/taskStatuses';
import {
  describeUnknownStatuses,
  OPEN_SETTING_BUTTON,
  noticeUnknownStatusesOnce,
  OPEN_STATS_BUTTON,
  UNKNOWN_STATUSES_NOTICED,
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

  test('a character no status names is a task to do, counted apart', () => {
    const file = parseMarkdown('launch.md', VAULT);
    assert.deepStrictEqual(countUnknownStatuses(buildWorkspaceIndex(new Map([['launch.md', file]]))), { count: 1, symbols: ['?'] });
  });

  test('tasks of an unknown status are said once per workspace, with a way to name them', async () => {
    const state = memento();
    const shown: string[][] = [];
    const ran: unknown[][] = [];
    const options = {
      show: async (message: string, ...buttons: string[]) => {
        shown.push([message, ...buttons]);
        return OPEN_SETTING_BUTTON;
      },
      run: async (command: string, ...args: unknown[]) => void ran.push([command, ...args]),
    };
    await noticeUnknownStatusesOnce(state, { count: 0, symbols: [] }, options);
    assert.deepStrictEqual(shown, []);
    await noticeUnknownStatusesOnce(state, { count: 3, symbols: ['?', '!'] }, options);
    await noticeUnknownStatusesOnce(state, { count: 3, symbols: ['?', '!'] }, options);
    assert.deepStrictEqual(shown, [[describeUnknownStatuses(3, ['?', '!']), OPEN_SETTING_BUTTON, OPEN_STATS_BUTTON]]);
    assert.deepStrictEqual(ran, [['workbench.action.openSettings', 'deckard.tasks.statuses']]);
    assert.strictEqual(state.get(UNKNOWN_STATUSES_NOTICED), true);
    assert.match(describeUnknownStatuses(1, ['?']), /^1 task uses a status Deckard doesn't know, such as \[\?\]; it counts as to do\./);
  });
});
