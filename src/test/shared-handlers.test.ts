import * as assert from 'assert';

import * as vscode from 'vscode';

import type { Task } from '../domain/model/tasks';
import type { TaskWrites } from '../ui/commands/taskActions';
import type { PageContext } from '../ui/webview/host/pageController';
import { chooseTheme, openHelp, parkTag, ready, toggleTask } from '../ui/webview/host/sharedHandlers';

/** A page context that counts the refreshes asked of it. */
function createPage(): PageContext & { refreshes: number } {
  return {
    refreshes: 0,
    surface: undefined,
    refresh() {
      this.refreshes += 1;
    },
    post: () => undefined,
  };
}

/**
 * Runs `run` with every command recorded rather than run, and returns what
 * it ran, with the arguments it passed.
 */
async function recordCommands(run: () => Promise<void>): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const original = commands.executeCommand;
  const ran: unknown[][] = [];
  commands.executeCommand = async (...call: unknown[]) => void ran.push(call);
  try {
    await run();
  } finally {
    commands.executeCommand = original;
  }
  return ran;
}

suite('Shared page message handlers', () => {
  test('run the gear\'s and the tag menu\'s commands, and Help at a section when one is named', async () => {
    const page = createPage();
    const ran = await recordCommands(async () => {
      await chooseTheme()({ type: 'chooseTheme' }, page);
      await openHelp()({ type: 'openHelp' }, page);
      await openHelp('periodic')({ type: 'openHelp' }, page);
      await parkTag()({ type: 'parkTag', tagKey: '#project/relay' }, page);
      await parkTag()({ type: 'unparkTag', tagKey: '#project/relay' }, page);
    });
    assert.deepStrictEqual(ran, [
      ['deckard.chooseTheme'],
      ['deckard.showHelp'],
      ['deckard.showHelp', 'periodic'],
      ['deckard.parkTag', '#project/relay'],
      ['deckard.unparkTag', '#project/relay'],
    ]);
  });

  test('answer a page that says it is ready with its snapshot', async () => {
    const page = createPage();
    await ready()({ type: 'ready' }, page);
    assert.strictEqual(page.refreshes, 1);
  });

  test('check a task\'s box only while the page can still find the task', async () => {
    const task = { id: 'call', title: 'Call the vendor' } as Task;
    const toggled: Array<[string, boolean]> = [];
    const writes = {
      tasks: {
        toggle: async (target: Task, completed: boolean) => {
          toggled.push([target.id, completed]);
          return { kind: 'unchanged' };
        },
      },
    } as unknown as TaskWrites;
    const handle = toggleTask({ writes, findTask: (taskId) => (taskId === task.id ? task : undefined) });
    await handle({ type: 'toggleTask', taskId: 'gone', completed: true }, createPage());
    await handle({ type: 'toggleTask', taskId: 'call', completed: true }, createPage());
    assert.deepStrictEqual(toggled, [['call', true]]);
  });
});
