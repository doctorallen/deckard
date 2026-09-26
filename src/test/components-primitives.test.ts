import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createSearchPageSnapshot } from '../ui/state/dashboardState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { getCalendarHtml } from '../ui/webview/calendarHtml';
import { getDashboardHtml } from '../ui/webview/dashboardHtml';
import { getHelpHtml } from '../ui/webview/helpHtml';
import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { getStatsHtml } from '../ui/webview/statsHtml';
import { getTaskBoardHtml } from '../ui/webview/taskBoardHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The shared primitives every page draws with: popovers and menus, tips,
 * disabled controls, tags that are too long, loading, and removals.
 */
suite('Component primitives', () => {
  const webview = {
    cspSource: 'vscode-webview://deckard',
    asWebviewUri: (resource: vscode.Uri) => resource,
  } as unknown as vscode.Webview;
  const pages: Array<[string, () => string]> = [
    ['Dashboard', () => getDashboardHtml(webview, vscode.Uri.file('/deckard'))],
    ['search page', () => getSearchPageHtml(webview)],
    ['Related Notes', () => getSidebarNotesHtml(webview, '1.0.0')],
    ['Notes Graph', () => getNotesGraphHtml(webview)],
    ['Help', () => getHelpHtml(webview, vscode.Uri.file('/deckard'))],
    ['Stats', () => getStatsHtml(webview)],
    ['Task Board', () => getTaskBoardHtml(webview)],
    ['Calendar', () => getCalendarHtml(webview)],
  ];
  const stylesOf = (html: string): string =>
    [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');

  let page: WebviewPage | undefined;
  let store: PreferencesStore | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.dispose();
    store = undefined;
  });

  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const openBoard = (markdown = '# Atlas #project/atlas\n- [ ] Send the proposal #project/atlas 📅 2026-09-21\n'): WebviewPage => {
    const index = buildWorkspaceIndex(new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', markdown)]]));
    store = new PreferencesStore({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard(
      index,
      { ...store.value, taskBoardLayout: 'board' },
      { query: '' },
      { now: NOW, statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' },
      'inline',
    );
    page = openWebviewPage(getTaskBoardHtml(webview), board);
    return page;
  };

  const openSearch = (query = '#project/atlas', extra: Record<string, unknown> = {}): WebviewPage => {
    const index = buildWorkspaceIndex(new Map([
      ['notes/one.md', parseMarkdown('notes/one.md', '# One #project/atlas #topic/replicants\nThe lift is stuck.\n- [ ] Chase it #project/atlas\n')],
    ]));
    store = new PreferencesStore({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, store.value, query, {});
    page = openWebviewPage(getSearchPageHtml(webview), { ...snapshot, ...extra });
    return page;
  };
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const keyFocus = (target: WebviewPage, selector: string): HTMLElement => {
    const element = target.find(selector) as HTMLElement;
    target.document.dispatchEvent(new target.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    element.focus();
    return element;
  };
  const tip = (target: WebviewPage): HTMLElement | null => target.document.getElementById('deckard-tip');

  suite('tips (9d)', () => {
    test('a keyboard focus shows the tip at once, with its key, and Escape hides it', () => {
      const search = openSearch('#project/atlas', { history: { back: true, forward: false } });
      const back = keyFocus(search, '[data-action="history-back"]');
      const shown = tip(search);
      assert.ok(shown && !shown.hidden, 'the tip shows');
      assert.strictEqual(shown?.getAttribute('role'), 'tooltip');
      assert.ok(shown?.textContent?.startsWith('Back to the search before'));
      assert.strictEqual(shown?.querySelector('kbd')?.textContent, 'Alt+←');
      assert.strictEqual(back.getAttribute('title'), null, 'no native title');
      search.document.dispatchEvent(new search.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.strictEqual(shown?.hidden, true);
      assert.ok(!String(back.getAttribute('aria-describedby') || '').includes('deckard-tip'));
    });

    test('a tip that says more than the name describes its control', () => {
      const search = openSearch();
      const apply = keyFocus(search, '[data-action="apply-query"]');
      assert.strictEqual(tip(search)?.textContent, 'Run this search');
      assert.ok(String(apply.getAttribute('aria-describedby')).includes('deckard-tip'));
    });

    test('the pointer waits 400 ms, and touch shows nothing', async () => {
      const search = openSearch();
      const apply = search.find('[data-action="apply-query"]');
      apply.dispatchEvent(new search.window.MouseEvent('pointerover', { bubbles: true }));
      assert.ok(!tip(search) || tip(search)?.hidden, 'not at once');
      await wait(450);
      assert.strictEqual(tip(search)?.hidden, false, 'after the pause');
      apply.dispatchEvent(new search.window.MouseEvent('pointerdown', { bubbles: true }));
      assert.strictEqual(tip(search)?.hidden, true, 'a press puts it away');
      const touch = new search.window.MouseEvent('pointerover', { bubbles: true });
      Object.defineProperty(touch, 'pointerType', { value: 'touch' });
      search.find('[data-action="toggle-builder"]').dispatchEvent(touch);
      await wait(450);
      assert.strictEqual(tip(search)?.hidden, true, 'touch never shows a tip');
    });
  });

  suite('popovers and menus (9e)', () => {
    test('no sheet stacks by a number of its own, outside the named exceptions', () => {
      // Provenance lifts an entry over the next (Decision 5), and the graph
      // lays its overlays over its canvas; everything else uses the scale.
      const allowed = [
        /^\.board-card:hover, \.board-card:focus-within$/,
        /^\.note:hover, \.note:focus-within$/,
        /^\.saved-filter-row/,
        /^\.card:hover, \.card:focus-within/,
        /::after$/,
        /\.source|\.task-source|\.home-row-detail|\.tag-count|\.saved-filter-tags/,
        /^\.overlay$|^\.graph-zoom-controls$|^\.status-line$|^\.empty-state$/,
      ];
      for (const [name, render] of pages) {
        const css = stylesOf(render()).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const match of css.matchAll(/([^{}]+)\{([^{}]*z-index:\s*\d[^{}]*)\}/g)) {
          const selector = match[1].trim().replace(/\s+/g, ' ');
          assert.ok(
            allowed.some((pattern) => pattern.test(selector) || selector.split(',').every((part) => pattern.test(part.trim()))),
            `${name}: ${selector} sets a numeric z-index`,
          );
        }
      }
    });

    test('the card menu and the tag menu are popovers of menu rows', () => {
      const board = openBoard();
      board.click('.board-card [data-action="board-menu"]');
      const menu = board.find('#action-menu');
      assert.ok(menu.classList.contains('popover'));
      assert.ok(board.findAll('#action-menu [data-menu-value]').every((item) => item.classList.contains('menu-item')));
      board.dispose();
      const search = openSearch();
      const tag = search.find('.card [data-tag-key]');
      tag.dispatchEvent(new search.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const tagMenu = search.find('#tag-context-menu');
      assert.ok(tagMenu.classList.contains('popover'));
      assert.ok(search.findAll('#tag-context-menu button').length > 0);
      assert.ok(search.findAll('#tag-context-menu button').every((item) => item.classList.contains('menu-item')));
    });

    test('the gear\'s menu and the completions drop down from their control', () => {
      const board = openBoard();
      assert.ok(board.find('.view-options-menu').classList.contains('is-dropdown'));
      assert.ok(board.find('#suggestions-query').classList.contains('popover'));
    });
  });
});
