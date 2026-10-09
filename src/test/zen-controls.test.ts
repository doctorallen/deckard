import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { createCalendar } from '../ui/state/calendarState';
import { createDashboardSnapshot } from '../ui/state/dashboardState';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createNotePageSnapshot } from '../ui/state/notePageState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { deckardThemeCss, type PageChrome } from '../ui/webview/components';
import type { DeckardTheme } from '../ui/webview/themeNames';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { PAGES, renderPage } from './pages';
import { pageSheets, themeSheet } from './sheets';
import { typedWorkspace } from './typedWorkspace';

/** The look a page is drawn in: Corpo, with Zen on or off. */
const chromeOf = (zen: boolean): PageChrome => ({ theme: 'corpo', zen });

/** Everything a reader can act on, as the zen-mode suite has always counted it. */
const CONTROLS = 'button, input, select, a, summary, [data-action], [tabindex]';

/**
 * Whether a control is drawn at no opacity until its area is pointed at or
 * holds focus: under Zen, it is, or is in, a `data-zen-reveal` target
 * inside a `data-zen-region`; at any step, it is in a row's `data-reveal` target inside its region,
 * and nothing around it keeps it drawn (shared/reveal.css).
 */
function quietAtRest(element: Element): boolean {
  const kept = (target: Element) => Boolean(target.closest('[data-reveal-keep]'));
  const zen = element.ownerDocument.body.getAttribute('data-controls') === 'quiet' ? element.closest('[data-zen-reveal]') : null;
  if (zen && zen.parentElement?.closest('[data-zen-region]') && !kept(zen)) {
    return true;
  }
  const row = element.closest('[data-reveal]');
  return Boolean(row && row.parentElement?.closest('[data-reveal-region]') && !kept(row));
}

