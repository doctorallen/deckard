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
