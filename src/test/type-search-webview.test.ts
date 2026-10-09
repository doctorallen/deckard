import * as assert from 'assert';

import { createQueryContext } from '../domain/query/queryContext';
import type { TypeTableView } from '../domain/model';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createPreferences } from './preferenceServices';
import { renderPage } from './pages';
import { now, typedWorkspace } from './typedWorkspace';
import { openWebviewPage, type WebviewPage } from './webviewPage';

const queryContext = createQueryContext(now);
const pages: WebviewPage[] = [];

/** The reader's preferences as a fresh store holds them, with `extra` over them. */
function preferences(extra: Record<string, unknown> = {}) {
  const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
  try {
    return { ...store.reader.value, ...extra } as never;
  } finally {
    store.repository.dispose();
  }
}

/** A search page for a type's rows, with the type's view chosen. */
function typePage(query = 'type = team', view?: TypeTableView, extra: Record<string, unknown> = {}): WebviewPage {
  const typeKey = /type = (\w+)/.exec(query)?.[1] ?? '';
  const snapshot = createSearchPageSnapshot(typedWorkspace(), preferences({ ...(view ? { typeTables: { [typeKey]: view } } : {}), ...extra }), query, { queryContext, originQuery: query });
  const page = openWebviewPage(renderPage('searchPage'), { ...snapshot, parkedTags: [] });
  pages.push(page);
  return page;
}

