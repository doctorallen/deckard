import * as assert from 'assert';

import type { ContextPages, SidebarNotesPageState } from '../ui/protocol/sidebarNotes';
import { isPageShown, listContextPages, readPagesStyle } from '../ui/state/contextPages';
import { listDeckardPages, type PageFacts } from '../ui/state/deckardPages';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/** A settings section holding `values`, as `deckard` reads. */
function settings(values: Record<string, unknown>) {
  return { get: <T>(key: string): T | undefined => values[key] as T | undefined };
}

/** A Sunday in October with three due today and two overdue. */
const FACTS: PageFacts = {
  dueToday: 3,
  overdue: 2,
  notes: 42,
  files: 30,
  today: new Date(2026, 9, 4),
  todayNoteExists: false,
  findKey: '⌥⇧⌘F',
};

/**
 * Deckard's pages at the top of Context: as rows with their hints or as a
 * row of icons, the pages kept as the reader chose them, the page in front
 * pressed, each opening its page, and one Tab stop the arrow keys move along.
 */
suite('Context: the pages at its top', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const PAGES: ContextPages['pages'] = [
    { id: 'home', label: 'Home', description: '3 tasks due today', detail: 'What is due today' },
    { id: 'board', label: 'Task Board', description: '2 tasks overdue', detail: 'Open tasks as columns' },
    { id: 'find', label: 'Find in Notes', description: '⌥⇧⌘F', detail: 'Jump to a heading' },
  ];

  const open = (pages: ContextPages | undefined, state: Partial<SidebarNotesPageState> = {}): WebviewPage => {
    page = openWebviewPage(renderPage('sidebarNotes'), {
      activeFileName: 'today.md',
      activeTags: [],
      notes: [],
      state: 'ready',
      parkedTags: [],
      ...state,
      ...(pages ? { pages } : {}),
    });
    return page;
  };

  /** Presses a key on `from`, focused first, as a reader would. */
  const press = (from: Element, key: string): void => {
    const button = from as HTMLElement;
    button.focus();
    button.dispatchEvent(new (button.ownerDocument.defaultView as Window & typeof globalThis).KeyboardEvent('keydown', { key, bubbles: true }));
  };

  test('as a list, each page is a row with its name and, at the right, its hint, above everything else', () => {
    const shown = open({ style: 'list', pages: PAGES });
    const rows = shown.findAll('.pages-row');
    assert.deepStrictEqual(rows.map((row) => [row.querySelector('.pages-label')?.textContent, row.querySelector('.pages-description')?.textContent]), [
      ['Home', '3 tasks due today'],
      ['Task Board', '2 tasks overdue'],
      ['Find in Notes', '⌥⇧⌘F'],
    ]);
    assert.strictEqual(rows[0].getAttribute('aria-label'), 'Home, 3 tasks due today');
    assert.strictEqual(rows[0].getAttribute('data-tip'), 'What is due today');
    assert.strictEqual(shown.findAll('.pages-icon').length, 0);
    const toolbar = shown.find('.context-pages');
    assert.strictEqual(toolbar.getAttribute('role'), 'toolbar');
    assert.strictEqual(toolbar.getAttribute('aria-orientation'), 'vertical');
    assert.strictEqual(shown.find('#app').firstElementChild, toolbar, 'the pages lead the view');
  });

  test('as icons, each page is its glyph in one toolbar, named to a screen reader and on hover', () => {
    const shown = open({ style: 'icons', pages: PAGES });
    const icons = shown.findAll('.pages-icon');
    assert.strictEqual(icons.length, 3);
    assert.ok(icons.every((icon) => icon.querySelector('svg.pages-glyph')), 'every page its glyph');
    assert.strictEqual(icons[1].getAttribute('aria-label'), 'Task Board, 2 tasks overdue');
    assert.strictEqual(icons[1].getAttribute('data-tip'), 'Task Board: 2 tasks overdue');
    assert.strictEqual(shown.findAll('.pages-label').length, 0, 'no names drawn');
    assert.strictEqual(shown.find('.context-pages.is-icons').getAttribute('aria-orientation'), 'horizontal');
  });

  test('lead every state Context is in: a page in front, and a note with nothing related', () => {
    for (const state of [
      { state: 'customizeHome' as const, homeWidgets: [{ value: 'tasks', label: 'Tasks' }] },
      { state: 'noMarkdown' as const },
      { state: 'loading' as const },
    ]) {
      const shown = open({ style: 'icons', pages: PAGES }, state);
      assert.strictEqual(shown.find('#app').firstElementChild, shown.find('.context-pages'), state.state);
      shown.dispose();
    }
    page = undefined;
  });

  test('the page in front is pressed, and holds the one Tab stop', () => {
    const shown = open({ style: 'icons', pages: PAGES, current: 'board' });
    const icons = shown.findAll('.pages-icon') as HTMLElement[];
    assert.deepStrictEqual(icons.map((icon) => icon.getAttribute('aria-current')), [null, 'page', null]);
    assert.deepStrictEqual(icons.map((icon) => icon.tabIndex), [-1, 0, -1]);
  });

  test('with no page in front, the first holds the Tab stop', () => {
    const shown = open({ style: 'list', pages: PAGES });
    assert.deepStrictEqual((shown.findAll('.pages-row') as HTMLElement[]).map((row) => row.tabIndex), [0, -1, -1]);
  });

  test('a page opens by its id', () => {
    const shown = open({ style: 'icons', pages: PAGES });
    shown.click('[data-page="board"]');
    assert.deepStrictEqual(shown.lastPosted('goToPage'), { type: 'goToPage', page: 'board' });
  });

  test('in the icons, right and left move between the pages, Home and End go to either end, and the Tab stop follows', () => {
    const shown = open({ style: 'icons', pages: PAGES });
    const icons = shown.findAll('.pages-icon') as HTMLElement[];
    const focused = () => icons.indexOf(shown.document.activeElement as HTMLElement);
    press(icons[0], 'ArrowRight');
    assert.strictEqual(focused(), 1);
    assert.deepStrictEqual(icons.map((icon) => icon.tabIndex), [-1, 0, -1], 'one Tab stop, where the focus is');
    press(icons[1], 'ArrowDown');
    assert.strictEqual(focused(), 1, 'down is not along a row');
    press(icons[1], 'End');
    assert.strictEqual(focused(), 2);
    press(icons[2], 'ArrowRight');
    assert.strictEqual(focused(), 2, 'it stops at the end');
    press(icons[2], 'Home');
    assert.strictEqual(focused(), 0);
    press(icons[0], 'ArrowLeft');
    assert.strictEqual(focused(), 0, 'and at the start');
  });

  test('in the list, down and up move between the pages', () => {
    const shown = open({ style: 'list', pages: PAGES });
    const rows = shown.findAll('.pages-row') as HTMLElement[];
    const focused = () => rows.indexOf(shown.document.activeElement as HTMLElement);
    press(rows[0], 'ArrowDown');
    assert.strictEqual(focused(), 1);
    press(rows[1], 'ArrowRight');
    assert.strictEqual(focused(), 1, 'right is not along a list');
    press(rows[1], 'ArrowUp');
    assert.strictEqual(focused(), 0);
  });

  test('the Tab stop stays where the reader left it when the view is drawn again', () => {
    const shown = open({ style: 'icons', pages: PAGES });
    const icons = shown.findAll('.pages-icon') as HTMLElement[];
    press(icons[0], 'End');
    shown.send({ activeTags: [], notes: [], state: 'noMarkdown', parkedTags: [], pages: { style: 'icons', pages: PAGES } });
    assert.deepStrictEqual((shown.findAll('.pages-icon') as HTMLElement[]).map((icon) => icon.tabIndex), [-1, -1, 0]);
  });

  test('with no page kept, it says where to choose them', () => {
    const shown = open({ style: 'list', pages: [] });
    assert.match(shown.text('.pages-empty') ?? '', /Settings/);
    assert.strictEqual(shown.findAll('.context-pages').length, 0);
  });

  test('a state that carries no pages draws none', () => {
    const shown = open(undefined);
    assert.strictEqual(shown.findAll('.context-pages, .pages-empty').length, 0);
  });

  test('draws only the pages kept, in the page list\'s order', () => {
    const pages = listContextPages(listDeckardPages(FACTS), settings({ 'pages.style': 'icons', 'pages.shown': { graph: false, stats: false, help: false } }), 'calendar');
    const shown = open(pages);
    assert.deepStrictEqual(shown.findAll('.pages-icon').map((icon) => icon.getAttribute('data-page')), ['home', 'board', 'calendar', 'today', 'find']);
    assert.strictEqual(shown.find('[aria-current="page"]').getAttribute('data-page'), 'calendar');
  });

  test('reads its look and the pages kept from the settings, a page kept unless unticked', () => {
    assert.strictEqual(readPagesStyle(settings({})), 'list');
    assert.strictEqual(readPagesStyle(settings({ 'pages.style': 'icons' })), 'icons');
    assert.strictEqual(readPagesStyle(settings({ 'pages.style': 'grid' })), 'list');
    assert.strictEqual(isPageShown(settings({}), 'stats'), true);
    assert.strictEqual(isPageShown(settings({ 'pages.shown': { stats: false } }), 'stats'), false);
    assert.strictEqual(isPageShown(settings({ 'pages.shown': { stats: false } }), 'home'), true);
  });

  test('names the page in front only when it is one of the pages kept', () => {
    const kept = listContextPages(listDeckardPages(FACTS), settings({}), 'board');
    assert.strictEqual(kept.current, 'board');
    assert.deepStrictEqual(kept.pages[0], { id: 'home', label: 'Home', description: '3 tasks due today', detail: 'What is due today, what slipped, and the widgets you arrange' });
    const unticked = listContextPages(listDeckardPages(FACTS), settings({ 'pages.shown': { board: false } }), 'board');
    assert.strictEqual(unticked.current, undefined);
    assert.ok(!unticked.pages.some((one) => one.id === 'board'));
  });
});
