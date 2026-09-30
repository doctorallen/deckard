import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createSearchPageSnapshot } from '../ui/state/dashboardState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { ENABLED, getCardTagCss, getHighContrastCss, getPageTailCss, getZenCss } from '../ui/webview/components';
import { deckardThemes, getDeckardThemeCss } from '../ui/webview/themes';
import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { getSearchPageHtml } from '../ui/webview/searchPageHtml';
import { getSidebarNotesHtml } from '../ui/webview/sidebarNotesHtml';
import { getTaskBoardHtml } from '../ui/webview/taskBoardHtml';
import { renderablePages } from './pages';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { createQueryContext } from '../domain/query/queryContext';

/**
 * The shared primitives every page draws with: popovers and menus, tips,
 * disabled controls, tags that are too long, loading, and removals.
 */
suite('Component primitives', () => {
  const webview = {
    cspSource: 'vscode-webview://deckard',
    asWebviewUri: (resource: vscode.Uri) => resource,
  } as unknown as vscode.Webview;
  const pages = renderablePages(
    { webview, extensionUri: vscode.Uri.file('/deckard') },
    ['dashboard', 'searchPage', 'sidebarNotes', 'notesGraph', 'help', 'stats', 'taskBoard', 'calendar'],
  );
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
      { queryContext: createQueryContext(NOW), statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' },
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
    const snapshot = createSearchPageSnapshot(index, store.value, query, { queryContext: createQueryContext(Date.now()) });
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

  suite('disabled controls (9b)', () => {
    /** Every selector in a sheet, with @media flattened. */
    const selectorsOf = (css: string): string[] => {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const selectors: string[] = [];
      for (const match of text.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        const prelude = match[1].trim();
        if (prelude.startsWith('@') || prelude.startsWith(':root')) {continue;}
        let depth = 0;
        let current = '';
        for (const character of prelude) {
          if (character === '(' || character === '[') {depth += 1;}
          if (character === ')' || character === ']') {depth -= 1;}
          if (character === ',' && depth === 0) {
            selectors.push(current.trim());
            current = '';
            continue;
          }
          current += character;
        }
        selectors.push(current.trim());
      }
      return selectors.map((selector) => selector.replace(/^.*\{\s*/, ''));
    };
    const unguarded = (selector: string): boolean =>
      selector
        .replace(/:not\([^()]*(\([^()]*\))?[^()]*\)/g, (not) => (not.includes('disabled') ? not : ''))
        .split(/\s*[>+~]\s*|\s+/)
        .some((compound) => /^(button|select|input)\b/.test(compound) && compound.includes(':hover')
          && !compound.includes(ENABLED) && !compound.includes(':not([disabled])'));

    test('no hover rule on a control reaches a disabled one, in any theme', () => {
      const sheets = pages.map(([name, render]) => [name, stylesOf(render())] as const);
      for (const theme of deckardThemes) {sheets.push([theme, getDeckardThemeCss(theme)]);}
      let guarded = 0;
      for (const [name, css] of sheets) {
        const found = selectorsOf(css).filter(unguarded);
        assert.deepStrictEqual(found, [], `${name}: a hover on a control that may be disabled`);
        guarded += selectorsOf(css).filter((selector) => selector.includes(`:hover${ENABLED}`)).length;
      }
      assert.ok(guarded > 40, `the guard is read where it is written (${guarded})`);
      assert.ok(unguarded('.toolbar button:hover'), 'and a bare hover is caught');
    });

    test('Save and Clear hold their place while they cannot act, and say why', () => {
      const board = openBoard();
      const save = board.find('[data-action="save-board-search"]') as HTMLButtonElement;
      const clear = board.find('[data-action="clear-query"]') as HTMLButtonElement;
      for (const button of [save, clear]) {
        assert.strictEqual(button.getAttribute('aria-disabled'), 'true');
        assert.strictEqual(button.hasAttribute('disabled'), false);
        assert.ok(button.tabIndex >= 0, 'still in the Tab order');
        assert.ok(button.getAttribute('data-tip-disabled'));
      }
      board.click('[data-action="save-board-search"]');
      assert.strictEqual(board.lastPosted('saveBoardSearch'), undefined, 'a click does nothing');
      keyFocus(board, '[data-action="save-board-search"]');
      assert.strictEqual(tip(board)?.textContent, 'Type a search to save it');
      const input = board.find('[data-action="query-input"]') as HTMLInputElement;
      input.value = '#project/atlas';
      input.dispatchEvent(new board.window.Event('input', { bubbles: true }));
      assert.strictEqual(save.getAttribute('aria-disabled'), null, 'typing enables it in place');
      assert.strictEqual(board.find('[data-action="save-board-search"]'), save, 'without a redraw');
    });
  });

  suite('tags on cards (decision 4)', () => {
    test('the card-tag layer comes after the themes and high contrast, and before zen', () => {
      const tail = getPageTailCss();
      const layer = tail.indexOf(getCardTagCss());
      assert.ok(layer > tail.indexOf(getHighContrastCss()), 'after high contrast, and so after the theme');
      assert.ok(layer < tail.indexOf(getZenCss()), 'before zen');
      assert.ok(getCardTagCss().includes('body .board-card button.tag-open:not(:hover):not(:focus-visible)'));
      assert.doesNotMatch(getCardTagCss(), /white-space/, 'one-line geometry stays with the tag sheet');
    });
  });

  suite('long tags (9c)', () => {
    test('a namespaced tag keeps its slash outside the part that shortens', () => {
      const search = openSearch();
      const tag = search.find('.card [data-tag-key="#topic/replicants"]');
      assert.strictEqual(tag.getAttribute('data-tip-overflow'), '#topic/replicants');
      assert.strictEqual(tag.querySelector('.tag-namespace')?.textContent, '#topic/');
      assert.strictEqual(tag.querySelector('.tag-namespace-text')?.textContent, '#topic');
      assert.strictEqual(tag.querySelector('.tag-value')?.textContent, 'replicants');
    });

    test('the whole tag is the tip only when it is cut short', () => {
      const search = openSearch();
      const tag = search.find('.card [data-tag-key="#topic/replicants"]') as HTMLElement;
      const value = tag.querySelector('.tag-value') as HTMLElement;
      Object.defineProperty(value, 'clientWidth', { configurable: true, value: 60 });
      Object.defineProperty(value, 'scrollWidth', { configurable: true, value: 60 });
      keyFocus(search, '.card [data-tag-key="#topic/replicants"]');
      assert.ok(!tip(search) || tip(search)?.hidden, 'a tag that fits has no tip');
      tag.blur();
      Object.defineProperty(value, 'scrollWidth', { configurable: true, value: 90 });
      keyFocus(search, '.card [data-tag-key="#topic/replicants"]');
      assert.strictEqual(tip(search)?.textContent, '#topic/replicants');
    });
  });

  suite('loading (9f)', () => {
    test('every page starts busy, with a loading line rather than an empty box', () => {
      for (const [name, render] of pages.filter(([name]) => !['Help', 'Notes Graph'].includes(name))) {
        const html = render();
        assert.match(html, /<main id="app"[^>]* aria-busy="true"><div class="loading" role="status">/, `${name} starts busy`);
      }
    });

    test('the sidebar\'s indexing count shows at once and keeps the page busy', async () => {
      page = openWebviewPage(getSidebarNotesHtml(webview, '1.0.0'), {
        state: 'loading', progress: { completed: 412, total: 3760 }, notes: [], activeTags: [], tagTitleDisplayMode: 'inline',
      });
      await Promise.resolve();
      assert.strictEqual(page.text('.loading.is-immediate'), 'Indexing this workspace: 412 of 3,760 notes read…');
      assert.strictEqual(page.find('#app').getAttribute('aria-busy'), 'true');
    });

    test('a page waiting on the first scan says how far it has got', () => {
      page = openWebviewPage(getSearchPageHtml(webview));
      page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'indexing', progress: { completed: 412, total: 3760 } } }));
      assert.strictEqual(page.text('#app .loading.is-immediate'), 'Indexing this workspace: 412 of 3,760 notes read…');
      page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'indexing', progress: null } }));
      assert.strictEqual(page.text('#app .loading'), 'Indexing this workspace…');
    });

    test('the first state clears the busy mark', async () => {
      const board = openBoard();
      await Promise.resolve();
      assert.strictEqual(board.find('#app').getAttribute('aria-busy'), null);
    });

    test('a search still out after a second shows a bar, and its answer clears it', async () => {
      const search = openSearch();
      const input = search.find('[data-action="query-input"]') as HTMLInputElement;
      input.value = 'lift';
      input.dispatchEvent(new search.window.Event('input', { bubbles: true }));
      search.click('[data-action="apply-query"]');
      assert.ok(search.lastPosted('setOverviewQuery'), 'the search went out');
      await wait(1100);
      assert.ok(search.find('.query-workspace').classList.contains('is-searching'));
      assert.strictEqual(search.find('#app').getAttribute('aria-busy'), 'true');
      const index = buildWorkspaceIndex(new Map([['notes/one.md', parseMarkdown('notes/one.md', '# One #project/atlas\nThe lift is stuck.\n')]]));
      search.send(createSearchPageSnapshot(index, store!.value, '#project/atlas AND lift', { queryContext: createQueryContext(Date.now()) }));
      await Promise.resolve();
      assert.ok(!search.find('.query-workspace').classList.contains('is-searching'));
      assert.strictEqual(search.find('#app').getAttribute('aria-busy'), null);
    });
  });

  suite('removals (9g)', () => {
    test('a removed status column can be put back for a moment', () => {
      const board = openBoard();
      board.click('[data-action="remove-status"][data-status="todo"]');
      assert.deepStrictEqual(board.lastPosted('setBoardStatuses'), { type: 'setBoardStatuses', statuses: ['doing'] });
      assert.match(board.text('.undo-notice') ?? '', /^Removed the todo column\. Undo$/);
      assert.strictEqual(board.document.activeElement, board.find('[data-action="undo-remove-status"]'), 'focus is on Undo');
      board.click('[data-action="undo-remove-status"]');
      assert.deepStrictEqual(board.lastPosted('setBoardStatuses'), { type: 'setBoardStatuses', statuses: ['todo', 'doing'] });
      assert.strictEqual(board.findAll('.undo-notice').length, 0);
    });
  });

  suite('status columns in the gear', () => {
    test('lists every status the board draws, and a status tasks carry cannot be removed', () => {
      const board = openBoard('# Work\n- [ ] Send the proposal #status/waiting\n- [ ] Book the room #status/doing\n');
      assert.deepStrictEqual(
        board.findAll('.board-status').map((row) => row.getAttribute('data-status')),
        ['todo', 'doing', 'waiting'],
        'the listed ones, then one the tasks carry',
      );
      assert.ok(board.find('[data-action="remove-status"][data-status="todo"]'), 'an empty column can be removed');
      assert.strictEqual(board.findAll('[data-action="remove-status"][data-status="waiting"]').length, 0, 'one a task carries cannot');
      assert.strictEqual(board.text('.board-status[data-status="waiting"] .board-status-count'), '1');
      board.find('.board-status[data-status="waiting"]').dispatchEvent(
        new board.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      );
      board.click('#rank-context-menu [data-context-action="top"]');
      assert.deepStrictEqual(
        board.lastPosted('setBoardStatuses'),
        { type: 'setBoardStatuses', statuses: ['waiting', 'todo', 'doing'] },
        'ordering saves every column, the unlisted one with them',
      );
    });
  });

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

    test('the Notes Graph, which takes only the tip script, shows its tips too', () => {
      page = openWebviewPage(getNotesGraphHtml(webview));
      keyFocus(page, '#link-distance');
      assert.match(String(tip(page)?.textContent), /length of visible links/);
    });

    test('no control on any page carries a native title', () => {
      // A title never shows on keyboard focus; a control says it with
      // data-tip. Non-focusable spans and a select's options may keep one.
      const control = /<(button|summary|input|select|textarea|a)\b[^<>]*\btitle=/;
      const focusable = /<[a-z]+\b(?=[^<>]*\btabindex=)[^<>]*\btitle=/;
      for (const [name, render] of pages) {
        const html = render();
        const found = html.match(control) ?? html.match(focusable);
        assert.strictEqual(found, null, `${name}: ${found?.[0].slice(0, 120)}`);
      }
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
