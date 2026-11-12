import * as assert from 'assert';

import { createQueryContext } from '../domain/query/queryContext';
import type { TypeTableView } from '../domain/model';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createPreferences } from './preferenceServices';
import { renderPage } from './pages';
import { indexOf, now, typedWorkspace } from './typedWorkspace';
import { openWebviewPage, type WebviewPage } from './webviewPage';

const queryContext = createQueryContext(now);
const pages: WebviewPage[] = [];
const lines = (...text: string[]): string => text.join('\n');

/** The reader's preferences as a fresh store holds them, with `extra` over them. */
function preferences(extra: Record<string, unknown> = {}) {
  const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
  try {
    return { ...store.reader.value, ...extra } as never;
  } finally {
    store.repository.dispose();
  }
}

/** Initiatives, a type of notes a reader writes, with a state, a team, and owners. */
function initiatives() {
  return indexOf({
    'Types/Team.md': lines('---', 'deckard-type: team', 'rows: "#team/*"', '---', '# Team', '', '| Field | Kind |', '| ----- | ---- |', '| lead | Person |'),
    'Types/Initiative.md': lines(
      '---',
      'deckard-type: initiative',
      'rows: notes',
      '---',
      '# Initiative',
      '',
      '| Field  | Kind                                   |',
      '| ------ | -------------------------------------- |',
      '| state  | Select: proposed, active, paused, done |',
      '| team   | Team                                   |',
      '| owners | Person, many                           |',
    ),
    'notes/teams.md': lines('# Teams #team/payments #team/rates'),
    'Initiatives/Card vault.md': lines('---', 'type: initiative', 'state: active', 'team: "#team/payments"', 'owners: ["@dana", "@omar"]', '---', '# Card vault'),
    'Initiatives/Swap pricing.md': lines('---', 'type: initiative', 'state: proposed', 'team: "#team/rates"', '---', '# Swap pricing'),
  });
}

/** A search page for a type's rows, with the type's view chosen. */
function boardPage(query: string, view: TypeTableView, index = initiatives()): WebviewPage {
  const typeKey = /type = (\w+)/.exec(query)?.[1] ?? '';
  const snapshot = createSearchPageSnapshot(index, preferences({ typeTables: { [typeKey]: view } }), query, { queryContext, originQuery: query });
  const page = openWebviewPage(renderPage('searchPage'), { ...snapshot, parkedTags: [] });
  pages.push(page);
  return page;
}