/** Opens the menu a right-click opens on an element. */
function rightClick(page: WebviewPage, selector: string): void {
  page.find(selector).dispatchEvent(new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
}

/** The open context menu's rows, separators as `—`. */
function menuRows(page: WebviewPage): string[] {
  return page.findAll('#tag-context-menu > *').map((row) => (row.classList.contains('menu-separator') ? '—' : (row.textContent ?? '').trim()));
}

/** Chooses a row of the open context menu by its words. */
function choose(page: WebviewPage, label: string): void {
  const row = page.findAll('#tag-context-menu [data-context-action]').find((candidate) => candidate.textContent?.trim() === label);
  assert.ok(row, `the menu has ${label}`);
  (row as HTMLElement).click();
}

suite('Types as searches, drawn', () => {
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  test('titles the page with the type’s plural name, its rows in mono under it, and opens on the rows tab', () => {
    const page = typePage();
    assert.strictEqual(page.text('.page-bar h1'), 'Teams');
    assert.strictEqual(page.text('.type-rule'), '#team/*');
    const tabs = page.findAll('[role="tab"]');
    assert.deepStrictEqual(tabs.map((tab) => tab.getAttribute('data-tab')), ['rows', 'notes', 'tasks']);
    assert.strictEqual(tabs[0].textContent, 'Teams (2)');
    assert.strictEqual(tabs[0].getAttribute('aria-selected'), 'true', 'the rows tab, first, is chosen');
    assert.strictEqual(page.find('#result-panel-rows').hasAttribute('hidden'), false);
  });

  test('draws each row: its title and fields as links, keys in monospace, computed columns muted and saying so', () => {
    const page = typePage();
    const heads = page.findAll('.type-table thead th[data-column]');
    assert.deepStrictEqual(heads.map((head) => head.textContent), ['Team', 'lead', 'owns', 'tier', 'headcount', 'on-call', 'status', 'Open tasks', 'Last mentioned']);
    assert.ok(page.find('.type-table th[data-column="lead"]').classList.contains('is-field'));
    assert.strictEqual(page.find('.type-table th[data-column="open-tasks"]').getAttribute('title'), 'Computed: not written in the note');
    const rates = page.find('.type-row[data-row-id="#team/rates"]');
    assert.strictEqual(rates.querySelector('.result-title .field-link')?.getAttribute('data-tag-key'), '#team/rates');
    assert.deepStrictEqual([...rates.querySelectorAll('td')].map((cell) => cell.textContent), [
      'Rates', 'Dana Whitfield', 'Bond Trading, Fx', 'gold', '1,200', 'Priya Natarajan', 'active', '2 · 1 overdue', 'today · 2026-10-08', '',
    ]);
    assert.strictEqual(rates.querySelector('.due-date.overdue')?.textContent, '1 overdue', 'the overdue count in the overdue color');
    page.click('.type-row[data-row-id="#team/rates"] td:nth-child(5)');
    assert.deepStrictEqual(page.lastPosted('openTag'), { type: 'openTag', tagKey: '#team/rates' }, 'a row opens its tag’s page');
  });

  test('a heading sorts, the same one again turns it round, and the note says how with the way back', () => {
    const page = typePage();
    page.click('.type-table th[data-column="lead"] button');
    assert.deepStrictEqual(page.lastPosted('setTypeSort'), { type: 'setTypeSort', typeKey: 'team', column: 'lead', direction: 'asc' });
    const sorted = typePage('type = team', { sort: { column: 'lead', direction: 'asc' } });
    assert.strictEqual(sorted.find('.type-table th[data-column="lead"]').getAttribute('aria-sort'), 'ascending');
    sorted.click('.type-table th[data-column="lead"] button');
    assert.deepStrictEqual(sorted.lastPosted('setTypeSort'), { type: 'setTypeSort', typeKey: 'team', column: 'lead', direction: 'desc' });
    assert.strictEqual(sorted.text('.type-sort-note .control-label'), 'Sorted by lead');
    assert.strictEqual(sorted.find('.type-sort-note [data-action="clear-type-sort"]').getAttribute('data-reveal-keep'), '', 'kept drawn under Zen');
    sorted.click('[data-action="clear-type-sort"]');
    assert.deepStrictEqual(sorted.lastPosted('setTypeSort'), { type: 'setTypeSort', typeKey: 'team' });
  });

  test('a heading’s menu sorts, hides, and renames a field everywhere or opens its row of the type’s note', () => {
    const page = typePage();
    rightClick(page, '.type-table th[data-column="lead"]');
    assert.deepStrictEqual(menuRows(page), ['Sort A-Z', 'Sort Z-A', 'Hide column', '—', 'Rename field everywhere…', 'Edit in Types/Team.md']);
    choose(page, 'Rename field everywhere…');
    assert.deepStrictEqual(page.lastPosted('renameTypeField'), { type: 'renameTypeField', typeKey: 'team', field: 'lead' });
    rightClick(page, '.type-table th[data-column="lead"]');
    choose(page, 'Hide column');
    assert.deepStrictEqual(page.lastPosted('setTypeColumns'), { type: 'setTypeColumns', typeKey: 'team', columns: ['title', 'owns', 'tier', 'headcount', 'on-call', 'status', 'open-tasks', 'last-mentioned'] });
    rightClick(page, '.type-table th[data-column="lead"]');
    choose(page, 'Sort Z-A');
    assert.deepStrictEqual(page.lastPosted('setTypeSort'), { type: 'setTypeSort', typeKey: 'team', column: 'lead', direction: 'desc' });
    rightClick(page, '.type-table th[data-column="open-tasks"]');
    assert.deepStrictEqual(menuRows(page), ['Sort A-Z', 'Sort Z-A', 'Hide column'], 'a computed column has no renames');
  });

  test('Shift+F10 on a heading opens its menu', () => {
    const page = typePage();
    const button = page.find('.type-table th[data-column="tier"] button') as HTMLElement;
    button.focus();
    button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    assert.strictEqual(menuRows(page)[0], 'Sort A-Z');
  });

  test('a select’s value renames its option everywhere', () => {
    const page = typePage();
    rightClick(page, '.type-row[data-row-id="#team/rates"] .type-option');
    assert.deepStrictEqual(menuRows(page), ['Rename option everywhere…']);
    choose(page, 'Rename option everywhere…');
    assert.deepStrictEqual(page.lastPosted('renameTypeOption'), { type: 'renameTypeOption', typeKey: 'team', field: 'tier', option: 'gold' });
  });

  test('a row’s ⋯, revealed on its row, opens, opens its hub, and copies its email', () => {
    const page = typePage('type = person');
    const more = page.find('.type-row[data-row-id="@dana"] [data-action="type-row-menu"]');
    assert.strictEqual(more.getAttribute('data-reveal'), '');
    assert.strictEqual(more.getAttribute('data-zen-reveal'), '');
    page.click('.type-row[data-row-id="@dana"] [data-action="type-row-menu"]');
    assert.deepStrictEqual(menuRows(page), ['Open', 'Open hub note', 'Copy email']);
    choose(page, 'Copy email');
    assert.deepStrictEqual(page.lastPosted('copyRowValue'), { type: 'copyRowValue', typeKey: 'person', rowId: '@dana' });
    page.click('.type-row[data-row-id="@dana"] [data-action="type-row-menu"]');
    choose(page, 'Open hub note');
    assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'People/Dana Whitfield.md', line: 1 });
  });

  test('a row with no hub note says so, and offers one on its row', () => {
    const page = typePage('type = area');
    const row = page.find('.type-row[data-row-id="#area/bond-trading"]');
    assert.strictEqual(row.querySelector('.type-no-hub')?.firstChild?.textContent, 'No hub note · 1 entry');
    const create = row.querySelector('[data-action="create-row-hub"]');
    assert.strictEqual(create?.getAttribute('data-reveal'), '');
    page.click('.type-row[data-row-id="#area/bond-trading"] [data-action="create-row-hub"]');
    assert.deepStrictEqual(page.lastPosted('createRowHub'), { type: 'createRowHub', typeKey: 'area', rowId: '#area/bond-trading' });
  });

  test('⋯ adds a row, opens the type’s note, chooses its columns, and groups by its fields', () => {
    const page = typePage();
    page.click('[data-action="add-type-row"]');
    assert.deepStrictEqual(page.lastPosted('addTypeRow'), { type: 'addTypeRow', typeKey: 'team' });
    assert.strictEqual(page.text('[data-action="open-type-note"]'), 'Open Types/Team.md');
    const members = page.find('[data-action="toggle-type-column"][data-value="members"]') as HTMLInputElement;
    members.checked = true;
    members.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('setTypeColumns'), {
      type: 'setTypeColumns',
      typeKey: 'team',
      columns: ['title', 'lead', 'owns', 'tier', 'headcount', 'on-call', 'status', 'open-tasks', 'last-mentioned', 'members'],
    });
    assert.ok(page.findAll('.view-options-group > span').some((label) => label.textContent === 'Team columns'));
    page.click('[data-action="set-hierarchy"][data-value="field:tier"]');
    assert.deepStrictEqual(page.lastPosted('setTypeGroup'), { type: 'setTypeGroup', typeKey: 'team', field: 'tier' });
  });

  test('grouped, each group is headed by its value and count, the rows with none last', () => {
    const page = typePage('type = team', { groupBy: 'owns' });
    assert.deepStrictEqual(page.findAll('.type-group-row th').map((head) => head.textContent), ['Bond Trading 1', 'Fx 1', 'No owns 1']);
    assert.strictEqual(page.find('[data-action="set-hierarchy"][data-value="field:owns"]').getAttribute('aria-pressed'), 'true');
    page.click('[data-action="set-hierarchy"][data-value="tags"]');
    assert.deepStrictEqual(page.lastPosted('setTypeGroup'), { type: 'setTypeGroup', typeKey: 'team' }, 'another grouping lets go of the field');
    assert.deepStrictEqual(page.lastPosted('setSearchHierarchy'), { type: 'setSearchHierarchy', hierarchy: 'tags' });
  });

  test('side by side, the rows sit over the notes and tasks under their own heading', () => {
    const page = typePage('type = team', undefined, { tagOverviewLayout: 'split' });
    assert.strictEqual(page.text('#rows-heading'), 'Teams (2)');
    assert.ok(page.find('.type-pane .type-table'));
  });
});
