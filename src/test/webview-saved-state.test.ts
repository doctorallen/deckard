import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createCalendar } from '../ui/state/calendarState';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { createPreferences, TestPreferences } from './preferenceServices';
import { renderPage } from './pages';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';

/**
 * What each page reads back from the state VS Code kept for it across a
 * reload, pinned before Phase 6 rewrites the pages' state code
 * (docs/architecture/inventories/persisted-formats.md, rows 20 to 24b; the
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
    const open = (savedState: unknown, query = 'is:open', clock = false): WebviewPage => {
      store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
      const board = createTaskBoard({
        index: index(),
        preferences: { ...store.reader.value, taskBoardLayout: 'board' },
        search: { query },
        options: { queryContext: createQueryContext(NOW), statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' },
        tagTitleDisplayMode: 'inline',
      });
      page = openWebviewPage(renderPage('taskBoard'), board, { savedState, clock });
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

    test('keeps where it was scrolled, with its search', () => {
      // On a clock moved by hand: the search page's test above waits the
      // same scroll timer (shared/scroll.ts) out on the real one.
      const board = open(undefined, 'is:open', true);
      board.window.dispatchEvent(new board.window.Event('scroll'));
      board.clock!.advance(250);
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

    test('Home is still being arranged', () => {
      page = openWebviewPage(renderPage('dashboard'), snapshot('home', false), {
        savedState: { ...SAVED, dashboardMode: 'home' },
      });
      assert.strictEqual(mode(page), 'home');
      assert.ok(page.findAll('.home-widget.is-editing').length > 0, 'arranging');
    });

    test('a value it does not know reads as the default', () => {
      page = openWebviewPage(renderPage('dashboard'), snapshot('home', false), {
        savedState: { dashboardMode: 'tags', tagColumns: 7, tagNamespaceFilter: 5, editingHome: 0, homeHintDismissed: '' },
      });
      assert.strictEqual(mode(page), 'home');
      assert.strictEqual(page.findAll('.home-widget.is-editing').length, 0, 'not arranging');
      keep(page);
      assert.deepStrictEqual(page.savedState(), {
        dashboardMode: 'home', tagColumns: 2, browseQuery: '', tagNamespaceFilter: '', editingHome: false, homeHintDismissed: false,
      });
    });

    test('anything else it was left with reads as nothing kept', () => {
      for (const saved of [undefined, null, 'browse', 3, ['browse'], { dashboardMode: 'Browse', tagColumns: '3', editingHome: false }]) {
        const dashboard = openWebviewPage(renderPage('dashboard'), snapshot('home', false), { savedState: saved });
        keep(dashboard);
        assert.deepStrictEqual(dashboard.savedState(), {
          dashboardMode: 'home', tagColumns: 2, browseQuery: '', tagNamespaceFilter: '', editingHome: false, homeHintDismissed: false,
        }, JSON.stringify(saved));
        dashboard.dispose();
      }
    });

    test('writes the tag search as it is typed, though it never reads it back', () => {
      page = openWebviewPage(renderPage('dashboard'), snapshot('browse', false), { savedState: { ...SAVED, tagNamespaceFilter: '' } });
      assert.strictEqual((page.find('[data-action="search-browse"]') as HTMLInputElement).value, '');
      const search = page.find('[data-action="search-browse"]') as HTMLInputElement;
      search.value = 'beta';
      search.dispatchEvent(new page.window.Event('input', { bubbles: true }));
      assert.deepStrictEqual(page.savedState(), { ...SAVED, tagNamespaceFilter: '', browseQuery: 'beta' });
      page.click('[data-action="clear-tag-search"]');
      assert.deepStrictEqual(page.savedState(), { ...SAVED, tagNamespaceFilter: '', browseQuery: '' });
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

    /** What the page keeps after it is opened with `savedState` and asked to keep its settings. */
    const keptFrom = (savedState: unknown): Record<string, unknown> => {
      const opened = openWebviewPage(renderPage('notesGraph'), undefined, { savedState });
      try {
        persist(opened);
        return opened.savedState() as Record<string, unknown>;
      } finally {
        opened.dispose();
      }
    };

    test('reads anything but a record of settings as nothing kept', () => {
      for (const saved of [undefined, null, false, 'graph', 7, true, []]) {
        const kept = keptFrom(saved);
        assert.strictEqual(kept.linkDistance, 32, JSON.stringify(saved));
        assert.strictEqual(kept.showNotes, true, JSON.stringify(saved));
        assert.deepStrictEqual(kept.camera, { x: 0, y: 0, k: 1 }, JSON.stringify(saved));
      }
    });

    test('takes any value but undefined as it was kept, empty and null among them', () => {
      const kept = keptFrom({ showNotes: 0, search: '', group: null, selectedTags: 'atlas', linkDensity: 'many' });
      assert.strictEqual(kept.showNotes, 0);
      assert.strictEqual(kept.search, '');
      assert.strictEqual(kept.group, null);
      assert.strictEqual(kept.selectedTags, 'atlas');
      assert.strictEqual(kept.linkDensity, 'many');
    });

    test('takes a camera whose zoom reads as a finite number as it is, and any other as the default', () => {
      assert.deepStrictEqual(keptFrom({ camera: { x: 4, y: 5, k: '2' } }).camera, { x: 4, y: 5, k: '2' });
      assert.deepStrictEqual(keptFrom({ camera: { x: 4, y: 5, k: null } }).camera, { x: 4, y: 5, k: null });
      assert.deepStrictEqual(keptFrom({ camera: { k: 3 } }).camera, { k: 3 }, 'no pan is kept as none');
      assert.deepStrictEqual(keptFrom({ camera: { x: 4, y: 5, k: 'near' } }).camera, { x: 0, y: 0, k: 1 });
      assert.deepStrictEqual(keptFrom({ camera: { x: 4, y: 5 } }).camera, { x: 0, y: 0, k: 1 });
      assert.deepStrictEqual(keptFrom({ camera: 'here' }).camera, { x: 0, y: 0, k: 1 });
    });

    test('keeps only the settings it knows, in the order of its defaults, then the camera', () => {
      const kept = keptFrom({ retired: true, camera: { x: 1, y: 2, k: 3 }, linkDistance: 50 });
      assert.deepStrictEqual(Object.keys(kept), [
        'showNotes', 'showTasks', 'showTags', 'showOrphans', 'showParked', 'onlyWrittenLinks', 'selectedTags', 'group',
        'search', 'nodeSize', 'linkThickness', 'linkDensity', 'tagSpecificity', 'bridgeStrength', 'showAllLinks',
        'headings', 'labelThreshold', 'centerStrength', 'clusterCohesion', 'communitySpacing', 'repelStrength',
        'linkStrength', 'linkDistance', 'camera',
      ]);
      assert.strictEqual(kept.linkDistance, 50);
    });
  });

  suite('Related Notes (row 24b)', () => {
    /** One of 120 results, each its own note. */
    const result = (number: number) => ({
      sectionId: `section-${number}`, filePath: `notes/n${number}.md`, title: `Note ${number}`, fileName: `n${number}.md`, sourceLine: 1,
      headingPath: [], titleTags: [], matchedTags: [], matchCount: 1, totalTagCount: 1, overlap: 1, relevanceScore: 50,
    });
    const entry = { filePath: 'notes/standup.md', title: 'standup', line: 2, text: '[[atlas]] depends on sign-off.', headingPath: ['Risks'], sectionText: 'The vendor is late.' };
    /** A note with six tags, 120 related results, a line that links here, and a mention. */
    const SNAPSHOT = {
      activeFileName: 'today.md',
      activeTags: ['#a', '#b', '#c', '#d', '#e', '#f'].map((key) => ({ key, label: key, weight: 1 })),
      notes: Array.from({ length: 120 }, (_, number) => result(number)),
      relatedNotesSortMode: 'tags',
      tagTitleDisplayMode: 'inline',
      state: 'ready',
      links: {
        linkedFromNotes: [{ filePath: entry.filePath, title: entry.title, entries: [entry], linkCount: 1 }],
        linkedFromCount: 1,
        linkedFromNoteCount: 1,
        mentions: [{ ...entry, filePath: 'notes/old.md', line: 3, startColumn: 4, endColumn: 9, name: 'atlas' }],
        mentionCount: 1,
      },
      parkedTags: [],
    };
    /** The list SNAPSHOT shows, as the view names it for Show more. */
    const LIST = JSON.stringify(['ready', 'today.md', null, 'tags', null, false]);
    const open = (savedState: unknown, snapshot: unknown = SNAPSHOT): WebviewPage => {
      page = openWebviewPage(renderPage('sidebarNotes'), snapshot, { savedState });
      return page;
    };
    /** What the view shows of the reader's choices. */
    const shown = (target: WebviewPage) => ({
      contextOpen: (target.find('details.active-file') as HTMLDetailsElement).open,
      linked: (target.find('[data-links-group="linked"]') as HTMLDetailsElement).open,
      mentions: (target.find('[data-links-group="mentions"]') as HTMLDetailsElement).open,
      tags: target.findAll('.active-tag-open').length,
      sections: target.findAll('.link-section').map((section) => section.textContent),
      cards: target.findAll('.note-list > .note').length,
    });
    const FRESH = { contextOpen: false, linked: true, mentions: false, tags: 4, sections: [], cards: 50 };

    test('comes back as the reader left it', () => {
      const back = open({
        scrollY: 120,
        noteLimit: 100,
        noteListKey: LIST,
        showEveryActiveTag: true,
        contextOpen: true,
        linksOpen: { linked: false, mentions: true },
        openLinkSections: ['notes/standup.md:2'],
      });
      assert.deepStrictEqual(shown(back), { contextOpen: true, linked: false, mentions: true, tags: 6, sections: ['The vendor is late.'], cards: 100 });
    });

    test('a list it did not count Show more for starts over', () => {
      assert.strictEqual(shown(open({ noteLimit: 100, noteListKey: '["ready","other.md",null,"tags",null,false]' })).cards, 50);
    });

    test('opens Refine\'s facets and the day\'s groups it left open', () => {
      const values = Array.from({ length: 8 }, (_, number) => ({ label: `#t${number}`, count: 1, clause: `#t${number}` }));
      const refine = open({ expandedRefine: ['tags'] }, {
        activeTags: [], notes: [], tagTitleDisplayMode: 'inline', state: 'refine', parkedTags: [],
        refine: {
          page: 'search', title: 'Atlas', resultKinds: ['notes'],
          query: {
            text: '#project/atlas', terms: [], canAppend: true, isAdvanced: false, diagnostics: [], builder: { join: 'and', items: [] }, tags: [],
            suggestions: { fields: [], values: {}, operators: {}, conditions: [], recent: [], aliases: {} }, matchCounts: { notes: 8, tasks: 0 },
            facets: [{ id: 'tags', label: 'Tags', applied: [], values }],
          },
        },
      });
      assert.strictEqual(refine.findAll('.refine-value').length, 8);
      refine.dispose();
      // Seven tasks due on one day, two more than its group shows folded.
      const busy = buildWorkspaceIndex(new Map([['notes/busy.md', parseMarkdown('notes/busy.md', Array.from({ length: 7 }, (_, number) => `- [ ] Task ${number} 📅 2026-09-21`).join('\n'))]]));
      const daySnapshot = {
        activeTags: [], notes: [], tagTitleDisplayMode: 'inline', state: 'calendarDay', parkedTags: [],
        calendarDay: createCalendar(busy, '2026-09', createQueryContext(NOW), { dayPanel: true, selectedDate: '2026-09-21' }).selected,
      };
      const folded = open({}, daySnapshot);
      assert.strictEqual(folded.findAll('[data-action="show-group"][data-group="due"]').length, 1);
      folded.dispose();
      const day = open({ shownGroups: ['due'] }, daySnapshot);
      assert.strictEqual(day.findAll('[data-action="show-group"]').length, 0, 'the due group is whole');
      assert.strictEqual(day.findAll('.day-group[aria-label="Due"] .task-row').length, 7);
    });

    test('a value of the wrong kind reads as the choice a new view starts with', () => {
      const odd = [
        undefined,
        'state',
        [],
        { noteLimit: '100', noteListKey: LIST, showEveryActiveTag: 1, contextOpen: 'yes', linksOpen: 3, openLinkSections: 'notes/standup.md:2' },
        { noteLimit: Number.NaN, noteListKey: LIST, linksOpen: { linked: 'no', mentions: null }, openLinkSections: [2] },
      ];
      for (const saved of odd) {
        assert.deepStrictEqual(shown(open(saved)), FRESH, JSON.stringify(saved));
        page?.dispose();
        page = undefined;
      }
    });

    test('keeps what the reader chose, and where it was scrolled', async () => {
      const view = open({ scrollY: 40 });
      assert.deepStrictEqual(view.savedState(), {
        scrollY: 40, noteLimit: 50, noteListKey: LIST, showEveryActiveTag: false, contextOpen: false,
        linksOpen: { linked: true, mentions: false }, openLinkSections: [], expandedRefine: [], shownGroups: [],
      });
      view.click('[data-action="show-more-notes"]');
      view.click('[data-action="show-every-active-tag"]');
      view.click('[data-action="toggle-link-section"]');
      assert.deepStrictEqual(view.savedState(), {
        scrollY: 40, noteLimit: 100, noteListKey: LIST, showEveryActiveTag: true, contextOpen: false,
        linksOpen: { linked: true, mentions: false }, openLinkSections: ['notes/standup.md:2'], expandedRefine: [], shownGroups: [],
      });
      // A fold says it opened with a toggle event, queued as a task; the
      // page keeps the fold when the event comes, so the test waits for
      // that event, not for a time that a busy run can pass first.
      const fold = view.find('details.active-file') as HTMLDetailsElement;
      const toggled = new Promise((resolve) => fold.addEventListener('toggle', resolve, { once: true }));
      fold.open = true;
      await toggled;
      assert.strictEqual((view.savedState() as { contextOpen: boolean }).contextOpen, true, 'a fold is kept as the reader leaves it');
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
