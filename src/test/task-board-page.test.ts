import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { getTaskBoardHtml } from '../ui/webview/taskBoardHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * What the Task Board page does with a board, driven as VS Code drives it.
 */
suite('Task Board page', () => {
  let page: WebviewPage | undefined;
  let store: PreferencesStore | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.dispose();
    store = undefined;
  });

  const webview = { cspSource: 'vscode-webview://deckard', asWebviewUri: (r: vscode.Uri) => r } as unknown as vscode.Webview;
  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const options = { now: NOW, statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' as const };

  const open = (): { page: WebviewPage; taskId: string } => {
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-09-21\n')]]),
    );
    store = new PreferencesStore({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard(index, { ...store.value, taskBoardLayout: 'board' }, { query: '' }, options, 'inline');
    page = openWebviewPage(getTaskBoardHtml(webview), board);
    return { page, taskId: board.columns[0].cards[0].taskId };
  };

  test('a card\'s menu is a button that opens its moves, and a choice moves the card', () => {
    const { page, taskId } = open();
    const button = page.find('.board-card [data-action="board-menu"]');
    assert.strictEqual(button.tagName, 'BUTTON');
    assert.strictEqual(button.getAttribute('aria-haspopup'), 'menu');
    assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(page.findAll('.board-card select').length, 0, 'no bare select on a card');

    page.click('.board-card [data-action="board-menu"]');
    const menu = page.find('#action-menu') as HTMLElement;
    assert.strictEqual(menu.hidden, false);
    assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
    const headings = page.findAll('#action-menu .menu-heading').map((heading) => heading.textContent);
    assert.deepStrictEqual(headings, ['Status', 'Priority', 'Due', 'Done']);
    const labels = page.findAll('#action-menu [role="menuitem"]').map((item) => item.textContent);
    for (const label of ['Todo', 'Doing', 'High', 'Due tomorrow', 'No due date', 'Complete it']) {
      assert.ok(labels.includes(label), `offers ${label}`);
    }
    assert.ok(!labels.includes('No status'), 'not the column the card is in');
    assert.strictEqual(page.document.activeElement, page.find('#action-menu [role="menuitem"]'), 'focus is in the menu');

    page.click('#action-menu [data-menu-value="status:doing"]');
    assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, column: 'status:doing' });
    assert.strictEqual(menu.hidden, true, 'the menu closes on a choice');
    assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
  });

  test('priority is a badge with an arrow, told from the date beside it', () => {
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-09-11 🔺 ⏳ 2026-09-22 🔁 every month on the 15th\n')]]),
    );
    store = new PreferencesStore({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    for (const layout of ['board', 'list'] as const) {
      const board = createTaskBoard(index, { ...store.value, taskBoardLayout: layout }, { query: '' }, options, 'inline');
      page?.dispose();
      page = openWebviewPage(getTaskBoardHtml(webview), board);
      const badge = page.find('.priority-badge.priority-highest');
      assert.strictEqual(badge.querySelector('.priority-mark')?.textContent, '↑↑', `${layout}: the arrow says how far from the middle`);
      assert.match(badge.textContent ?? '', /Highest/);
      const details = page.text(layout === 'board' ? '.board-details' : '.task-meta') ?? '';
      // Where the task is written folds under a card as under a row: the file
      // and line, then the headings above it.
      assert.deepStrictEqual(
        page.findAll(layout === 'board' ? '.board-card .task-source' : '.task-row .task-source').map((span) => span.textContent),
        ['atlas / line 2', 'Atlas'],
        `${layout}: the two provenance lines`,
      );
      assert.ok(!/atlas\.md/.test(details), `${layout}: the file name is not a detail`);
      assert.ok(!/PRIORITY|SCHEDULED|REPEATS/.test(details), `${layout}: the details read as written`);
      if (layout === 'list') {
        assert.match(details, /Scheduled 2026-09-22/);
        assert.match(details, /Repeats every month on the 15th/);
      }
    }
  });

  test('the menu closes on Escape and gives focus back to its button', () => {
    const { page } = open();
    page.click('.board-card [data-action="board-menu"]');
    const menu = page.find('#action-menu') as HTMLElement;
    assert.strictEqual(menu.hidden, false);
    page.document.activeElement?.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual(menu.hidden, true);
    assert.strictEqual(page.document.activeElement, page.find('.board-card [data-action="board-menu"]'));
    assert.strictEqual(page.lastPosted('moveTask'), undefined);
  });

  test('a right-click on a card opens the same menu', () => {
    const { page } = open();
    page.find('.board-card .task-title').dispatchEvent(new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.strictEqual((page.find('#action-menu') as HTMLElement).hidden, false);
  });
});
