import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { formatIsoDate } from '../domain/markdown/calendar';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import type { SearchPageSnapshot } from '../ui/protocol/searchPage';
import type { DisplayChoices } from '../ui/state/displayLevel';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, type WebviewPage } from './webviewPage';
import { renderPage } from './pages';

/**
 * Card details: which details a search card shows under its title, as
 * `deckard.display.cardDetails` ticks them and the page's body says, its
 * file and line and its note's created and updated dates.
 */
suite('Card details', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const CREATED = new Date(2026, 8, 12, 9).getTime();
  const UPDATED = new Date(2026, 9, 3, 16).getTime();

  /** A search card for one note, created and updated on known days. */
  const snapshotOf = (): SearchPageSnapshot => {
    const index = buildWorkspaceIndex(new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\nThe plan.')]]));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, store.reader.value, '#project/atlas', { queryContext: createQueryContext(Date.now()) });
    return { ...snapshot, sections: snapshot.sections.map((card) => ({ ...card, createdAt: CREATED, updatedAt: UPDATED })) };
  };

  const open = (display: DisplayChoices): WebviewPage => {
    page = openWebviewPage(renderPage('searchPage', { chrome: { theme: 'cooper', zen: false, display } }), snapshotOf());
    return page;
  };

  test('shows the file and line alone by default', () => {
    assert.strictEqual(open({}).text('.card .source'), 'atlas / line 1');
  });

  test('adds the created and updated dates when they are ticked, in that order', () => {
    const shown = open({ details: 'fileAndLine created updated' }).text('.card .source');
    assert.strictEqual(shown, `atlas / line 1 · Created ${formatIsoDate(CREATED)} · Updated ${formatIsoDate(UPDATED)}`);
  });

  test('shows the created date alone, without the file and line or the headings above, when only it is ticked', () => {
    const shown = open({ details: 'created' });
    assert.strictEqual(shown.text('.card .source'), `Created ${formatIsoDate(CREATED)}`);
    assert.strictEqual(shown.findAll('.card .heading-path').length, 0);
  });
});

suite('Card details on tasks', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  test('a task created on its own ➕ date shows that date, and its file and line, as ticked', () => {
    const index = buildWorkspaceIndex(new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Chase the vendor ➕ 2026-09-12')]]));
    const task = [...index.tasks.values()][0];
    assert.strictEqual(formatIsoDate(task.createdAt ?? 0), '2026-09-12', 'its own ➕ date');
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, store.reader.value, '#project/atlas', { queryContext: createQueryContext(Date.now()) });
    page = openWebviewPage(renderPage('searchPage', { chrome: { theme: 'cooper', zen: false, display: { details: 'fileAndLine created' } } }), snapshot);
    assert.strictEqual(page.text('.task-row .task-source'), 'atlas / line 2 · Created 2026-09-12');
  });

  test('a task with no detail ticked that it has draws no details line', () => {
    const index = buildWorkspaceIndex(new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Chase the vendor')]]));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    const snapshot = createSearchPageSnapshot(index, store.reader.value, '#project/atlas', { queryContext: createQueryContext(Date.now()) });
    page = openWebviewPage(renderPage('searchPage', { chrome: { theme: 'cooper', zen: false, display: { details: 'created' } } }), snapshot);
    assert.strictEqual(page.findAll('.task-row .task-source').length, 0);
  });
});

suite('Card details in Related Notes', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const CREATED = new Date(2026, 8, 12, 9).getTime();

  test('a result shows the details ticked: its file and line and its created date', () => {
    const snapshot = {
      activeFileName: 'today.md',
      activeTags: [],
      tagTitleDisplayMode: 'inline',
      state: 'ready',
      notes: [{
        sectionId: 'section-1',
        filePath: 'notes/atlas.md',
        title: 'Check-in',
        fileName: 'atlas.md',
        sourceLine: 12,
        headingPath: ['Atlas', 'Check-in'],
        titleTags: [],
        matchedTags: [],
        matchCount: 1,
        totalTagCount: 1,
        overlap: 1,
        relevanceScore: 84,
        createdAt: CREATED,
      }],
    };
    page = openWebviewPage(renderPage('sidebarNotes', { chrome: { theme: 'cooper', zen: false, display: { details: 'fileAndLine created' } } }), snapshot);
    assert.strictEqual(page.text('.note .source'), `atlas / line 12 · Created ${formatIsoDate(CREATED)}`);
    page.dispose();
    page = openWebviewPage(renderPage('sidebarNotes', { chrome: { theme: 'cooper', zen: false, display: { details: 'created' } } }), snapshot);
    assert.strictEqual(page.text('.note .source'), `Created ${formatIsoDate(CREATED)}`, 'without its file and line, or the headings above it');
    assert.strictEqual(page.findAll('.note .heading-path').length, 0);
  });
});
