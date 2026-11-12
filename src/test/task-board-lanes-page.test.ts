import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { PersistedPreferences } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import type { TaskBoardSnapshot } from '../ui/protocol/taskBoard';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { renderPage } from './pages';
import { createPreferences } from './preferenceServices';
import { openWebviewPage, type WebviewPage } from './webviewPage';

/**
 * The Task Board page with lanes (plan 46, section 2): the lane grid it
 * draws, and what a card dragged, keyed, or moved from its menu between
 * cells sends.
 */
suite('Task Board page with lanes', () => {
  const pages: WebviewPage[] = [];
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  const NOW = new Date(2026, 8, 21, 12).getTime();
  const options = { queryContext: createQueryContext(NOW), format: 'emoji' as const };
  const NOTES = {
    'notes/ledger.md': [
      '# Ledger migration #initiative/ledger-migration',
      '- [ ] Draft the cutover plan #team/payments ⏫',
      '- [/] Move the rates table #team/rates',
      '- [ ] Review the schema #team/payments #team/rates',
      '- [ ] Write the runbook 📅 2026-09-14',
      '- [x] Freeze the old ledger #team/payments ✅ 2026-09-18',
    ].join('\n'),
  };

  /** The board the host would send for the notes, laid out as `layout` says. */
  const boardOf = (layout: Partial<PersistedPreferences>): TaskBoardSnapshot => {
    const index = buildWorkspaceIndex(new Map(Object.entries(NOTES).map(([path, text]) => [path, parseMarkdown(path, text)])));
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      return createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board', ...layout }, search: { query: '' }, options });
    } finally {
      store.repository.dispose();
    }
  };
  const BY_TEAM: Partial<PersistedPreferences> = { taskBoardGroup: 'status', taskBoardLanes: 'tag', taskBoardLanesNamespace: 'team' };

  /** The page, drawing `board`. */
  const show = (board: TaskBoardSnapshot): WebviewPage => {
    const page = openWebviewPage(renderPage('taskBoard'), board);
    pages.push(page);
    return page;
  };

  /** A card in a cell, by the words its title starts with. */
  const cardIn = (page: WebviewPage, column: string, lane: string, title: string): HTMLElement => {
    const card = page.findAll(`.lane-cell[data-lane-column="${column}"][data-lane-lane="${lane}"] .board-card`)
      .find((candidate) => candidate.querySelector('.task-title')?.textContent?.startsWith(title));
    assert.ok(card, `a card ${title} in ${column}, ${lane}`);
    return card as HTMLElement;
  };

  /** A cell of the grid. */
  const cell = (page: WebviewPage, column: string, lane: string): HTMLElement =>
    page.find(`.lane-cell[data-lane-column="${column}"][data-lane-lane="${lane}"]`) as HTMLElement;

  /** A drag event at `target`, carrying `transfer` as the browser's data would. */
  const drag = (page: WebviewPage, type: string, target: Element, transfer: object): Event => {
    const event = new page.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    target.dispatchEvent(event);
    return event;
  };
  const transfer = () => ({ types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string) { this.types.push(type); } });

  test('Lanes sits beside Group, offering every axis but Group’s', () => {
    const page = show(boardOf({ taskBoardGroup: 'priority' }));
    const options = page.findAll('[data-action="set-board-lanes"] option').map((option) => [option.getAttribute('value'), option.textContent]);
    assert.deepStrictEqual(options, [['none', 'None'], ['status', 'Status'], ['due', 'Due date'], ['assignee', 'Person'], ['pick-namespace', 'Tag…']]);
    assert.strictEqual(page.findAll('.lane-grid').length, 0, 'None draws the board as it was');
    assert.ok(page.find('.board.task-board .board-column'));

    const select = page.find('[data-action="set-board-lanes"]') as HTMLSelectElement;
    select.value = 'status';
    select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('setBoardLanes'), { type: 'setBoardLanes', lanes: 'status' });
  });

  test('the column heads are drawn once, counted over every lane, then a lane per tag, No team last', () => {
    const page = show(boardOf(BY_TEAM));
    const select = page.find('[data-action="set-board-lanes"]') as HTMLSelectElement;
    assert.strictEqual(select.value, 'tag');
    assert.strictEqual(select.selectedOptions[0]?.textContent, '#team');
    assert.strictEqual(page.findAll('.lane-grid.task-board').length, 1);
    assert.strictEqual(page.findAll('.board-column').length, 0);
    assert.deepStrictEqual(page.findAll('.lane').map((lane) => lane.querySelector('.lane-label')?.textContent), ['Payments', 'Rates', 'No team']);
    const todo = page.find('.lane-column-head[data-lane-column="status:todo"]');
    assert.strictEqual(todo.querySelector('.board-count')?.textContent, '3 · 1 overdue', 'Review the schema, in two lanes, counted once');
    assert.strictEqual(page.find('.lane[data-lane-lane="tag:team/payments"] .lane-count').textContent, '3');
    assert.strictEqual(page.findAll('.lane-row').every((row) => row.querySelectorAll('.lane-cell').length === 6), true, 'every lane has every column');
  });

  test('a card dragged to another cell moves at once and sends its column and its lane', () => {
    const page = show(boardOf(BY_TEAM));
    const card = cardIn(page, 'status:todo', 'tag:team/payments', 'Draft the cutover');
    const taskId = card.dataset.taskId;
    const held = transfer();
    drag(page, 'dragstart', card, held);
    const target = cell(page, 'status:in-progress', 'tag:team/rates');
    assert.strictEqual(drag(page, 'dragover', target, held).defaultPrevented, true, 'another cell takes it');
    drag(page, 'drop', target, held);
    assert.deepStrictEqual(page.lastPosted('moveTask'), {
      type: 'moveTask', taskId, column: 'status:in-progress', from: 'status:todo', lane: 'tag:team/rates', fromLane: 'tag:team/payments', requestId: 1,
    });
    assert.ok(cardIn(page, 'status:in-progress', 'tag:team/rates', 'Draft the cutover').classList.contains('is-pending'), 'shown where it went');
    assert.strictEqual(page.find('.lane-column-head[data-lane-column="status:in-progress"] .board-count').textContent, '2', 'the heads count again');
  });

  test('a card dragged within its column changes its lane alone', () => {
    const page = show(boardOf(BY_TEAM));
    const card = cardIn(page, 'status:in-progress', 'tag:team/rates', 'Move the rates');
    const held = transfer();
    drag(page, 'dragstart', card, held);
    drag(page, 'drop', cell(page, 'status:in-progress', 'tag:team/payments'), held);
    const sent = page.lastPosted('moveTask');
    assert.strictEqual(sent?.column, 'status:in-progress');
    assert.strictEqual(sent?.from, 'status:in-progress');
    assert.strictEqual(sent?.lane, 'tag:team/payments');
  });

  test('a cell that will not take a held card fades and says why, and takes no drop', () => {
    const page = show(boardOf(BY_TEAM));
    const held = transfer();
    drag(page, 'dragstart', cardIn(page, 'status:todo', 'tag:team/payments', 'Draft the cutover'), held);
    const done = cell(page, 'done', 'tag:team/rates');
    assert.ok(done.classList.contains('is-refused'));
    assert.strictEqual(done.dataset.refuses, 'Done takes a card only from its own lane.');
    assert.strictEqual(cell(page, 'done', 'tag:team/payments').classList.contains('is-refused'), false, 'its own lane’s Done takes it');
    assert.strictEqual(drag(page, 'dragover', done, held).defaultPrevented, false);
    drag(page, 'drop', done, held);
    assert.strictEqual(page.lastPosted('moveTask'), undefined);
    assert.strictEqual(page.findAll('.lane-cell.is-refused, .lane-grid.is-dragging-card').length, 0, 'let go, nothing is left marked');
  });

  test('a card’s menu moves it to another lane, and its keys along its lane', () => {
    const page = show(boardOf(BY_TEAM));
    const card = cardIn(page, 'status:todo', 'tag:team/payments', 'Draft the cutover');
    const taskId = card.dataset.taskId;
    (card.querySelector('[data-action="board-menu"]') as HTMLElement).dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
    const headings = page.findAll('#action-menu .menu-heading').map((heading) => heading.textContent);
    assert.ok(headings.includes('Move to lane'));
    const lanes = page.findAll('#action-menu .menu-group').find((group) => group.querySelector('.menu-heading')?.textContent === 'Move to lane');
    assert.deepStrictEqual(Array.from(lanes?.querySelectorAll('.menu-label') ?? []).map((label) => label.textContent), ['Rates', 'No team']);
    page.click('#action-menu [data-menu-value="tag:team/rates"]');
    assert.deepStrictEqual(page.lastPosted('moveTask'), {
      type: 'moveTask', taskId, column: 'status:todo', from: 'status:todo', lane: 'tag:team/rates', fromLane: 'tag:team/payments', requestId: 1,
    });

    const other = show(boardOf(BY_TEAM));
    const review = cardIn(other, 'status:todo', 'tag:team/rates', 'Review the schema');
    review.dispatchEvent(new other.window.KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
    const moved = other.lastPosted('moveTask');
    assert.strictEqual(moved?.column, 'status:in-progress', '] moves it to the next column along its lane');
    assert.strictEqual(moved?.lane, undefined, 'its lane is kept');
  });

  test('a lane’s + starts a task with the lane’s value, a column head’s with the column’s', () => {
    const page = show(boardOf(BY_TEAM));
    page.click('.lane[data-lane-lane="tag:team/rates"] .lane-head [data-action="board-add-task"]');
    assert.deepStrictEqual(page.lastPosted('addTaskToColumn'), { type: 'addTaskToColumn', column: 'tag:team/rates' });
    page.click('.lane-column-head[data-lane-column="status:waiting"] [data-action="board-add-task"]');
    assert.deepStrictEqual(page.lastPosted('addTaskToColumn'), { type: 'addTaskToColumn', column: 'status:waiting' });
    assert.strictEqual(page.findAll('.lane-column-head[data-lane-column="done"] [data-action="board-add-task"]').length, 0, 'Done takes none');
  });

  test('by status, Complete it is written, and the host puts the card in the Done lane', () => {
    const page = show(boardOf({ taskBoardGroup: 'priority', taskBoardLanes: 'status' }));
    const card = cardIn(page, 'priority:high', 'status:todo', 'Draft the cutover');
    card.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
    const moved = page.lastPosted('moveTask');
    assert.strictEqual(moved?.column, 'priority:medium', 'a priority key moves it along its lane');
    assert.ok(cardIn(page, 'priority:medium', 'status:todo', 'Draft the cutover'));

    const again = show(boardOf({ taskBoardGroup: 'priority', taskBoardLanes: 'status' }));
    const draft = cardIn(again, 'priority:high', 'status:todo', 'Draft the cutover');
    (draft.querySelector('[data-action="board-menu"]') as HTMLElement).dispatchEvent(new again.window.MouseEvent('click', { bubbles: true }));
    again.click('#action-menu [data-menu-value="status:in-progress"]');
    assert.strictEqual(again.lastPosted('moveTask')?.lane, 'status:in-progress', 'a status is a lane’s move');
    const menu = show(boardOf({ taskBoardGroup: 'priority', taskBoardLanes: 'status' }));
    const write = cardIn(menu, 'priority:', 'status:todo', 'Write the runbook');
    (write.querySelector('[data-action="board-menu"]') as HTMLElement).dispatchEvent(new menu.window.MouseEvent('click', { bubbles: true }));
    menu.click('#action-menu [data-menu-value="done"]');
    assert.deepStrictEqual(
      { column: menu.lastPosted('moveTask')?.column, from: menu.lastPosted('moveTask')?.from, lane: menu.lastPosted('moveTask')?.lane },
      { column: 'done', from: 'priority:', lane: undefined },
    );
    assert.ok(cardIn(menu, 'priority:', 'status:todo', 'Write the runbook').classList.contains('is-pending'), 'marked where it is, not drawn where Done will not hold it');
  });

  test('a folded lane hides its cells, and the arrows step past it into the next lane', () => {
    const page = show(boardOf(BY_TEAM));
    const draft = cardIn(page, 'status:todo', 'tag:team/payments', 'Draft the cutover');
    const press = (target: Element, key: string) => target.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    press(cardIn(page, 'status:todo', 'tag:team/payments', 'Review the schema'), 'ArrowDown');
    assert.strictEqual(page.document.activeElement, cardIn(page, 'status:todo', 'tag:team/rates', 'Review the schema'), '↓ past a cell’s last card goes to the lane below');
    page.click('.lane[data-lane-lane="tag:team/rates"] [data-lane-fold]');
    assert.strictEqual((page.find('.lane[data-lane-lane="tag:team/rates"] .lane-row') as HTMLElement).hidden, true);
    press(cardIn(page, 'status:todo', 'tag:team/payments', 'Review the schema'), 'ArrowDown');
    assert.strictEqual(page.document.activeElement?.closest('.lane')?.getAttribute('data-lane-lane'), 'tag:team/', 'a folded lane is stepped past');
    assert.ok(draft);
  });

  test('the Tag… of Lanes offers the namespaces but Group’s and the lanes’ own', () => {
    const page = show(boardOf({ taskBoardGroup: 'tag', taskBoardGroupNamespace: 'initiative', taskBoardLanes: 'tag', taskBoardLanesNamespace: 'team' }));
    const select = page.find('[data-action="set-board-lanes"]') as HTMLSelectElement;
    assert.strictEqual(select.querySelector('option[value="pick-namespace"]')?.hasAttribute('disabled'), true, 'no other namespace is in use');
    assert.deepStrictEqual(page.findAll('[data-action="set-board-lanes"] option').map((option) => option.getAttribute('value')), ['none', 'status', 'priority', 'due', 'assignee', 'tag', 'pick-namespace']);
  });
});
