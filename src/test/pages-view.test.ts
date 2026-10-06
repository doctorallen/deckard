import * as assert from 'assert';

import type { PagesViewSnapshot } from '../ui/protocol/pagesView';
import { isPageShown, readPagesStyle } from '../ui/state/pagesViewChoices';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/**
 * The Pages view: Deckard's pages, as rows with their hints or as a row of
 * icons, the pages kept as the reader chose them, each opening its page.
 */
suite('Pages view', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const PAGES: PagesViewSnapshot['pages'] = [
    { id: 'home', label: 'Home', description: '3 tasks due today', detail: 'What is due today' },
    { id: 'board', label: 'Task Board', description: '2 tasks overdue', detail: 'Open tasks as columns' },
    { id: 'find', label: 'Find in Notes', description: '⌥⇧⌘F', detail: 'Jump to a heading' },
  ];

  const open = (snapshot: PagesViewSnapshot): WebviewPage => {
    page = openWebviewPage(renderPage('pagesView'), snapshot);
    return page;
  };

  test('as a list, each page is a row with its name and, at the right, its hint', () => {
    const shown = open({ style: 'list', pages: PAGES });
    const rows = shown.findAll('.pages-row');
    assert.deepStrictEqual(rows.map((row) => [row.querySelector('.pages-label')?.textContent, row.querySelector('.pages-description')?.textContent]), [
      ['Home', '3 tasks due today'],
      ['Task Board', '2 tasks overdue'],
      ['Find in Notes', '⌥⇧⌘F'],
    ]);
    assert.strictEqual(rows[0].getAttribute('aria-label'), 'Home, 3 tasks due today');
    assert.strictEqual(shown.findAll('.pages-icon').length, 0);
  });

  test('as icons, each page is its glyph, named to a screen reader and on hover', () => {
    const shown = open({ style: 'icons', pages: PAGES });
    const icons = shown.findAll('.pages-icon');
    assert.strictEqual(icons.length, 3);
    assert.ok(icons.every((icon) => icon.querySelector('svg.pages-glyph')), 'every page its glyph');
    assert.strictEqual(icons[1].getAttribute('aria-label'), 'Task Board, 2 tasks overdue');
    assert.strictEqual(icons[1].getAttribute('data-tip'), 'Task Board: 2 tasks overdue');
    assert.strictEqual(shown.findAll('.pages-label').length, 0, 'no names drawn');
  });

  test('a page opens by its id', () => {
    const shown = open({ style: 'icons', pages: PAGES });
    shown.click('[data-page="board"]');
    assert.deepStrictEqual(shown.lastPosted('goToPage'), { type: 'goToPage', page: 'board' });
  });

  test('the arrow keys move between the pages, and Home and End go to either end', () => {
    const shown = open({ style: 'list', pages: PAGES });
    const buttons = shown.findAll('[data-action="go-to-page"]') as HTMLElement[];
    const key = (from: HTMLElement, name: string): void => {
      from.focus();
      from.dispatchEvent(new (from.ownerDocument.defaultView as Window & typeof globalThis).KeyboardEvent('keydown', { key: name, bubbles: true }));
    };
    key(buttons[0], 'ArrowDown');
    assert.strictEqual(buttons[0].ownerDocument.activeElement, buttons[1]);
    key(buttons[1], 'End');
    assert.strictEqual(buttons[0].ownerDocument.activeElement, buttons[2]);
    key(buttons[2], 'Home');
    assert.strictEqual(buttons[0].ownerDocument.activeElement, buttons[0]);
  });

  test('with no page kept, it says where to choose them', () => {
    const shown = open({ style: 'list', pages: [] });
    assert.match(shown.text('.pages-empty') ?? '', /Settings/);
  });

  test('reads its look and the pages kept from the settings, a page kept unless unticked', () => {
    const settings = (values: Record<string, unknown>) => ({ get: <T>(key: string): T | undefined => values[key] as T | undefined });
    assert.strictEqual(readPagesStyle(settings({})), 'list');
    assert.strictEqual(readPagesStyle(settings({ 'pages.style': 'icons' })), 'icons');
    assert.strictEqual(readPagesStyle(settings({ 'pages.style': 'grid' })), 'list');
    assert.strictEqual(isPageShown(settings({}), 'stats'), true);
    assert.strictEqual(isPageShown(settings({ 'pages.shown': { stats: false } }), 'stats'), false);
    assert.strictEqual(isPageShown(settings({ 'pages.shown': { stats: false } }), 'home'), true);
  });
});
