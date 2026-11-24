import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { PersistedPreferences, Task, WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { describeTopCount, describeTopMenu, speakTopCount, TOP_MOVE } from '../domain/tasks/topStrip';
import { keepUnresolved, planTopChange, planTopTasks, readTodayTop } from '../domain/tasks/topTasks';
import type { TaskBoardSnapshot } from '../ui/protocol/taskBoard';
import { createTaskBoard, type TaskBoardOptions } from '../ui/state/taskBoardState';
import { narrowTaskBoardMessage } from '../ui/webview/pages/taskBoard/messages';
import { createPreferences } from './preferenceServices';
import { renderPage } from './pages';
import { openWebviewPage, type WebviewPage } from './webviewPage';

/**
 * Today's top tasks on the Task board (docs/implementation/50-top-three.md,
 * On the Task board): the strip above the columns, the table's first
 * group, the menu row and key that add a task to the picks or take it out,
 * and what a change of one pick writes.
 */
suite('Top three on the Task board', () => {
  const pages: WebviewPage[] = [];
  teardown(() => pages.splice(0).forEach((page) => page.dispose()));

  /** Noon on Tuesday 2026-11-24. */
  const NOW = new Date(2026, 10, 24, 12).getTime();
  const options: TaskBoardOptions = { queryContext: createQueryContext(NOW), format: 'emoji', topCount: 3 };
  const NOTES: Record<string, string[]> = {
    'projects/Borealis.md': [
      '# Borealis',
      '- [/] Send the vendor quote #team/payments ⏫ ^vendor-quote',
      '- [ ] Call Ren about the depot list #team/rates',
      '- [x] Book the cold room ✅ 2026-11-24 ^cold-room',
      '- [ ] Draft the cutover runbook #team/payments ^cutover-runbook',
      '- [ ] Order the labels',
    ],
    'journal/2026-11-24.md': [
      '# 2026-11-24',
      '',
      '## Top three',
      '',
      '- [[Borealis#^cutover-runbook|Draft the cutover runbook]]',
      '- [[Borealis#^cold-room|Book the cold room]]',
      '- [[Borealis#^vendor-quote|Send the vendor quote]]',
      '- [[Borealis#^gone|A line since deleted]]',
    ],
  };
  const indexOf = (notes: Record<string, string[]> = NOTES): WorkspaceIndex =>
    buildWorkspaceIndex(new Map(Object.entries(notes).map(([path, lines]) => [path, parseMarkdown(path, lines.join('\n'))])));
  const index = indexOf();
  const taskNamed = (words: string, from: WorkspaceIndex = index): Task => {
    const task = [...from.tasks.values()].find((candidate) => candidate.title.startsWith(words));
    assert.ok(task, `a task "${words}"`);
    return task;
  };

  /** The Task Board as the host would build it, with `values` chosen and `query` searched. */
  const boardWith = (values: Partial<PersistedPreferences> = {}, query = '', given: Partial<TaskBoardOptions> = {}): TaskBoardSnapshot => {
    const store = createPreferences({ get: (_key: string, fallback?: unknown) => fallback, keys: () => [], update: async () => undefined } as never);
    try {
      return createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board', ...values }, search: { query }, options: { ...options, ...given } });
    } finally {
      store.repository.dispose();
    }
  };
  const titles = (cards: readonly { title: string }[]): string[] => cards.map((card) => card.title.split(' #')[0]);
  const show = (board: TaskBoardSnapshot): WebviewPage => {
    const page = openWebviewPage(renderPage('taskBoard'), board);
    pages.push(page);
    return page;
  };

  test('the strip holds the picks in pick order, each with the column it left, and the columns do not', () => {
    const board = boardWith();
    assert.deepStrictEqual([board.top?.name, board.top?.done, board.top?.picked], ['Top three', 1, 3]);
    assert.deepStrictEqual(
      board.top?.cards.map((card) => [card.title.split(' #')[0], card.column, card.lane, card.current.includes(TOP_MOVE)]),
      [
        ['Draft the cutover runbook', 'status:todo', undefined, true],
        ['Book the cold room', 'done', undefined, true],
        ['Send the vendor quote', 'status:in-progress', undefined, true],
      ],
    );
    const below = board.columns.flatMap((column) => titles(column.cards));
    assert.deepStrictEqual(below.sort(), ['Call Ren about the depot list', 'Order the labels']);
    assert.ok(board.columns.every((column) => column.cards.every((card) => !card.current.includes(TOP_MOVE))));
    assert.strictEqual(board.taskCount, 5, 'the page counts every task, the strip\'s too');
    assert.deepStrictEqual(board.settings.top, { name: 'Top three', limit: 3 });
  });

  test('a strip card says its status, which a column card leaves to its column, and no card says Top three', () => {
    const board = boardWith();
    const quote = board.top?.cards.find((card) => card.title.startsWith('Send the vendor quote'));
    assert.ok(quote?.details.includes('In progress'), quote?.details.join(' | '));
    const every = [...(board.top?.cards ?? []), ...board.columns.flatMap((column) => column.cards)];
    assert.ok(every.every((card) => !card.details.includes('Top three')));
  });

  test('the board\'s search narrows the strip, whose head then says how many are shown', () => {
    const board = boardWith({}, '#team/payments');
    assert.deepStrictEqual(titles(board.top?.cards ?? []), ['Draft the cutover runbook', 'Send the vendor quote']);
    assert.strictEqual(describeTopCount({ done: board.top?.done ?? 0, picked: board.top?.picked ?? 0, shown: board.top?.cards.length ?? 0 }), '1/3 done · 2 of 3 shown');
    assert.strictEqual(describeTopCount({ done: 1, picked: 3, shown: 3 }), '1/3 done');
    assert.strictEqual(speakTopCount('Top three', { done: 1, picked: 3, shown: 2 }), 'Top three, 1 of 3 done, 2 of 3 shown');
    assert.strictEqual(boardWith({}, 'labels').top, undefined, 'no pick shown, no strip');
  });

  test('a done pick stays in the strip when done tasks are hidden, and nothing is drawn while the feature is off', () => {
    const hidden = boardWith({}, '', { hideDone: true });
    assert.deepStrictEqual(titles(hidden.top?.cards ?? []), ['Draft the cutover runbook', 'Book the cold room', 'Send the vendor quote']);
    assert.ok(hidden.columns.every((column) => column.id !== 'done'));
    const off = boardWith({}, '', { topCount: 0 });
    assert.strictEqual(off.top, undefined);
    assert.strictEqual(off.settings.top, undefined);
    assert.ok(off.columns.flatMap((column) => titles(column.cards)).includes('Draft the cutover runbook'), 'the picks are back in their columns');
  });

  test('with lanes, a pick is in no cell, and its card carries the lane it left', () => {
    const board = boardWith({ taskBoardLanes: 'tag', taskBoardLanesNamespace: 'team' });
    assert.deepStrictEqual(
      board.top?.cards.map((card) => [card.title.split(' #')[0], card.column, card.lane]),
      [
        ['Draft the cutover runbook', 'status:todo', 'tag:team/payments'],
        ['Book the cold room', 'done', 'tag:team/'],
        ['Send the vendor quote', 'status:in-progress', 'tag:team/payments'],
      ],
    );
    const inCells = (board.lanes ?? []).flatMap((lane) => lane.cells.flatMap((cell) => titles(cell.cards)));
    assert.deepStrictEqual(inCells.sort(), ['Call Ren about the depot list', 'Order the labels']);
  });

  test('the table leads with the picks as its first group, in pick order, each once', () => {
    const board = boardWith({ taskBoardLayout: 'table' });
    assert.strictEqual(board.top, undefined, 'the strip is the board layout\'s');
    assert.deepStrictEqual(board.table?.top, { name: 'Top three', done: 1, picked: 3, rows: 3 });
    assert.deepStrictEqual(
      board.table?.rows.map((row) => [row.cells[0].text.split(' #')[0], row.top]),
      [
        ['Draft the cutover runbook', true],
        ['Book the cold room', true],
        ['Send the vendor quote', true],
        ['Call Ren about the depot list', undefined],
        ['Order the labels', undefined],
      ],
    );
    assert.ok(board.table?.rows.every((row) => row.cells.every((cell) => !cell.text.includes('Top three'))), 'no cell says it');
    assert.strictEqual(board.taskMenus?.[taskNamed('Book the cold room').id].current.includes(TOP_MOVE), true);
    assert.strictEqual(board.taskMenus?.[taskNamed('Order the labels').id].current.includes(TOP_MOVE), false);
  });

  test('the menu row adds a task that is no pick and takes a pick out, by the name of the day\'s picks', () => {
    assert.strictEqual(describeTopMenu('Top three', false), "Add to today's top three");
    assert.strictEqual(describeTopMenu('Top three', true), "Remove from today's top three");
    assert.strictEqual(describeTopMenu('Top task', false), "Add to today's top task");
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'setTopTask', taskId: 'a', top: true, extra: 1 }), { type: 'setTopTask', taskId: 'a', top: true });
    assert.strictEqual(narrowTaskBoardMessage({ type: 'setTopTask', taskId: 'a' }), undefined);
    assert.deepStrictEqual(narrowTaskBoardMessage({ type: 'pickTopTasks' }), { type: 'pickTopTasks' });
  });

  test('one more than the limit is refused, and so is taking out a pick that is done', () => {
    const top = readTodayTop(index, NOW);
    assert.deepStrictEqual(planTopChange(top, taskNamed('Order the labels'), true, 3), {
      kind: 'refused',
      reason: 'Three is the limit. Remove one to pick "Order the labels".',
    });
    assert.deepStrictEqual(planTopChange(top, taskNamed('Book the cold room'), false, 3), {
      kind: 'refused',
      reason: '"Book the cold room" is done today, so it stays.',
    });
    assert.deepStrictEqual(planTopChange(top, taskNamed('Draft the cutover runbook'), true, 3), { kind: 'unchanged' }, 'a pick dropped on the strip again');
    assert.deepStrictEqual(planTopChange(top, taskNamed('Order the labels'), false, 3), { kind: 'unchanged' });
    assert.deepStrictEqual(keepUnresolved(top), [{ written: '[[Borealis#^gone|A line since deleted]]' }]);
  });

  test('a task dropped on the strip with room goes last, and one taken out leaves the rest as written', () => {
    const top = readTodayTop(index, NOW);
    const added = planTopChange(top, taskNamed('Order the labels'), true, 4);
    assert.strictEqual(added.kind, 'change');
    const today = NOTES['journal/2026-11-24.md'];
    const plan = planTopTasks({ index, content: today.join('\n'), todayPath: 'journal/2026-11-24.md', style: 'wiki', count: 4, choices: added.kind === 'change' ? added.choices : [] });
    assert.ok(plan.today?.text.endsWith('- [[Borealis#^gone|A line since deleted]]\n- [[Borealis#^order-the-labels|Order the labels]]'), plan.today?.text);
    assert.deepStrictEqual(plan.markers.map(({ marker, line }) => [marker, line]), [['order-the-labels', '- [ ] Order the labels ^order-the-labels']]);

    const removed = planTopChange(top, taskNamed('Send the vendor quote'), false, 3);
    const kept = removed.kind === 'change' ? removed.choices : [];
    assert.deepStrictEqual(kept.flatMap((choice) => ('task' in choice ? [choice.task.title.split(' #')[0]] : [])), ['Draft the cutover runbook', 'Book the cold room']);
    assert.deepStrictEqual(kept.flatMap((choice) => ('written' in choice ? [choice.written] : [])), ['[[Borealis#^gone|A line since deleted]]']);
  });

  test('a task written under the heading is not taken out', () => {
    const notes = { ...NOTES, 'journal/2026-11-24.md': ['# 2026-11-24', '## Top three', '- [ ] Outline the Q1 staffing ask'] };
    const own = indexOf(notes);
    assert.deepStrictEqual(planTopChange(readTodayTop(own, NOW), taskNamed('Outline the Q1', own), false, 3), {
      kind: 'refused',
      reason: '"Outline the Q1 staffing ask" is written under the heading, so it stays. Move or delete its line to drop it.',
    });
  });

  test('the page draws the strip above the columns: its head, Change…, and a numbered card for each pick', () => {
    const page = show(boardWith());
    const strip = page.find('.board-top');
    assert.strictEqual(strip.getAttribute('aria-label'), 'Top three, 1 of 3 done');
    assert.strictEqual(strip.querySelector('.lane-label')?.textContent, 'Top three');
    assert.strictEqual(strip.querySelector('.lane-count')?.textContent, '1/3 done');
    assert.strictEqual(strip.querySelector('[data-action="pick-top-tasks"]')?.textContent, 'Change…');
    assert.deepStrictEqual(
      page.findAll('.board-top .board-card').map((card) => [card.querySelector('.board-top-number')?.textContent, card.getAttribute('data-card-column'), card.getAttribute('data-top-column'), card.classList.contains('completed')]),
      [['1', 'top', 'status:todo', false], ['2', 'top', 'done', true], ['3', 'top', 'status:in-progress', false]],
    );
    assert.strictEqual(strip.compareDocumentPosition(page.find('.board.task-board')) & page.window.Node.DOCUMENT_POSITION_FOLLOWING, page.window.Node.DOCUMENT_POSITION_FOLLOWING, 'above the columns');
    assert.strictEqual(page.findAll('.board.task-board .board-card').length, 2);
    assert.strictEqual(page.findAll('.board-card[tabindex="0"]').length, 1, 'one Tab stop, the strip\'s first card');
    assert.ok(page.find('.board-top .board-card[tabindex="0"]'));
    page.click('.board-top [data-action="pick-top-tasks"]');
    assert.deepStrictEqual(page.lastPosted('pickTopTasks'), { type: 'pickTopTasks' });
  });

  test('p on a column card adds it, and on a strip card takes it out; the strip folds from its head', () => {
    const page = show(boardWith());
    const press = (card: HTMLElement, key: string): void => {
      card.focus();
      card.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    const labels = page.findAll('.board.task-board .board-card').find((card) => card.textContent?.includes('Order the labels')) as HTMLElement;
    press(labels, 'p');
    assert.deepStrictEqual(page.lastPosted('setTopTask'), { type: 'setTopTask', taskId: labels.dataset.taskId, top: true });
    const first = page.find('.board-top .board-card') as HTMLElement;
    press(first, 'p');
    assert.deepStrictEqual(page.lastPosted('setTopTask'), { type: 'setTopTask', taskId: first.dataset.taskId, top: false });

    // → goes along the strip, and ↓ into the board under it.
    press(first, 'ArrowRight');
    assert.strictEqual(page.document.activeElement?.querySelector('.board-top-number')?.textContent, '2');
    press(page.document.activeElement as HTMLElement, 'ArrowDown');
    assert.ok(page.document.activeElement?.closest('.board.task-board'), 'the first card under the strip');

    page.click('.board-top [data-top-fold]');
    assert.strictEqual(page.find('.board-top [data-top-fold]').getAttribute('aria-expanded'), 'false');
    assert.strictEqual((page.find('.board-top .board-top-cards') as HTMLElement).hidden, true);
    assert.ok(page.find('.board.task-board .board-card[tabindex="0"]'), 'the Tab stop leaves the folded strip');
  });

  test('a strip card moved by a key stays in the strip, and its move is written from the column it left', () => {
    const page = show(boardWith());
    const first = page.find('.board-top .board-card') as HTMLElement;
    first.focus();
    first.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    const moved = page.lastPosted('moveTask');
    assert.deepStrictEqual([moved?.type, moved?.column, moved?.from], ['moveTask', 'priority:highest', 'status:todo']);
    assert.ok(first.closest('.board-top'), 'still in the strip');
    assert.ok(first.classList.contains('is-pending'));
  });

  test('a card dropped on the strip is picked; a strip card dropped on a column is moved, not unpicked', () => {
    const page = show(boardWith());
    const drag = (type: string, target: Element, held: object): Event => {
      const event = new page.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: held });
      target.dispatchEvent(event);
      return event;
    };
    const transfer = () => ({ types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string) { this.types.push(type); } });
    const strip = page.find('.board-top');
    const labels = page.findAll('.board.task-board .board-card').find((card) => card.textContent?.includes('Order the labels')) as HTMLElement;
    let held = transfer();
    drag('dragstart', labels, held);
    assert.strictEqual(drag('dragover', strip, held).defaultPrevented, true, 'the strip takes it');
    drag('drop', strip, held);
    assert.deepStrictEqual(page.lastPosted('setTopTask'), { type: 'setTopTask', taskId: labels.dataset.taskId, top: true });
    assert.strictEqual(page.lastPosted('moveTask'), undefined);

    const first = page.find('.board-top .board-card') as HTMLElement;
    held = transfer();
    drag('dragstart', first, held);
    assert.strictEqual(drag('dragover', strip, held).defaultPrevented, false, 'a strip card has nowhere to go in the strip');
    const doing = page.find('.board-column[data-column-id="status:in-progress"]');
    drag('dragover', doing, held);
    drag('drop', doing, held);
    const moved = page.lastPosted('moveTask');
    assert.deepStrictEqual([moved?.column, moved?.from, moved?.taskId], ['status:in-progress', 'status:todo', first.dataset.taskId]);
    assert.ok(first.closest('.board-top'), 'and it stays a pick, in the strip');
  });

  test('a card\'s menu offers the row, and the table heads its first group with the day\'s count', () => {
    const page = show(boardWith());
    page.click('.board-top .board-card [data-action="board-menu"]');
    assert.ok(page.findAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').some((item) => item.textContent?.includes("Remove from today's top three")));

    const table = show(boardWith({ taskBoardLayout: 'table' }));
    const heads = table.findAll('.result-table .result-group');
    assert.deepStrictEqual(heads.map((head) => head.querySelector('.result-group-name')?.textContent), ['Top three', 'Other tasks']);
    assert.strictEqual(heads[0].querySelector('.result-group-count')?.textContent, '1/3 done');
    assert.deepStrictEqual(table.findAll('.result-table .result-row').map((row) => row.classList.contains('is-top')), [true, true, true, false, false]);
  });
});
