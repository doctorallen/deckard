import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createCalendar } from '../ui/state/calendarState';
import { createDashboardSnapshot, createSearchPageSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { createPreferences, TestPreferences } from './preferenceServices';
import { renderPage } from './pages';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * What each page reads back from the state VS Code kept for it across a
 * reload, pinned before Phase 6 rewrites the pages' state code
 * (docs/architecture/inventories/persisted-formats.md, rows 20 to 24; the
 * host's reads of rows 20 and 21 are pinned in searchPage.e2e.js and
 * taskBoard.e2e.js). A release's saved state must keep reopening the page
 * it was saved from, so these hold the pages to what they draw from each
 * shape today, odd values included.
 */
suite('Webview saved state', () => {
  let page: WebviewPage | undefined;
  let store: TestPreferences | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.repository.dispose();
    store = undefined;
  });

  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const NOTES: Record<string, string> = {
    'notes/atlas.md': '# Atlas #project/atlas #topic/replicants\nThe lift is stuck.\n- [ ] Chase it #project/atlas 📅 2026-09-21\n',
    'notes/beta.md': '# Beta #project/beta #status/doing\nKickoff.\n',
    'notes/plain.md': '# Plain #untagged\nNo namespace.\n',
  };
  const index = () =>
    buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([path, content]) => [path, parseMarkdown(path, content)])));
  const preferences = () => {
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    return store.reader.value;
  };

  suite('the search page (row 20)', () => {
    const open = (savedState: unknown): WebviewPage => {
      const snapshot = createSearchPageSnapshot(index(), preferences(), '#project/atlas', { queryContext: createQueryContext(NOW) });
      page = openWebviewPage(renderPage('searchPage'), snapshot, { savedState });
      return page;
    };
    const selectedTab = (target: WebviewPage) => target.find('[role="tab"][aria-selected="true"]').getAttribute('data-tab');

    test('opens on the tab it was saved on, and keeps it as the reader\'s choice', () => {
      const tasks = open({ query: '#project/atlas', origin: '#project/atlas', tab: 'tasks' });
      assert.strictEqual(selectedTab(tasks), 'tasks');
      assert.deepStrictEqual(tasks.savedState(), { query: '#project/atlas', origin: '', tab: 'tasks' });
    });

    test('a tab it does not know is not a choice, so the page picks', () => {
      const unknown = open({ query: '#project/atlas', origin: '#project/atlas', tab: 'cards' });
      assert.strictEqual(selectedTab(unknown), 'notes');
      assert.deepStrictEqual(unknown.savedState(), { query: '#project/atlas', origin: '' });
    });

    test('keeps a saved scroll only for the search it was scrolled in', () => {
      const same = open({ query: '#project/atlas', origin: '', scrollY: 240 });
      assert.deepStrictEqual(same.savedState(), { query: '#project/atlas', origin: '', scrollY: 240 });
      same.dispose();
      const other = open({ query: '#project/beta', origin: '', scrollY: 240 });
      assert.deepStrictEqual(other.savedState(), { query: '#project/atlas', origin: '' });
    });

    test('anything else it was left with is not read: only the search is kept', () => {
      for (const saved of [undefined, null, '#project/atlas', { query: '#project/atlas', scrollY: '240' }, { query: 7, scrollY: 240 }, { query: '#project/atlas', extra: true }, { tagKey: 'project/atlas' }]) {
        const search = open(saved);
        assert.deepStrictEqual(search.savedState(), { query: '#project/atlas', origin: '' }, JSON.stringify(saved));
        search.dispose();
        page = undefined;
      }
    });

    test('keeps where it was scrolled, with its search', async () => {
      const search = open(undefined);
      search.window.dispatchEvent(new search.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.deepStrictEqual(search.savedState(), { query: '#project/atlas', origin: '', scrollY: 0 });
    });
  });

  suite('the Task Board (row 21)', () => {
    const open = (savedState: unknown, query = 'is:open'): WebviewPage => {
      store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
      const board = createTaskBoard({
        index: index(),
        preferences: { ...store.reader.value, taskBoardLayout: 'board' },
        search: { query },
        options: { queryContext: createQueryContext(NOW), statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' },
        tagTitleDisplayMode: 'inline',
      });
      page = openWebviewPage(renderPage('taskBoard'), board, { savedState });
      return page;
    };

    test('keeps its search, and a saved scroll only for the search it was scrolled in', () => {
      const same = open({ query: 'is:open', scrollY: 240 });
      assert.deepStrictEqual(same.savedState(), { query: 'is:open', scrollY: 240 });
      same.dispose();
      const other = open({ query: '#project/atlas', scrollY: 240 });
      assert.deepStrictEqual(other.savedState(), { query: 'is:open' });
    });

    test('anything else it was left with is not read: only the search is kept', () => {
      for (const saved of [undefined, null, 'is:open', { query: 'is:open', scrollY: '240' }, { query: 7, scrollY: 240 }, { query: 'is:open', extra: true }]) {
        const board = open(saved);
        assert.deepStrictEqual(board.savedState(), { query: 'is:open' }, JSON.stringify(saved));
        board.dispose();
        page = undefined;
      }
    });

    test('keeps where it was scrolled, with its search', async () => {
      const board = open(undefined);
      board.window.dispatchEvent(new board.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.deepStrictEqual(board.savedState(), { query: 'is:open', scrollY: 0 });
    });
  });

  suite('the Dashboard (row 22)', () => {
    /** The snapshot the host sends, without the fields that override what the page kept. */
    const snapshot = (mode: 'home' | 'browse', fromHost: boolean) => {
      const built = index();
      const prefs = { ...preferences(), dashboardViewState: { mode, tagSearchQuery: '' } };
      const queryContext = createQueryContext(NOW);
      const full = {
        ...createDashboardSnapshot({ index: built, preferences: prefs, queryContext }),
        widgets: createDashboardWidgets(built, prefs, { queryContext, upcomingDays: 7, tagTitleDisplayMode: 'inline' }),
      } as Record<string, unknown>;
      if (!fromHost) {
        delete full.viewState;
        delete full.tagColumns;
      }
      return full;
    };
    const SAVED = {
      dashboardMode: 'browse',
      tagColumns: 3,
      browseQuery: 'atlas',
      tagNamespaceFilter: 'project',
      editingHome: true,
      homeHintDismissed: true,
    };
    const mode = (target: WebviewPage) => target.find('[role="tab"][aria-selected="true"]').getAttribute('data-dashboard-mode');
    /** The page saves what it holds only when the reader changes something; choosing the tab it is on is enough. */
    const keep = (target: WebviewPage) => target.click('[role="tab"][aria-selected="true"]');

    test('draws the mode, columns, and namespace it kept, and never reads back the tag search', () => {
      page = openWebviewPage(renderPage('dashboard'), snapshot('home', false), { savedState: SAVED });
      assert.strictEqual(mode(page), 'browse', 'the Tags mode');
      assert.strictEqual(page.find('[data-action="set-columns"][aria-pressed="true"]').getAttribute('data-value'), '3');
      assert.strictEqual((page.find('[data-action="set-tag-namespace"]') as HTMLSelectElement).value, 'project');
      assert.deepStrictEqual(
        [...new Set(page.findAll('.tag-row [data-tag-key], .tag-row[data-tag-key]').map((row) => row.getAttribute('data-tag-key')))].sort(),
        ['#project/atlas', '#project/beta'],
        'only the namespace kept; the tag search was not',
      );
      keep(page);
      assert.deepStrictEqual(page.savedState(), { ...SAVED, browseQuery: '' });
    });

    test('what the host sends wins over the mode and columns it kept', () => {
      page = openWebviewPage(renderPage('dashboard'), snapshot('home', true), { savedState: SAVED });
      assert.strictEqual(mode(page), 'home');
    });

    test('Home is still being arranged, and its hint stays put away', () => {
      page = openWebviewPage(renderPage('dashboard'), snapshot('home', false), {
        savedState: { ...SAVED, dashboardMode: 'home' },
      });
      assert.strictEqual(mode(page), 'home');
      assert.ok(page.findAll('.home-widget.is-editing').length > 0, 'arranging');
      assert.strictEqual(page.findAll('[data-action="dismiss-home-hint"]').length, 0, 'no hint');
    });

    test('a value it does not know reads as the default', () => {
      page = openWebviewPage(renderPage('dashboard'), snapshot('home', false), {
        savedState: { dashboardMode: 'tags', tagColumns: 7, tagNamespaceFilter: 5, editingHome: 0, homeHintDismissed: '' },
      });
      assert.strictEqual(mode(page), 'home');
      assert.ok(page.find('[data-action="dismiss-home-hint"]'), 'the hint shows');
      assert.strictEqual(page.findAll('.home-widget.is-editing').length, 0, 'not arranging');
      keep(page);
      assert.deepStrictEqual(page.savedState(), {
        dashboardMode: 'home', tagColumns: 2, browseQuery: '', tagNamespaceFilter: '', editingHome: false, homeHintDismissed: false,
      });
    });
  });

  suite('the Notes Graph (row 23)', () => {
    /** Every key the graph keeps, each away from its default, and the camera. */
    const SAVED = {
      showNotes: false,
      showTasks: false,
      showTags: true,
      showOrphans: false,
      showParked: true,
      onlyWrittenLinks: true,
      selectedTags: ['#project/atlas'],
      group: '#project',
      search: 'lift',
      nodeSize: 2,
      linkThickness: 1.5,
      linkDensity: 0.5,
      tagSpecificity: 0.5,
      bridgeStrength: 0.5,
      showAllLinks: true,
      headings: 'never',
      labelThreshold: 2,
      centerStrength: 0.6,
      clusterCohesion: 2,
      communitySpacing: 2,
      repelStrength: 500,
      linkStrength: 1.5,
      linkDistance: 100,
      camera: { x: 12, y: -8, k: 2.5 },
    };
    const TOGGLES: Record<string, keyof typeof SAVED> = {
      'show-notes': 'showNotes',
      'show-tasks': 'showTasks',
      'show-tags': 'showTags',
      'show-orphans': 'showOrphans',
      'show-parked': 'showParked',
      'only-written-links': 'onlyWrittenLinks',
      'show-all-links': 'showAllLinks',
    };
    const SLIDERS: Record<string, keyof typeof SAVED> = {
      'node-size': 'nodeSize',
      'link-thickness': 'linkThickness',
      'link-density': 'linkDensity',
      'tag-specificity': 'tagSpecificity',
      'bridge-strength': 'bridgeStrength',
      'label-threshold': 'labelThreshold',
      'center-strength': 'centerStrength',
      'cluster-cohesion': 'clusterCohesion',
      'community-spacing': 'communitySpacing',
      'repel-strength': 'repelStrength',
      'link-strength': 'linkStrength',
      'link-distance': 'linkDistance',
    };
    /** Asks the page to keep its settings without changing one: Never, chosen again. */
    const persist = (target: WebviewPage) => target.click('[data-headings="never"]');

    test('draws every control as it was kept', () => {
      page = openWebviewPage(renderPage('notesGraph'), undefined, { savedState: SAVED });
      for (const [id, key] of Object.entries(TOGGLES)) {
        assert.strictEqual((page.find(`#${id}`) as HTMLInputElement).checked, SAVED[key], id);
      }
      for (const [id, key] of Object.entries(SLIDERS)) {
        assert.strictEqual((page.find(`#${id}`) as HTMLInputElement).value, String(SAVED[key]), id);
      }
      assert.strictEqual(page.text('#node-size-out'), '2.0');
      assert.strictEqual(page.text('#repel-strength-out'), '500');
      assert.strictEqual(page.find('[data-headings][aria-pressed="true"]').getAttribute('data-headings'), 'never');
      assert.strictEqual((page.find('#search') as HTMLInputElement).value, 'lift');
    });

    test('keeps every key and the camera as it was given them', () => {
      page = openWebviewPage(renderPage('notesGraph'), undefined, { savedState: SAVED });
      persist(page);
      assert.deepStrictEqual(page.savedState(), SAVED);
    });

    test('takes a saved value as is, of whatever type, and the defaults for the rest', () => {
      page = openWebviewPage(renderPage('notesGraph'), undefined, { savedState: { nodeSize: '2', group: 7, headings: 'never' } });
      persist(page);
      const kept = page.savedState() as Record<string, unknown>;
      assert.strictEqual(kept.nodeSize, '2');
      assert.strictEqual(kept.group, 7);
      assert.strictEqual(kept.linkDistance, 32, 'a key it was not given is its default');
      assert.deepStrictEqual(kept.camera, { x: 0, y: 0, k: 1 }, 'no camera is the default camera');
    });

    test('draws with the camera it kept until a graph arrives and is framed', () => {
      page = openWebviewPage(renderPage('notesGraph'), undefined, { savedState: SAVED, canvas: true });
      page.flushFrames(1);
      assert.strictEqual(page.text('#zoom-readout'), '250%');
    });
  });

  suite('the calendar page (row 24)', () => {
    const open = (savedState: unknown): WebviewPage => {
      page = openWebviewPage(
        renderPage('calendarPage'),
        createCalendar(index(), '2026-09', createQueryContext(NOW), { dayPanel: true, layout: 'page' }),
        { savedState },
      );
      return page;
    };
    const layout = (target: WebviewPage) =>
      target.find('[data-action="set-calendar-layout"][aria-pressed="true"]').getAttribute('data-value');

    test('opens on the week it was left on', () => {
      const week = open({ layout: 'week' });
      assert.strictEqual(layout(week), 'week');
      assert.ok(week.find('.calendar-page-body').classList.contains('is-week'));
    });

    test('anything but week reads as the month', () => {
      for (const saved of [undefined, {}, { layout: 'month' }, { layout: 'Week' }, { layout: 7 }]) {
        const month = open(saved);
        assert.strictEqual(layout(month), 'month', JSON.stringify(saved));
        assert.ok(!month.find('.calendar-page-body').classList.contains('is-week'));
        month.dispose();
        page = undefined;
      }
    });
  });
});
