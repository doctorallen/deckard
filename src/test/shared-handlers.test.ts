import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { Task } from '../domain/model/tasks';
import { NavigationService } from '../services/navigationService';
import type { TaskWrites } from '../ui/commands/taskActions';
import type { PageContext } from '../ui/webview/host/pageController';
import {
  chooseTheme,
  goToPage,
  listGoTo,
  openGoTo,
  openHelp,
  openSource,
  openTag,
  parkTag,
  ready,
  toggleTask,
} from '../ui/webview/host/sharedHandlers';

/** A page context that counts the refreshes asked of it. */
function createPage(): PageContext & { refreshes: number } {
  return {
    refreshes: 0,
    surface: undefined,
    refresh() {
      this.refreshes += 1;
    },
    post: () => undefined,
    postState: () => undefined,
    renderHtml: () => undefined,
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

/**
 * Runs `run` with opening a document recorded rather than done, and returns
 * each open: the path, the line revealed, and whether it previewed.
 */
async function recordOpens(run: () => Promise<void>): Promise<Array<[string, number, boolean]>> {
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals = [workspace.openTextDocument, window.showTextDocument];
  const opens: Array<[string, number, boolean]> = [];
  workspace.openTextDocument = async (uri: vscode.Uri) => ({ uri, lineCount: 40 });
  window.showTextDocument = async (document: { uri: vscode.Uri }, options: { preview: boolean }) => {
    const editor = {
      document,
      selection: new vscode.Selection(0, 0, 0, 0),
      revealRange: () => opens.push([document.uri.path, editor.selection.active.line + 1, options.preview]),
    };
    return editor;
  };
  try {
    await run();
  } finally {
    [workspace.openTextDocument, window.showTextDocument] = originals;
  }
  return opens;
}

suite('Shared page message handlers', () => {
  const index = buildWorkspaceIndex(new Map([
    ['/notes/atlas.md', parseMarkdown('/notes/atlas.md', '# Atlas #project/relay\nSome words.\n- [ ] Call the vendor\n')],
  ]));
  const indexer = { getSnapshot: () => index };
  const navigation = new NavigationService();

  test('open a line the page\'s policy accepts, and count the visit it names', async () => {
    const visits: string[] = [];
    const usage = { recordSectionAccess: async (id: string) => void visits.push(id) };
    const page = createPage();
    const opens = await recordOpens(async () => {
      const entries = openSource({ indexer, navigation, policy: 'entries', usage });
      const tasks = openSource({ indexer, navigation, policy: 'tasks' });
      await entries({ type: 'openSource', filePath: '/notes/atlas.md', line: 1 }, page);
      await entries({ type: 'openSource', filePath: '/notes/atlas.md', line: 2 }, page);
      await tasks({ type: 'openSource', filePath: '/notes/atlas.md', line: 1 }, page);
      await tasks({ type: 'openSource', filePath: '/notes/atlas.md', line: 3, pin: true }, page);
    });
    assert.deepStrictEqual(opens, [['/notes/atlas.md', 1, true], ['/notes/atlas.md', 3, false]]);
    assert.deepStrictEqual(visits, [[...index.sections.keys()][0]]);
  });

  test('open a tag the page\'s policy finds, by its key in the index', async () => {
    const opened: string[] = [];
    const page = createPage();
    const lenient = openTag({ indexer, navigation, policy: 'lenient', openTag: (tagKey) => opened.push(`lenient ${tagKey}`) });
    const exact = openTag({ indexer, navigation, policy: 'exact', openTag: (tagKey) => opened.push(`exact ${tagKey}`) });
    for (const tagKey of ['project/relay', '#project/relay', '#gone']) {
      await lenient({ type: 'openTag', tagKey }, page);
      await exact({ type: 'openTag', tagKey }, page);
    }
    assert.deepStrictEqual(opened, ['lenient #project/relay', 'lenient #project/relay', 'exact #project/relay']);
  });

  test('DECKARD\'s menu lists every page but the one asking, and opens only a page it knows', async () => {
    const posted: unknown[] = [];
    const page = { ...createPage(), post: (message: unknown) => { posted.push(message); } };
    const index = buildWorkspaceIndex(new Map([['a.md', parseMarkdown('a.md', '# A\n- [ ] Ship it')]]));
    await listGoTo({ indexer: { getSnapshot: () => index }, current: 'board' })({ type: 'listGoTo' }, page);
    await listGoTo({ current: 'help' })({ type: 'listGoTo' }, page);
    const [withHints, bare] = posted as { type: string; pages: { id: string; description: string }[]; key: string }[];
    assert.strictEqual(withHints.type, 'goToPages');
    assert.deepStrictEqual(withHints.pages.map((entry) => entry.id), ['home', 'calendar', 'today', 'graph', 'find', 'stats', 'help']);
    assert.strictEqual(withHints.pages.find((entry) => entry.id === 'graph')?.description, '1 note');
    assert.match(withHints.key, /P$/);
    assert.ok(!bare.pages.some((entry) => entry.id === 'help'));
    assert.ok(bare.pages.every((entry) => entry.description === ''), 'with no index, no hints');
    const ran = await recordCommands(async () => {
      await goToPage()({ type: 'goToPage', page: 'board' }, page);
      await goToPage()({ type: 'goToPage', page: 'constructor' }, page);
      await goToPage()({ type: 'goToPage', page: 'nowhere' }, page);
    });
    assert.deepStrictEqual(ran, [['deckard.showTaskBoard']]);
  });

  test('run the gear\'s and the tag menu\'s commands, and Help at a section when one is named, and Go to… from the eyebrow', async () => {
    const page = createPage();
    const ran = await recordCommands(async () => {
      await chooseTheme()({ type: 'chooseTheme' }, page);
      await openHelp()({ type: 'openHelp' }, page);
      await openHelp('periodic')({ type: 'openHelp' }, page);
      await openGoTo()({ type: 'openGoTo' }, page);
      await parkTag()({ type: 'parkTag', tagKey: '#project/relay' }, page);
      await parkTag()({ type: 'unparkTag', tagKey: '#project/relay' }, page);
    });
    assert.deepStrictEqual(ran, [
      ['deckard.chooseTheme'],
      ['deckard.showHelp'],
      ['deckard.showHelp', 'periodic'],
      ['deckard.goTo'],
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
