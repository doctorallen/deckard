import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { PersistedPreferences } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { parseQueryBlockInfo } from '../ui/state/queryBlockState';
import {
  createDashboardSnapshot,
  createSearchPageSnapshot,
} from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { renderQueryBlockHtml } from '../ui/preview/queryBlockHtml';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { getTaskBoardHtml } from '../ui/webview/taskBoardHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * A contract, held across every surface at once: a task's title is Markdown
 * wherever a task is shown, and is shown the same way.
 *
 * The Task Board's table shipped drawing the title's source while every
 * other surface drew it rendered, because a new surface reused the row's
 * data but not its renderer. Nothing said they had to agree. This does: it
 * puts one task with bold, code and a link in front of each surface and
 * reads back what each drew. A surface added later is added here, or it is
 * not a surface that shows tasks.
 */
suite('Task title parity', () => {
  const pages: WebviewPage[] = [];
  let store: PreferencesStore | undefined;
  teardown(() => {
    pages.splice(0).forEach((page) => page.dispose());
    store?.dispose();
    store = undefined;
  });

  const TITLE = 'Re-run `mesh-survey --dry` and mark the **three** exits in [the map](https://example.com)';
  const index = () =>
    buildWorkspaceIndex(
      new Map([
        ['notes/atlas.md', parseMarkdown('notes/atlas.md', `# Atlas #project/atlas\n- [ ] ${TITLE} 📅 2026-09-21 #project/atlas\n`)],
      ]),
    );
  const webview = { cspSource: 'vscode-webview://deckard', asWebviewUri: (r: vscode.Uri) => r };
  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const options = { now: NOW, statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' as const };

  /** What a surface must show: the rendering, and none of the source. */
  const expectRendered = (html: string, where: string): void => {
    assert.ok(html.includes('<code>mesh-survey --dry</code>'), `${where}: code is not drawn as code`);
    assert.ok(html.includes('<strong>three</strong>'), `${where}: bold is not drawn as bold`);
    assert.ok(!html.includes('**three**'), `${where}: shows Markdown source`);
    assert.ok(!html.includes('`mesh-survey'), `${where}: shows Markdown source`);
  };

  const titlesOn = (page: WebviewPage, selector: string): string[] =>
    page.findAll(selector).map((element) => element.innerHTML);

  const open = (html: string, snapshot: unknown): WebviewPage => {
    const page = openWebviewPage(html, snapshot);
    pages.push(page);
    return page;
  };

  const preferences = (changes: Partial<PersistedPreferences> = {}): PersistedPreferences => {
    store = new PreferencesStore({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    return { ...store.value, ...changes };
  };

  test('the Task Board, as a board, a list, and a table', () => {
    for (const layout of ['board', 'list', 'table'] as const) {
      const board = createTaskBoard(index(), preferences({ taskBoardLayout: layout, taskTableColumns: ['title'] }), { query: '' }, options, 'inline');
      const page = open(getTaskBoardHtml(webview as unknown as vscode.Webview), board);
      const selector = layout === 'table' ? '.result-table .result-title' : '.task-title';
      const titles = titlesOn(page, selector);
      assert.strictEqual(titles.length, 1, `${layout}: one task, one title`);
      expectRendered(titles[0], `Task Board ${layout}`);
    }
  });

  test('Home, in its tasks and agenda widgets', () => {
    const built = index();
    const prefs = preferences();
    const snapshot = {
      ...createDashboardSnapshot(built, prefs),
      widgets: createDashboardWidgets(built, prefs, { now: NOW, upcomingDays: 7, tagTitleDisplayMode: 'inline' }),
    };
    const page = open(getDashboardHtml(webview, vscode.Uri.file('/deckard')), snapshot);
    const titles = titlesOn(page, '.task-title');
    assert.ok(titles.length >= 1, 'Home draws the task at least once');
    titles.forEach((title, at) => expectRendered(title, `Home task ${at}`));
  });

  test('a search page, in its tasks pane', () => {
    const page = open(getSearchPageHtml(webview), createSearchPageSnapshot(index(), preferences(), '#project/atlas'));
    const titles = titlesOn(page, '.task-title');
    assert.strictEqual(titles.length, 1);
    expectRendered(titles[0], 'search page');
  });

  test('a query block, as a list and as a table', () => {
    for (const info of ['deckard', 'deckard view=table columns=due']) {
      const html = renderQueryBlockHtml('tag = #project/atlas', parseQueryBlockInfo(info)!, index(), undefined, NOW);
      expectRendered(html, `query block "${info}"`);
    }
  });
});