/** Whether a control is out of sight at rest whatever Zen says: hidden, or in a closed disclosure other than as its summary. */
function foldedAway(element: Element): boolean {
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
function nameOf(element: Element): string {
  return (element.getAttribute('aria-label') || (element.textContent ?? '').trim() || element.getAttribute('placeholder') || element.tagName.toLowerCase()).replace(/\s+/g, ' ');
}

/** The controls Zen draws at rest outside `skip`, by name, in page order. */
function drawnAtRest(page: WebviewPage, skip?: string): string[] {
  return page.findAll(CONTROLS)
    .filter((element) => !(skip && element.closest(skip)))
    .filter((element) => !foldedAway(element) && !quietAtRest(element))
    .map(nameOf);
}

/** The pages a test opened, closed after it. */
const pages: WebviewPage[] = [];

/** Closes every page the test opened. */
function closePages(): void {
  pages.splice(0).forEach((page) => page.dispose());
}

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
const open = (html: string, state?: unknown): WebviewPage => {
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
  open(renderPage('searchPage', { chrome: chromeOf(zen) }), createSearchPageSnapshot(index(), preferences(extra), '#project/atlas', { queryContext, originQuery: '#project/atlas' }));

const home = (zen: boolean) => {
  const built = index();
  const chosen = preferences();
  return open(renderPage('dashboard', { chrome: chromeOf(zen) }), {
    ...createDashboardSnapshot({ index: built, preferences: chosen, queryContext }),
    widgets: createDashboardWidgets(built, chosen, { queryContext }),
  });
};

const calendarIndex = () => buildWorkspaceIndex(new Map([
  ['notes/2026-09-10.md', parseMarkdown('notes/2026-09-10.md', '# 2026-09-10\n- [ ] Call Ren 📅 2026-09-12')],
  ['notes/2026-W37.md', parseMarkdown('notes/2026-W37.md', '# 2026-W37')],
]));
const calendarContext = createQueryContext(new Date(2026, 8, 13, 10).getTime());
const calendarPage = (zen: boolean) =>
  open(renderPage('calendarPage', { chrome: chromeOf(zen) }), createCalendar(calendarIndex(), '2026-09', calendarContext, { dayPanel: true, layout: 'page', selectedDate: '2026-09-10' }));
const sidebarCalendar = (zen: boolean) =>
  open(renderPage('calendar', { chrome: chromeOf(zen) }), createCalendar(calendarIndex(), '2026-09', calendarContext));
const context = (zen: boolean, mode = 'tags') => open(renderPage('sidebarNotes', { chrome: chromeOf(zen) }), {
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
const graph = (zen: boolean) => open(renderPage('notesGraph', { chrome: chromeOf(zen) }));
/** A type's search page: its rows tab, sorted by a column, with rows that have no hub note. */
const typeSearchPage = (zen: boolean) =>
  open(renderPage('searchPage', { chrome: chromeOf(zen) }), {
    ...createSearchPageSnapshot(typedWorkspace(), preferences({ typeTables: { area: { sort: { column: 'system', direction: 'asc' } } } }), 'type = area', { queryContext, originQuery: 'type = area' }),
    parkedTags: [],
  });
/** The Note page on a typed row's note, with filled fields, a reverse, and empty ones folded. */
const notePage = (zen: boolean) =>
  open(renderPage('notePage', { chrome: chromeOf(zen) }), createNotePageSnapshot(typedWorkspace(), 'Teams/Credit.md', { queryContext, history: { back: false, forward: false }, visit: 1 }));

/**
 * Zen quiets the tools under a page's bar in place (plan 29, R22): each is
 * drawn at no opacity until its area is pointed at or holds focus, and
 * stays in the DOM, the Tab order and the accessibility tree. These check
 * what each page marks, as the reveal rule reads the marks.
 */
suite('Zen quiets controls in place', () => {
  teardown(closePages);

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

  test("a type's search page quiets each row's ⋯ and Create hub note on its rows, and keeps every cell, date, and the sort it is in", () => {
    const page = typeSearchPage(true);
    for (const control of page.findAll('[data-action="type-row-menu"], [data-action="create-row-hub"]')) {
      assert.ok(quietAtRest(control), `${nameOf(control)} is quiet at rest`);
      assert.ok(control.closest('.type-rows[data-zen-region]') && control.closest('.type-row[data-reveal-region]'), `${nameOf(control)} shows from its row`);
    }
    for (const kept of page.findAll('.type-table th button, .type-row .field-link, .type-sort-note [data-action="clear-type-sort"]')) {
      assert.ok(!quietAtRest(kept), `${nameOf(kept)} stays drawn`);
    }
    assert.ok(page.findAll('.type-no-hub').length > 0, 'a row with no hub note still says so');
    assert.ok(!quietAtRest(typeSearchPage(false).find('[data-action="set-result-tab"][data-tab="rows"]')), 'the rows tab is a content switch, and stays');
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
    const sidebar = (mode: string) => context(true, mode);
    const page = sidebar('tags');
    const gears = page.findAll('details.view-options');
    assert.strictEqual(gears.length, 2, 'the band gear and the Related gear');
    assert.ok(gears.every((gear) => gear.getAttribute('data-zen-reveal') === '' && gear.parentElement?.closest('[data-zen-region]')));
    assert.ok(quietAtRest(page.find('.related-notes-sort')), 'Relevance is quiet at rest');
    assert.ok(page.findAll('.context-pages [data-action]').every((icon) => !quietAtRest(icon)), "the page icons are the band's job, and stay");
    assert.ok(!quietAtRest(sidebar('newest').find('.related-notes-sort')), 'Newest stays drawn');
  });

  test('a calendar quiets the week marks without a note on the page and in the sidebar, and keeps those with one', () => {
    for (const page of [calendarPage(true), sidebarCalendar(true)]) {
      const marks = page.findAll('.week-label');
      assert.ok(marks.length > 0);
      for (const mark of marks) {
        assert.ok(mark.closest('.calendar-row[data-zen-region]'), 'each mark shows from its week row');
        assert.strictEqual(quietAtRest(mark), !mark.classList.contains('has-note'), 'a mark is quiet at rest unless its week has a note');
      }
    }
  });

  test('Refine folds over its facets, open at Full and closed under Zen, with the lead lines and the count outside', () => {
    for (const zen of [false, true]) {
      const page = searchPage(zen);
      const fold = page.find('.query-facets > details.query-facets-fold') as HTMLDetailsElement;
      assert.strictEqual(fold.open, !zen, zen ? 'closed under Zen' : 'open at Full');
      assert.strictEqual(fold.querySelector(':scope > summary')?.textContent, 'Refine');
      assert.ok(page.findAll('.query-facet').every((facet) => fold.contains(facet)), 'the facets are in the fold');
      for (const always of page.findAll('.query-facets-count, .query-facets-lead')) {
        assert.ok(!fold.contains(always), `${always.className} is drawn outside the fold`);
      }
    }
  });

  test("Refine's summary says how many of its values the search holds, past the page's own", () => {
    assert.strictEqual(board(true, {}, '#project/atlas is:open').text('.query-facets-fold > summary'), 'Refine · 1 set', 'the tag is set from Tags');
    const tagged = open(
      renderPage('searchPage', { chrome: chromeOf(true) }),
      createSearchPageSnapshot(index(), preferences(), '#project/atlas', { queryContext }),
    );
    assert.strictEqual(tagged.text('.query-facets-fold > summary'), 'Refine · 1 set', 'a search the page did not open with is set');
  });

  test('Refine stays as the reader left it across a draw', () => {
    const page = searchPage(true);
    const state = createSearchPageSnapshot(index(), preferences(), '#project/atlas', { queryContext, originQuery: '#project/atlas' });
    (page.find('.query-facets-fold') as HTMLDetailsElement).open = true;
    page.send(state);
    assert.strictEqual((page.find('.query-facets-fold') as HTMLDetailsElement).open, true, 'opened, it stays open');
    (page.find('.query-facets-fold') as HTMLDetailsElement).open = false;
    page.send(state);
    assert.strictEqual((page.find('.query-facets-fold') as HTMLDetailsElement).open, false, 'closed, it stays closed');
  });

  test("the Note page quiets Edit and Add field… in its fields region, keeps the fields drawn, and keeps an open list open", () => {
    const page = notePage(true);
    for (const control of page.findAll('.field-edit, .field-add-button')) {
      assert.ok(quietAtRest(control), `${nameOf(control)} is quiet at rest`);
      assert.ok(control.closest('section.note-fields[data-zen-region]'), `${nameOf(control)} shows from the fields region`);
    }
    for (const kept of page.findAll('.field-link, .field-empty > summary, .note-progress .eyebrow-link')) {
      assert.ok(!quietAtRest(kept), `${nameOf(kept)} stays drawn`);
    }
    assert.ok(!quietAtRest(notePage(false).find('.field-add-button')), 'at Full, Add field… is drawn');
    assert.ok(quietAtRest(notePage(false).find('.field-edit')), "at Full, a row's Edit shows on its row, as a row's ⋯ does");
    page.click('.field-edit[data-field-key="lead"]');
    const choices = page.findAll('.field-editor .field-choice');
    assert.ok(choices.length > 0 && choices.every((choice) => !quietAtRest(choice)), 'an open list stays drawn');
    assert.strictEqual(page.find('.field-edit[data-field-key="lead"]').getAttribute('aria-expanded'), 'true', 'and its Edit with it');
  });

  test("the Notes Graph's Focus and Filters start closed under Zen, as Display does, and their summaries say what they are doing", () => {
    const groups = (page: WebviewPage) => page.findAll('details.control-group').map((group) => [group.querySelector(':scope > summary')?.textContent, (group as HTMLDetailsElement).open]);
    assert.deepStrictEqual(groups(graph(false)), [['Focus', true], ['Filters', true], ['Display', false]]);
    const page = graph(true);
    assert.deepStrictEqual(groups(page), [['Focus', false], ['Filters', false], ['Display', false]]);
    page.click('#show-tags');
    page.click('#show-orphans');
    assert.strictEqual(page.text('.control-group[data-group="Filters"] > summary'), 'Filters · 2 set', 'two filters away from how a graph starts');
    assert.strictEqual((page.find('.control-group[data-group="Filters"]') as HTMLDetailsElement).open, false, 'and still as the reader left it');
  });
});

/** One rule of a sheet: its selector, its declarations, and the at-rules it sits in. */
interface SheetRule {
  readonly selector: string;
  readonly body: string;
  readonly within: readonly string[];
}

/** Every style rule of a sheet, comments left out, each with the at-rules around it. */
function rulesOf(css: string): SheetRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: SheetRule[] = [];
  const within: string[] = [];
  let prelude = '';
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === '{') {
      const head = prelude.trim();
      prelude = '';
      if (head.startsWith('@')) {
        within.push(head);
        continue;
      }
      const close = text.indexOf('}', at);
      rules.push({ selector: head, body: text.slice(at + 1, close), within: [...within] });
      at = close;
    } else if (char === '}') {
      within.pop();
      prelude = '';
    } else if (char === ';' && !within.length) {
      prelude = '';
    } else {
      prelude += char;
    }
  }
  return rules;
}

/** A selector that acts only while Zen is on: under one of the body's markers Zen turns on. */
const ZEN_SCOPED = /body\.zen\b|\[data-(?:styling|help|density|cards|tags|controls)=["']?(?:plain|hidden|compact|flat|text|quiet)["']?\]/;

/** A compound selector's subject is a control: a button, input, select, link, summary, or anything with an action. */
function namesControl(selector: string): boolean {
  const subject = selector.trim().split(/\s*[\s>+~]\s*(?![^(]*\))/).pop() ?? '';
  return /^(?:button|input|select|a|summary)(?![\w-])/.test(subject) || subject.includes('[data-action');
}

/** Every rule any page draws with under Zen, in Corpo and in every other theme. */
function everyRule(): SheetRule[] {
  const pageRules = PAGES.flatMap((page) => rulesOf(pageSheets(renderPage(page.id, { chrome: chromeOf(true) }))));
  const themeRules = (Object.keys(deckardThemeCss) as DeckardTheme[]).flatMap((theme) => rulesOf(themeSheet(theme)));
  return [...pageRules, ...themeRules];
}

/** Every page Zen's contract is checked on, by name, drawn with Zen on or off. */
const CONTRACT_PAGES: ReadonlyArray<readonly [string, (zen: boolean) => WebviewPage]> = [
  ['Home', home],
  ['a search page', searchPage],
  ['the Task board', board],
  ['the Task board as a table', (zen) => board(zen, { taskBoardLayout: 'table' })],
  ['the calendar page', calendarPage],
  ['the sidebar Calendar', sidebarCalendar],
  ['Context', context],
  ['the Notes Graph', graph],
  ['the Note page', notePage],
  ["a type's search page", typeSearchPage],
];

/**
 * Everything a reader can act on, as the page draws it, by tag, action,
 * value, type and words: the same with Zen on and off.
 */
function controls(page: WebviewPage): string[] {
  return page.findAll(CONTROLS)
    .map((element) => [
      element.tagName.toLowerCase(),
      element.getAttribute('data-action') ?? '',
      element.getAttribute('data-value') ?? '',
      element.getAttribute('type') ?? '',
      (element.textContent ?? '').trim().slice(0, 40),
    ].join('|'))
    .sort();
}

/** Whether an element, or one around it, is drawn with no box, or not drawn at all, by the page's sheets. */
function undrawn(page: WebviewPage, element: Element): boolean {
  for (let at: Element | null = element; at; at = at.parentElement) {
    const style = page.window.getComputedStyle(at);
    if (style.display === 'none' || (at === element && style.visibility === 'hidden')) {
      return true;
    }
  }
  return false;
}

/** The controls a page draws with no box, or not at all, other than those in a closed disclosure with its summary drawn. */
function undrawnControls(page: WebviewPage): string[] {
  return page.findAll(CONTROLS)
    .filter((element) => !foldedAway(element) || element.closest('[hidden]'))
    .filter((element) => undrawn(page, element))
    .map((element) => `${element.tagName.toLowerCase()} ${nameOf(element)}`)
    .sort();
}

/**
 * Zen's contract (plan 29, R24): it removes nothing, moves nothing, and
 * leaves everything reachable where it stands, by pointer, keyboard and
 * touch. The pages are drawn as the host draws them; the sheets are read
 * as written.
 */
suite("Zen's contract", () => {
  teardown(closePages);

  test('Zen keeps every control on the page', () => {
    for (const [name, draw] of CONTRACT_PAGES) {
      const full = controls(draw(false));
      assert.ok(full.length > 3, `${name} drew something to compare`);
      assert.deepStrictEqual(controls(draw(true)), full, name);
    }
  });

  test('no rule Zen turns on takes a control out of the page or the accessibility tree', () => {
    for (const rule of everyRule().filter((candidate) => ZEN_SCOPED.test(candidate.selector))) {
      if (!/(?:^|;)\s*(?:display:\s*none|visibility:\s*hidden)/.test(rule.body)) {
        continue;
      }
      for (const selector of rule.selector.split(/,(?![^(]*\))/)) {
        assert.ok(!namesControl(selector), `${selector.trim()} hides a control under Zen`);
      }
    }
  });

  test('each rule that quiets a control shows it again on its region, on focus, and on a screen with no pointer', () => {
    const quieting = everyRule().filter((rule) => /\[data-(?:zen-)?reveal\]/.test(rule.selector) && /opacity:\s*0\s*;/.test(rule.body));
    assert.ok(quieting.some((rule) => rule.selector.includes('[data-zen-reveal]')), "Zen's rule is drawn with");
    for (const rule of quieting) {
      const region = rule.selector.includes('[data-zen-reveal]') ? '[data-zen-region]' : '[data-reveal-region]';
      assert.ok(rule.selector.includes(region), `${rule.selector}: names its region`);
      for (const reveal of [':hover', ':focus-within', ':focus-visible', '[data-reveal-keep]', '[aria-expanded="true"]']) {
        assert.ok(rule.selector.includes(reveal), `${rule.selector}: shows on ${reveal}`);
      }
      assert.deepStrictEqual(rule.within, ['@media (hover: hover)'], `${rule.selector}: only where a pointer hovers, so a touch screen draws everything`);
    }
    const zen = quieting.find((rule) => rule.selector.includes('[data-zen-reveal]')) as SheetRule;
    assert.ok(zen.selector.includes('[data-controls=quiet]'), 'only while Zen is on');
    assert.ok(zen.selector.includes(':focus-within:not(:has(.query-input:focus))'), 'typing a search shows nothing');
  });

  test('every quieted control is in its region, never one segment of a group, and a Tab stop but the board card ⋯', () => {
    for (const [name, draw] of CONTRACT_PAGES) {
      for (const zen of [false, true]) {
        const page = draw(zen);
        const at = `${name}${zen ? ' under Zen' : ' at Full'}`;
        for (const target of page.findAll('[data-zen-reveal]')) {
          assert.ok(target.parentElement?.closest('[data-zen-region]'), `${at}: ${nameOf(target)} is in a Zen region`);
          assert.ok(!target.querySelector('[data-zen-region]') && !target.closest('[data-zen-region] [data-zen-region]'), `${at}: Zen regions never nest`);
        }
        for (const target of page.findAll('[data-reveal]')) {
          assert.ok(target.parentElement?.closest('[data-reveal-region]'), `${at}: ${nameOf(target)} is in its row`);
        }
        assert.deepStrictEqual(page.findAll('.segmented [data-reveal], .segmented [data-zen-reveal]').map(nameOf), [], `${at}: no segment is quieted alone`);
        const untabbable = page.findAll('[data-reveal], [data-zen-reveal]')
          .flatMap((target) => [target, ...target.querySelectorAll(CONTROLS)])
          .filter((element) => element.getAttribute('tabindex') === '-1' && !element.classList.contains('board-move'));
        assert.deepStrictEqual(untabbable.map(nameOf), [], `${at}: every quieted control is a Tab stop`);
      }
    }
    const card = board(false).find('.board-card .board-move');
    assert.strictEqual(card.getAttribute('tabindex'), '-1', "the board card's ⋯ is the one exception, at Full too");
    assert.strictEqual(card.getAttribute('aria-haspopup'), 'menu', 'and opens from its card by the menu keys and right-click');
  });

  test('Zen hides no control from the page: what is not drawn under Zen is not drawn at Full either', () => {
    for (const [name, draw] of CONTRACT_PAGES) {
      assert.deepStrictEqual(undrawnControls(draw(true)), undrawnControls(draw(false)), name);
    }
  });
});
