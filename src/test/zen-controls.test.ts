import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createCalendar } from '../ui/state/calendarState';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import type { PageChrome } from '../ui/webview/components';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/** The look a page is drawn in: Corpo, with Zen on or off. */
export const chromeOf = (zen: boolean): PageChrome => ({ theme: 'corpo', zen });

/** Everything a reader can act on, as the zen-mode suite has always counted it. */
export const CONTROLS = 'button, input, select, a, summary, [data-action], [tabindex]';

/**
 * Whether a control is drawn at no opacity until its area is pointed at or
 * holds focus: under Zen, it is, or is in, a `data-zen-reveal` target
 * inside a `data-zen-region`; at any step, it is in a row's `data-reveal` target inside its region,
 * and nothing around it keeps it drawn (shared/reveal.css).
 */
export function quietAtRest(element: Element): boolean {
  const kept = (target: Element) => Boolean(target.closest('[data-reveal-keep]'));
  const zen = element.ownerDocument.body.getAttribute('data-controls') === 'quiet' ? element.closest('[data-zen-reveal]') : null;
  if (zen && zen.parentElement?.closest('[data-zen-region]') && !kept(zen)) {
    return true;
  }
  const row = element.closest('[data-reveal]');
  return Boolean(row && row.parentElement?.closest('[data-reveal-region]') && !kept(row));
}

/** Whether a control is out of sight at rest whatever Zen says: hidden, or in a closed disclosure other than as its summary. */
export function foldedAway(element: Element): boolean {
  if (element.closest('[hidden]')) {
    return true;
  }
  for (let details = element.closest('details:not([open])'); details; details = details.parentElement?.closest('details:not([open])') ?? null) {
    const summary = details.querySelector(':scope > summary');
    if (!summary || !summary.contains(element)) {
      return true;
    }
  }
  return false;
}

/** A control's name, as a reader would say it. */
export function nameOf(element: Element): string {
  return (element.getAttribute('aria-label') || (element.textContent ?? '').trim() || element.getAttribute('placeholder') || element.tagName.toLowerCase()).replace(/\s+/g, ' ');
}

/** The controls Zen draws at rest outside `skip`, by name, in page order. */
export function drawnAtRest(page: WebviewPage, skip?: string): string[] {
  return page.findAll(CONTROLS)
    .filter((element) => !(skip && element.closest(skip)))
    .filter((element) => !foldedAway(element) && !quietAtRest(element))
    .map(nameOf);
}

/**
 * Zen quiets the tools under a page's bar in place (plan 29, R22): each is
 * drawn at no opacity until its area is pointed at or holds focus, and
 * stays in the DOM, the Tab order and the accessibility tree. These check
 * what each page marks, as the reveal rule reads the marks.
 */