/** Each cell's cards, by title, as `column | lane: titles`. */
function cells(page: WebviewPage): string[] {
  return page.findAll('.lane-cell').map((cell) => {
    const element = cell as HTMLElement;
    const titles = [...cell.querySelectorAll('.type-card-title')].map((title) => title.textContent);
    return `${element.dataset.laneColumn}${element.dataset.laneLane ? ` | ${element.dataset.laneLane}` : ''}: ${titles.join(', ')}`;
  });
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

/** Chooses a value in a select, as a reader would. */
function select(page: WebviewPage, selector: string, value: string): void {
  const element = page.find(selector) as HTMLSelectElement;
  element.value = value;
  element.dispatchEvent(new page.window.Event('change', { bubbles: true }));
}

suite('Boards on a type’s rows, drawn', () => {
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  test('Table | Board sits beside the sort note, and Board shows the rows as cards under Group and Lanes', () => {
    const table = boardPage('type = initiative', {});
    assert.deepStrictEqual(table.findAll('.type-view button').map((button) => [button.textContent, button.getAttribute('aria-pressed')]), [['Table', 'true'], ['Board', 'false']]);
    assert.ok(table.find('.type-view').hasAttribute('data-zen-reveal'), 'Zen hides it with the tab’s tools');
    table.click('.type-view [data-value="board"]');
    assert.deepStrictEqual(table.lastPosted('setTypeView'), { type: 'setTypeView', typeKey: 'initiative', view: 'board' });

    const page = boardPage('type = initiative', { view: 'board' });
    assert.strictEqual(page.findAll('.type-table').length, 0, 'no table');
    assert.deepStrictEqual(page.findAll('.lane-column-head').map((head) => head.textContent), ['proposed1', 'active1', 'paused0', 'done0', 'No state0']);
    assert.deepStrictEqual(cells(page), ['option:proposed: Swap pricing', 'option:active: Card vault', 'option:paused: ', 'option:done: ', 'none: ']);
    assert.deepStrictEqual(
      page.findAll('.type-board-bar select').map((choice) => [...(choice as HTMLSelectElement).options].map((option) => `${option.value}${option.selected ? '*' : ''}`)),
      [['state*', 'team', 'owners'], ['*', 'team', 'owners']],
    );
    assert.ok(page.findAll('.type-board-bar label').every((label) => label.hasAttribute('data-zen-reveal')));
  });

  test('a card is its row’s title, which opens it, and its details as label and value', () => {
    const page = boardPage('type = initiative', { view: 'board', boardGroup: 'state' });
    const card = page.find('.type-card[data-row-id="file:Initiatives/Card vault.md"]');
    assert.ok(card.classList.contains('task') && card.classList.contains('board-card'), 'a Task board card');
    assert.strictEqual(card.getAttribute('draggable'), 'true');
    assert.deepStrictEqual([...card.querySelectorAll('.type-card-detail')].map((detail) => detail.textContent), ['team Payments', 'owners @dana, @omar']);
    page.click('.type-card[data-row-id="file:Initiatives/Card vault.md"] .type-card-title button');
    assert.deepStrictEqual(page.lastPosted('openSource'), { type: 'openSource', filePath: 'Initiatives/Card vault.md', line: 1 });
    assert.ok(card.querySelector('.board-move')?.hasAttribute('data-reveal'), 'its ⋯ waits for the pointer or focus');
  });

  test('lanes stack under the column heads, each named, counted, folded from its name, and with a +', () => {
    const page = boardPage('type = initiative', { view: 'board', boardGroup: 'state', boardLanes: 'team' });
    assert.strictEqual(page.findAll('.lane-heads').length, 1, 'the column heads drawn once');
    assert.deepStrictEqual(page.findAll('.lane-head .lane-fold').map((fold) => fold.textContent), ['Payments1', 'Rates1', 'No team0']);
    assert.deepStrictEqual(cells(page).filter((cell) => !cell.endsWith(': ')), ['option:active | row:#team/payments: Card vault', 'option:proposed | row:#team/rates: Swap pricing']);
    page.click('.lane[data-lane-lane="row:#team/rates"] .lane-fold');
    assert.strictEqual(page.find('.lane[data-lane-lane="row:#team/rates"] .lane-row').hasAttribute('hidden'), true);
    assert.strictEqual(page.find('.lane[data-lane-lane="row:#team/rates"] .lane-fold').getAttribute('aria-expanded'), 'false');
    page.click('.lane[data-lane-lane="row:#team/payments"] .lane-add');
    assert.deepStrictEqual(page.lastPosted('addTypeRow'), { type: 'addTypeRow', typeKey: 'initiative', lane: 'row:#team/payments' });
    page.click('.lane-column-head[data-lane-column="option:paused"] .lane-add');
    assert.deepStrictEqual(page.lastPosted('addTypeRow'), { type: 'addTypeRow', typeKey: 'initiative', column: 'option:paused' });
    assert.strictEqual(page.find('.lane-column-head[data-lane-column="option:paused"] .lane-add').getAttribute('aria-label'), 'Add an initiative to paused');
  });

  test('a card’s ⋯ lists Move to for each other column, then Move to lane, and moves the card at once', () => {
    const page = boardPage('type = initiative', { view: 'board', boardGroup: 'state', boardLanes: 'team' });
    page.click('.type-card[data-row-id="file:Initiatives/Swap pricing.md"] .board-move');
    assert.deepStrictEqual(menuRows(page), [
      'Open', 'Edit fields…', '—',
      'Move to active', 'Move to paused', 'Move to done', 'Move to No state', '—',
      'Move to lane Payments', 'Move to lane No team',
    ]);
    choose(page, 'Move to done');
    assert.deepStrictEqual(page.lastPosted('moveTypeRow'), {
      type: 'moveTypeRow',
      typeKey: 'initiative',
      rowId: 'file:Initiatives/Swap pricing.md',
      from: { column: 'option:proposed', lane: 'row:#team/rates' },
      to: { column: 'option:done', lane: 'row:#team/rates' },
    });
    const moved = page.find('.type-card[data-row-id="file:Initiatives/Swap pricing.md"]');
    assert.strictEqual((moved.closest('.lane-cell') as HTMLElement).dataset.laneColumn, 'option:done');
    assert.ok(moved.classList.contains('is-pending'));
    assert.deepStrictEqual(page.findAll('.lane-column-head .lane-count').map((count) => count.textContent), ['0', '1', '0', '1', '0'], 'the heads counted again');
  });

  test('Group and Lanes choose the fields, and a reverse’s cards move only along the other axis', () => {
    const page = boardPage('type = team', { view: 'board', boardGroup: 'members', boardLanes: 'tier' }, typedWorkspace());
    select(page, '.type-board-bar [data-action="set-type-board-lanes"]', '');
    assert.deepStrictEqual(page.lastPosted('setTypeBoardAxis'), { type: 'setTypeBoardAxis', typeKey: 'team', axis: 'lanes' });
    select(page, '.type-board-bar [data-action="set-type-board-group"]', 'lead');
    assert.deepStrictEqual(page.lastPosted('setTypeBoardAxis'), { type: 'setTypeBoardAxis', typeKey: 'team', axis: 'group', field: 'lead' });
    assert.strictEqual(page.findAll('.lane-column-head .lane-add').length, 0, 'a reverse’s columns take no new row');
    page.click('.type-card[data-row-id="#team/rates"] .board-move');
    assert.ok(!menuRows(page).some((row) => row.startsWith('Move to ') && !row.startsWith('Move to lane')), 'no Move to a member');
    assert.ok(menuRows(page).includes('Move to lane bronze'));
  });

  test('a card dragged over the board: a cell set by other notes fades and says so, one that takes it lights up, and the drop moves it', () => {
    const page = boardPage('type = team', { view: 'board', boardGroup: 'members', boardLanes: 'tier' }, typedWorkspace());
    const types: string[] = [];
    const dataTransfer = { types, effectAllowed: '', dropEffect: '', setData: (type: string) => types.push(type) };
    const drag = (type: string, selector: string) => {
      const event = new page.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      page.find(selector).dispatchEvent(event);
      return event;
    };
    drag('dragstart', '.type-card[data-row-id="#team/rates"]');
    assert.ok(page.find('.type-board-grid').classList.contains('is-dragging-card'));
    const refused = page.findAll('.lane-cell.is-refused').map((cell) => `${(cell as HTMLElement).dataset.laneColumn} | ${(cell as HTMLElement).dataset.laneLane}`);
    assert.deepStrictEqual(refused.filter((cell) => cell.endsWith('option:gold')), ['row:@omar | option:gold'], 'another member, set by other notes');
    assert.strictEqual((page.find('.lane-cell.is-refused') as HTMLElement).dataset.refuses, 'Set by other notes');
    assert.ok(!page.find('.lane-cell[data-lane-column="row:@dana"][data-lane-lane="option:bronze"]').classList.contains('is-refused'), 'its own member, another tier');
    const over = drag('dragover', '.lane-cell[data-lane-column="row:@dana"][data-lane-lane="option:bronze"]');
    assert.ok(over.defaultPrevented, 'it takes the card');
    assert.ok(page.find('.lane-cell[data-lane-column="row:@dana"][data-lane-lane="option:bronze"]').classList.contains('drop-target'));
    assert.strictEqual(drag('dragover', '.lane-cell[data-lane-column="row:@omar"][data-lane-lane="option:gold"]').defaultPrevented, false, 'a refused cell takes none');
    drag('drop', '.lane-cell[data-lane-column="row:@dana"][data-lane-lane="option:bronze"]');
    assert.deepStrictEqual(page.lastPosted('moveTypeRow'), {
      type: 'moveTypeRow',
      typeKey: 'team',
      rowId: '#team/rates',
      from: { column: 'row:@dana', lane: 'option:gold' },
      to: { column: 'row:@dana', lane: 'option:bronze' },
    });
    assert.strictEqual(page.findAll('.lane-cell.is-refused, .lane-cell.drop-target').length, 0, 'the drop lets go');
  });

  test('a type with nothing to group by says what a board needs, with Add a field…', () => {
    const terms = indexOf({
      'Types/Term.md': lines('---', 'deckard-type: term', 'rows: notes', '---', '# Term', '', '| Field | Kind |', '| ----- | ---- |', '| term | Text |'),
      'terms/SLO.md': lines('---', 'type: term', 'term: SLO', '---', '# SLO'),
    });
    const page = boardPage('type = term', { view: 'board' }, terms);
    assert.strictEqual(page.text('.type-board-none'), 'A board groups by a select, person, or relation field, and Term has none. Add a field…');
    page.click('.type-board-none button');
    assert.deepStrictEqual(page.lastPosted('openTypeNote'), { type: 'openTypeNote', typeKey: 'term' });
  });
});
