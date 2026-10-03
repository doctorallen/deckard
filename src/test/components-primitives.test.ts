import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences, TestPreferences } from './preferenceServices';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { createCalendar } from '../ui/state/calendarState';
import { createSidebarSnapshot } from '../ui/state/relatedNotesRanking';
import { ENABLED } from '../ui/webview/selectors';
import { PAGES, renderablePages, renderPage } from './pages';
import { linkedSheets, pageSheets, readSheet, themeSheet } from './sheets';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { readGoldens } from '../../test/harness/domGoldens';
import { createQueryContext } from '../domain/query/queryContext';
import { deckardThemes } from '../ui/webview/themeNames';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createDeckardStatsSnapshot } from '../ui/state/statsState';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';

/**
 * The shared primitives every page draws with: popovers and menus, tips,
 * disabled controls, tags that are too long, loading, and removals.
 */
suite('Component primitives', () => {
  const pages = renderablePages(['dashboard', 'searchPage', 'sidebarNotes', 'notesGraph', 'help', 'stats', 'taskBoard', 'calendar']);
  /** Every rule a page draws with, as written, in the order its shell links them. */
  const stylesOf = (html: string): string => pageSheets(html);

  let page: WebviewPage | undefined;
  let store: TestPreferences | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.repository.dispose();
    store = undefined;
  });

  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const openBoard = (markdown = '# Atlas #project/atlas\n- [ ] Send the proposal #project/atlas 📅 2026-09-21\n'): WebviewPage => {
    const index = buildWorkspaceIndex(new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', markdown)]]));
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({
      index,
      preferences: { ...store.reader.value, taskBoardLayout: 'board' },
      search: { query: '' },
      options: { queryContext: createQueryContext(NOW), statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' },
      tagTitleDisplayMode: 'inline',
    });
    page = openWebviewPage(renderPage('taskBoard'), board);
    return page;
  };

  const openSearch = (query = '#project/atlas', extra: Record<string, unknown> = {}): WebviewPage => {
    const index = buildWorkspaceIndex(new Map([
      ['notes/one.md', parseMarkdown('notes/one.md', '# One #project/atlas #topic/replicants\nThe lift is stuck.\n- [ ] Chase it #project/atlas\n')],
    ]));
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, store.reader.value, query, { queryContext: createQueryContext(Date.now()) });
    page = openWebviewPage(renderPage('searchPage'), { ...snapshot, ...extra });
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
    /** Every selector in a sheet, with `@media` flattened. */
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
      for (const theme of deckardThemes) {sheets.push([theme, themeSheet(theme)]);}
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
      for (const [name, render] of pages) {
        const linked = linkedSheets(render());
        assert.match(linked[1] ?? '', /^themes\/[a-z]+\.css$/, `${name}: the theme follows the page's own sheet`);
        assert.strictEqual(linked[2], 'tail.css', `${name}: the tail follows the theme, last`);
        assert.strictEqual(linked.length, 3, `${name}: links its sheet, its theme, and the tail`);
      }
      const tail = readSheet('shared/tail.css');
      const layer = tail.indexOf('@import "./cardTag.css";');
      assert.ok(layer > tail.indexOf('@import "./highContrast.css";'), 'after high contrast, and so after the theme');
      assert.ok(layer < tail.indexOf('@import "./zen.css";'), 'before zen');
      const cardTag = readSheet('shared/cardTag.css');
      assert.ok(cardTag.includes('body .board-card button.tag-open:not(:hover):not(:focus-visible)'));
      assert.doesNotMatch(cardTag, /white-space/, 'one-line geometry stays with the tag sheet');
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
      // Read from the loaded page, before any state, so it holds whether the
      // loading line is in the markup or drawn by the page's script.
      for (const [name, render] of pages.filter(([name]) => !['Help', 'Notes Graph'].includes(name))) {
        page = openWebviewPage(render());
        const app = page.find('#app');
        assert.strictEqual(app.localName, 'main', `${name}: #app is the page's main`);
        assert.strictEqual(app.getAttribute('aria-busy'), 'true', `${name} starts busy`);
        const loading = app.firstChild as Element | null;
        assert.strictEqual(loading?.nodeType, 1, `${name}: the loading line comes first, with nothing before it`);
        assert.strictEqual(loading?.localName, 'div', `${name}: the loading line is a div`);
        assert.strictEqual(loading?.getAttribute('class'), 'loading', `${name}: the loading line's class`);
        assert.strictEqual(loading?.getAttribute('role'), 'status', `${name}: the loading line is a status`);
        page.dispose();
        page = undefined;
      }
    });

    test('a page whose shell carries its snapshot draws it at once, with no loading line and nothing busy', async () => {
      // Every page that reads inert JSON, drawn from its shell alone: no
      // state is posted.
      const index = buildWorkspaceIndex(new Map([['notes/a.md', parseMarkdown('notes/a.md', '# A #project/atlas\n- [ ] Call\n')]]));
      store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
      const snapshots: Partial<Record<string, unknown>> = {
        stats: createDeckardStatsSnapshot(index, store.reader.value, [], Date.now()),
        calendar: createCalendar(index, '2026-09', createQueryContext(Date.now())),
        calendarPage: createCalendar(index, '2026-09', createQueryContext(Date.now()), { dayPanel: true, layout: 'page' }),
        sidebarNotes: {
          ...createSidebarSnapshot(index, 'notes/a.md', index.files.get('notes/a.md'), { now: Date.now(), tagTitleDisplayMode: 'inline' }),
          parkedTags: [],
        },
      };
      // A calendar and Related Notes still say they are ready when they load,
      // as they always have, so the host sends a snapshot newer than the one
      // the HTML carried.
      const asks: Partial<Record<string, unknown[]>> = { calendar: [{ type: 'ready' }], calendarPage: [{ type: 'ready' }], sidebarNotes: [{ type: 'ready' }] };
      const embedding = PAGES.filter((entry) => entry.readsInertState);
      assert.ok(embedding.length >= 1, 'at least Stats reads its first snapshot from its shell');
      for (const entry of embedding) {
        assert.ok(snapshots[entry.id], `${entry.title}: a snapshot to embed`);
        page = openWebviewPage(renderPage(entry.id, { state: snapshots[entry.id] }));
        await Promise.resolve();
        const app = page.find('#app');
        assert.strictEqual(app.localName, 'main', `${entry.title}: #app is the page's main`);
        assert.strictEqual(app.getAttribute('aria-busy'), null, `${entry.title} is not busy`);
        assert.strictEqual(page.findAll('#app .loading').length, 0, `${entry.title}: no loading line`);
        assert.ok(app.firstElementChild, `${entry.title} drew its snapshot`);
        assert.deepStrictEqual(page.posted, asks[entry.id] ?? [], `${entry.title} asked for nothing`);
        page.dispose();
        page = undefined;
      }
    });

    test('the sidebar\'s indexing count shows at once and keeps the page busy', async () => {
      page = openWebviewPage(renderPage('sidebarNotes'), {
        state: 'loading', progress: { completed: 412, total: 3760 }, notes: [], activeTags: [], tagTitleDisplayMode: 'inline',
      });
      await Promise.resolve();
      assert.strictEqual(page.text('.loading.is-immediate'), 'Indexing this workspace: 412 of 3,760 notes read…');
      assert.strictEqual(page.find('#app').getAttribute('aria-busy'), 'true');
    });

    test('a page waiting on the first scan says how far it has got', () => {
      page = openWebviewPage(renderPage('searchPage'));
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
      search.send(createSearchPageSnapshot(index, store!.reader.value, '#project/atlas AND lift', { queryContext: createQueryContext(Date.now()) }));
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
      page = openWebviewPage(renderPage('notesGraph'));
      keyFocus(page, '#link-distance');
      assert.match(String(tip(page)?.textContent), /length of visible links/);
    });

    test('no control on any page carries a native title', () => {
      // A title never shows on keyboard focus; a control says it with
      // data-tip. Non-focusable spans and a select's options may keep one.
      // The page text is read while a page's markup is template text, and
      // every surface's drawn DOM always (the test:dom goldens), which is
      // all a compiled page leaves to read; the lint rule on .tsx covers the
      // states no surface draws.
      const control = /<(button|summary|input|select|textarea|a)\b[^<>]*\btitle=/;
      const focusable = /<[a-z]+\b(?=[^<>]*\btabindex=)[^<>]*\btitle=/;
      for (const [name, render] of pages) {
        const html = render();
        const found = html.match(control) ?? html.match(focusable);
        assert.strictEqual(found, null, `${name}: ${found?.[0].slice(0, 120)}`);
      }
      // As the regular expressions read it: any attribute named title, or
      // ending in -title, on a control or on anything with a tabindex.
      const titled = (element: Element): boolean =>
        [...element.attributes].some((attribute) => /(^|[^\w])title$/.test(attribute.name));
      const tabbable = (element: Element): boolean =>
        [...element.attributes].some((attribute) => /(^|[^\w])tabindex$/.test(attribute.name));
      const read = readGoldens((surface, body) => {
        const found = [...body.querySelectorAll('*')].find((element) =>
          titled(element)
          && (/^(button|summary|input|select|textarea|a)$/.test(element.localName) || tabbable(element)));
        assert.strictEqual(found, undefined, `${surface} (as drawn): ${found?.outerHTML.slice(0, 120)}`);
      });
      assert.ok(read >= 22, `every surface's drawn DOM is read (${read})`);
    });

    /** A box in the window, and whether two share any of it. */
    type Box = { left: number; top: number; width: number; height: number };
    const overlaps = (a: Box, b: Box): boolean =>
      a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
    /**
     * Draws the elements given where the boxes say, the tip 200 by 40, in a
     * window 400 by 600, as a narrow sidebar is; jsdom lays nothing out.
     */
    const layOut = (target: WebviewPage, boxes: ReadonlyMap<Element, Box>): void => {
      Object.defineProperty(target.window, 'innerWidth', { configurable: true, value: 400 });
      Object.defineProperty(target.window, 'innerHeight', { configurable: true, value: 600 });
      Object.defineProperty(target.window.Element.prototype, 'getBoundingClientRect', {
        configurable: true,
        value(this: Element) {
          const box = this.id === 'deckard-tip' ? { left: 0, top: 0, width: 200, height: 40 } : boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 };
          return { x: box.left, y: box.top, ...box, right: box.left + box.width, bottom: box.top + box.height };
        },
      });
    };
    const tipBox = (target: WebviewPage): Box => {
      const shown = tip(target) as HTMLElement;
      assert.strictEqual(shown.hidden, false, 'the tip shows');
      return { left: parseFloat(shown.style.left), top: parseFloat(shown.style.top), width: 200, height: 40 };
    };

    test('a Related Notes card\'s tip leaves its relevance breakdown to be read', () => {
      // As David saw it: the breakdown hangs from the score past the card's
      // foot, and the card's tip was drawn over it.
      const index = buildWorkspaceIndex(new Map([
        ['notes/a.md', parseMarkdown('notes/a.md', '# Requirements #project/ghostline-relay\nClassify only authorized relay traffic.\n')],
        ['notes/b.md', parseMarkdown('notes/b.md', '# Relay drills #project/ghostline-relay\nThe pilot stays on relay traffic.\n')],
      ]));
      page = openWebviewPage(renderPage('sidebarNotes'), {
        ...createSidebarSnapshot(index, 'notes/a.md', index.files.get('notes/a.md'), { now: Date.now(), tagTitleDisplayMode: 'inline' }),
        parkedTags: [],
      });
      const card = page.find('article.note') as HTMLElement;
      const breakdown = card.querySelector('.relevance-tooltip') as Element;
      assert.ok(breakdown, 'the card holds its breakdown');
      const cardBox = { left: 10, top: 40, width: 380, height: 90 };
      const breakdownBox = { left: 160, top: 70, width: 220, height: 130 };
      layOut(page, new Map([[card, cardBox], [breakdown, breakdownBox]]));
      keyFocus(page, 'article.note');
      const placed = tipBox(page);
      assert.match(String(tip(page)?.textContent), /^Open this entry/);
      assert.ok(!overlaps(placed, breakdownBox), `the tip ${JSON.stringify(placed)} covers the breakdown`);
      assert.ok(!overlaps(placed, cardBox), `the tip ${JSON.stringify(placed)} covers the card`);
    });

    test('a tag pair\'s tip leaves the count it folds under its row to be read', () => {
      // As David saw it: the row's count opens under it on hover, in the
      // row's frame carried down, and the row's tip was drawn over it.
      const index = buildWorkspaceIndex(new Map(Array.from({ length: 3 }, (_, n) => [
        `notes/n${n}.md`,
        parseMarkdown(`notes/n${n}.md`, `# Shift ${n} #person/sable-ortiz #team/harbor\nOn the harbor shift.\n`),
      ])));
      store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
      const preferences = {
        ...store.reader.value,
        dashboardViewState: { ...store.reader.value.dashboardViewState, mode: 'home' as const },
        dashboardWidgets: [{ id: 'p', kind: 'tagPairs' as const, width: 'full' as const, count: 10 }],
      };
      const queryContext = createQueryContext(Date.now());
      page = openWebviewPage(renderPage('dashboard'), {
        ...createDashboardSnapshot({ index, preferences, queryContext }),
        widgets: createDashboardWidgets(index, preferences, { queryContext, upcomingDays: 7, tagTitleDisplayMode: 'inline' }),
      });
      const row = page.find('.home-row[data-query="#person/sable-ortiz AND #team/harbor"]') as HTMLElement;
      const detail = row.querySelector('.home-row-detail') as Element;
      const rowBox = { left: 10, top: 100, width: 380, height: 28 };
      // Folded under the row, a line of 16 px, 2 px past its foot.
      const detailBox = { left: 20, top: 130, width: 360, height: 16 };
      layOut(page, new Map([[row, rowBox], [detail, detailBox]]));
      keyFocus(page, '.home-row[data-query="#person/sable-ortiz AND #team/harbor"]');
      const placed = tipBox(page);
      assert.match(String(tip(page)?.textContent), /carry both.*Search for both\.$/);
      assert.ok(!overlaps(placed, detailBox), `the tip ${JSON.stringify(placed)} covers the count`);
      assert.ok(!overlaps(placed, rowBox), `the tip ${JSON.stringify(placed)} covers the row`);
    });

    test('every card or row that shows more of itself on hover says so to the tip', () => {
      // provenance.css folds a line under each of these, and a saved
      // search's criteria open under its row; the tip keeps off them only
      // where the card says it shows them (data-tip-around).
      const opening = '.note, .card, .task-row, .home-row, .tag-row, .board-card, .saved-filter-row';
      let seen = 0;
      const read = readGoldens((surface, body) => {
        // Help's cards and notes are callouts in prose: they fold nothing
        // under them and hold no tip.
        if (surface.startsWith('help')) {
          return;
        }
        for (const card of body.querySelectorAll(opening)) {
          seen += 1;
          assert.ok(card.hasAttribute('data-tip-around'), `${surface}: ${card.outerHTML.slice(0, 120)}`);
        }
      });
      assert.ok(read >= 22 && seen > 20, `every surface's drawn DOM is read (${read} surfaces, ${seen} cards)`);
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