suite('Zen quiets controls in place', () => {
  const pages: WebviewPage[] = [];
  teardown(() => {
    pages.splice(0).forEach((page) => page.dispose());
  });

  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const queryContext = createQueryContext(NOW);
  const NOTES: Record<string, string> = {
    'notes/one.md': '# One #project/atlas #risk/vendor\nThe lift is stuck.\n- [ ] Chase it 📅 2026-09-01 #project/atlas\n- [ ] Book the room 📅 2026-09-24',
    'notes/two.md': '# Two #project/atlas\nMore prose.\n- [ ] Call Ren',
  };
  const index = () => buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([path, text]) => [path, parseMarkdown(path, text)])));
  const preferences = (extra: Record<string, unknown> = {}) => {
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      return { ...store.reader.value, ...extra } as never;
    } finally {
      store.repository.dispose();
    }
  };
  const open = (html: string, state: unknown): WebviewPage => {
    const page = openWebviewPage(html, state);
    pages.push(page);
    return page;
  };

  const board = (zen: boolean, extra: Record<string, unknown> = {}, query = '') =>
    open(renderPage('taskBoard', { chrome: chromeOf(zen) }), createTaskBoard({
      index: index(),
      preferences: preferences({ taskBoardLayout: 'board', ...extra }),
      search: { query },
      options: { queryContext, format: 'emoji' },
    }));
  const searchPage = (zen: boolean, extra: Record<string, unknown> = {}) =>
    open(renderPage('searchPage', { chrome: chromeOf(zen) }), createSearchPageSnapshot(index(), preferences(extra), '#project/atlas', { queryContext }));

  const home = (zen: boolean) => {
    const built = index();
    const chosen = preferences();
    return open(renderPage('dashboard', { chrome: chromeOf(zen) }), {
      ...createDashboardSnapshot({ index: built, preferences: chosen, queryContext }),
      widgets: createDashboardWidgets(built, chosen, { queryContext }),
    });
  };

  test('marks the body only under Zen, so the regions act only then', () => {
    assert.strictEqual(board(false).document.body.getAttribute('data-controls'), null);
    assert.strictEqual(board(true).document.body.getAttribute('data-controls'), 'quiet');
  });

  test('the Task board draws its bar and the search field at rest, and quiets the rest of its search card', () => {
    const page = board(true);
    assert.deepStrictEqual(
      drawnAtRest(page, '.board-area'),
      ['Deckard: go to another page', 'Add task', 'More: Save search, List in Tasks view, Export tasks, and more', 'Builder', 'Search tasks', 'Search'],
    );
    for (const selector of ['.segmented.task-layout', '.task-board-group', '[data-action="set-task-sort"]', '[data-action="toggle-available"]']) {
      assert.ok(quietAtRest(page.find(selector)), `${selector} is quiet at rest`);
      assert.ok(page.find(selector).closest('.query-workspace[data-zen-region]'), `${selector} shows from the search card`);
    }
    assert.ok(page.findAll('.board-add').every((add) => quietAtRest(add) && add.closest('.board-column[data-zen-region]')), "each column's + shows from its column");
  });

  test("the Task board keeps a Sort that isn't Rank, and Can start now while it is pressed", () => {
    const page = board(true, { taskSortMode: 'created' }, 'is:available');
    assert.ok(!quietAtRest(page.find('[data-action="set-task-sort"]')), 'a Sort other than Rank stays drawn');
    const available = page.find('[data-action="toggle-available"]');
    assert.strictEqual(available.getAttribute('aria-pressed'), 'true');
    assert.ok(!quietAtRest(available), 'Can start now stays drawn while pressed');
    assert.ok(quietAtRest(board(true).find('[data-action="toggle-available"]')), 'and is quiet while not');
  });

  test('a segmented group is quieted as one, never one segment', () => {
    for (const page of [board(true), searchPage(true)]) {
      for (const member of page.findAll('.segmented > *')) {
        assert.strictEqual(member.getAttribute('data-zen-reveal'), null, 'no segment carries the mark');
        assert.strictEqual(member.getAttribute('data-reveal'), null);
      }
    }
  });

  test("a search page quiets Sort and Bulk edit at its results heading, and keeps a Sort that isn't A-Z", () => {
    const page = searchPage(true);
    for (const selector of ['.result-sort', '[data-action="edit-results"]']) {
      const control = page.find(selector);
      assert.ok(quietAtRest(control), `${selector} is quiet at rest`);
      assert.ok(control.closest('.overview-tabs-row[data-zen-region], .overview-pane-header[data-zen-region]'), `${selector} shows from the results heading`);
    }
    assert.ok(!quietAtRest(searchPage(true, { tagOverviewSortMode: 'newest' }).find('.result-sort')), 'Newest stays drawn');
    // The tabs are a content switch, and never quieted.
    assert.ok(page.findAll('[data-action="set-result-tab"]').every((tab) => !quietAtRest(tab)));
  });

  test("Home quiets Customize at its tab row, and keeps the tabs and its tiles", () => {
    const page = home(true);
    const customize = page.find('.dashboard-customize');
    assert.ok(quietAtRest(customize));
    assert.ok(customize.closest('.dashboard-tabs-row[data-zen-region]'), 'it shows from the tab row');
    assert.ok(page.findAll('[data-action="set-dashboard-mode"]').every((tab) => !quietAtRest(tab)), 'Home | Tags is a content switch, and stays');
    assert.strictEqual(drawnAtRest(page).length, drawnAtRest(home(false)).length - 1, 'Customize is the one control Home quiets');
  });

  test("Context quiets its band's gear and its Related heading's Sort and gear, and keeps a Sort that isn't Relevance", () => {
    const sidebar = (mode: string) => open(renderPage('sidebarNotes', { chrome: chromeOf(true) }), {
      activeFileName: 'today.md',
      activeTags: [],
      notes: [{
        sectionId: 'section-1', filePath: 'notes/two.md', title: 'Two', fileName: 'two.md', sourceLine: 1, headingPath: ['Two'],
        titleTags: [], matchedTags: [], matchCount: 1, totalTagCount: 1, overlap: 1, relevanceScore: 50,
      }],
      state: 'ready',
      parkedTags: [],
      relatedNotesSortMode: mode,
      pages: { pages: [{ id: 'home', label: 'Home', description: '', detail: '' }], style: 'icons', current: undefined },
    });
    const page = sidebar('tags');
    const gears = page.findAll('details.view-options');
    assert.strictEqual(gears.length, 2, 'the band gear and the Related gear');
    assert.ok(gears.every((gear) => gear.getAttribute('data-zen-reveal') === '' && gear.parentElement?.closest('[data-zen-region]')));
    assert.ok(quietAtRest(page.find('.related-notes-sort')), 'Relevance is quiet at rest');
    assert.ok(page.findAll('.context-pages [data-action]').every((icon) => !quietAtRest(icon)), "the page icons are the band's job, and stay");
    assert.ok(!quietAtRest(sidebar('newest').find('.related-notes-sort')), 'Newest stays drawn');
  });

  test('a calendar quiets the week marks without a note on the page and in the sidebar, and keeps those with one', () => {
    const files = new Map([
      ['notes/2026-09-10.md', parseMarkdown('notes/2026-09-10.md', '# 2026-09-10\n- [ ] Call Ren 📅 2026-09-12')],
      ['notes/2026-W37.md', parseMarkdown('notes/2026-W37.md', '# 2026-W37')],
    ]);
    const calendarIndex = buildWorkspaceIndex(files);
    const context = createQueryContext(new Date(2026, 8, 13, 10).getTime());
    for (const page of [
      open(renderPage('calendarPage', { chrome: chromeOf(true) }), createCalendar(calendarIndex, '2026-09', context, { dayPanel: true, layout: 'page' })),
      open(renderPage('calendar', { chrome: chromeOf(true) }), createCalendar(calendarIndex, '2026-09', context)),
    ]) {
      const marks = page.findAll('.week-label');
      assert.ok(marks.length > 0);
      for (const mark of marks) {
        assert.ok(mark.closest('.calendar-row[data-zen-region]'), 'each mark shows from its week row');
        assert.strictEqual(quietAtRest(mark), !mark.classList.contains('has-note'), 'a mark is quiet at rest unless its week has a note');
      }
    }
  });
});
