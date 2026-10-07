import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences, TestPreferences } from './preferenceServices';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createTaskBoard } from '../ui/state/taskBoardState';
import { openWebviewPage, WebviewPage } from './webviewPage';
import { renderPage } from './pages';
import { createQueryContext } from '../domain/query/queryContext';

/**
 * What the Task Board page does with a board, driven as VS Code drives it.
 */
suite('Task Board page', () => {
  let page: WebviewPage | undefined;
  let store: TestPreferences | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
    store?.repository.dispose();
    store = undefined;
  });

  const NOW = Date.parse('2026-09-21T12:00:00Z');
  const options = { queryContext: createQueryContext(NOW), format: 'emoji' as const };

  const open = (): { page: WebviewPage; taskId: string } => {
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-09-21\n')]]),
    );
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board' }, search: { query: '' }, options, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), board);
    return { page, taskId: board.columns.flatMap((column) => column.cards)[0].taskId };
  };

  /** The board the host would send for these notes, laid out as `layout` says. */
  const boardOf = (files: Record<string, string>, layout: Record<string, unknown> = {}, query = '') => {
    const index = buildWorkspaceIndex(new Map(Object.entries(files).map(([path, text]) => [path, parseMarkdown(path, text)])));
    const preferences = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    try {
      return createTaskBoard({ index, preferences: { ...preferences.reader.value, taskBoardLayout: 'board', ...layout } as never, search: { query }, options, tagTitleDisplayMode: 'inline' });
    } finally {
      preferences.repository.dispose();
    }
  };

  /** The page, drawing `board`. */
  const show = (board: unknown): WebviewPage => {
    page = openWebviewPage(renderPage('taskBoard'), board);
    return page;
  };

  /** A key pressed on `target`, as a reader presses it; the event, to read what the page did with it. */
  const press = (shown: WebviewPage, target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new shown.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  /** A card on the page, by the words its title starts with. */
  const cardTitled = (shown: WebviewPage, title: string): HTMLElement => {
    const card = shown.findAll('.board-card').find((candidate) => candidate.querySelector('.task-title')?.textContent?.startsWith(title));
    assert.ok(card, `a card titled ${title}`);
    return card as HTMLElement;
  };

  /** Two tasks to do in one note. */
  const TWO = { 'notes/a.md': '- [ ] Alpha\n- [ ] Beta\n' };

  test('a column header counts its cards against its limit, and its overdue ones', () => {
    const lines = Array.from({ length: 5 }, (_, number) => `- [/] Task ${number} 📅 2026-09-0${number + 1}`);
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', `# Atlas\n${lines.join('\n')}\n- [/] Fresh\n`)]]),
    );
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board', taskBoardGroup: 'status' }, search: { query: '' }, options: { ...options, limits: { 'in-progress': 3 } }, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), board);
    const column = page.find('.board-column[data-column-id="status:in-progress"]');
    assert.strictEqual(column.querySelector('.board-count')?.textContent, '6 / 3 · 5 overdue');
    assert.ok(column.classList.contains('over-limit'));
    assert.strictEqual(column.getAttribute('aria-label'), 'In progress [/], 6 tasks, limit 3, 5 overdue');
    const quiet = page.findAll('.board-details .overdue.quiet');
    assert.strictEqual(quiet.length, 3, 'the worst third, two of five, keep the red');
    assert.ok(quiet.every((span) => /^overdue/.test(span.textContent ?? '')), 'still says overdue in words');
  });

  test('a card\'s menu is a button that opens its moves, and a choice moves the card', () => {
    const { page, taskId } = open();
    const button = page.find('.board-card [data-action="board-menu"]');
    assert.strictEqual(button.tagName, 'BUTTON');
    assert.strictEqual(button.getAttribute('aria-haspopup'), 'menu');
    assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(page.findAll('.board-card select').length, 0, 'no bare select on a card');

    page.click('.board-card [data-action="board-menu"]');
    const menu = page.find('#action-menu') as HTMLElement;
    assert.strictEqual(menu.hidden, false);
    assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
    const headings = page.findAll('#action-menu .menu-heading').map((heading) => heading.textContent);
    assert.deepStrictEqual(headings, ['Status', 'More statuses', 'Priority', 'Due', 'For', 'Steps', 'Done', 'Note']);
    const labels = page.findAll('#action-menu [data-menu-value] .menu-label').map((item) => item.textContent);
    for (const label of ['Todo', 'In progress', 'High', 'Due tomorrow', 'No due date', 'Complete it']) {
      assert.ok(labels.includes(label), `offers ${label}`);
    }
    assert.strictEqual(page.document.activeElement, page.find('#action-menu [aria-checked="true"]'), 'focus is on what the task is now');

    page.click('#action-menu [data-menu-value="status:in-progress"]');
    assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, column: 'status:in-progress', from: 'status:todo', requestId: 1 });
    assert.strictEqual(menu.hidden, true, 'the menu closes on a choice');
    assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
  });

  test('priority is a badge with an arrow, told from the date beside it', () => {
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-09-11 🔺 ⏳ 2026-09-22 🔁 every month on the 15th\n')]]),
    );
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    for (const layout of ['board', 'list'] as const) {
      const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: layout }, search: { query: '' }, options, tagTitleDisplayMode: 'inline' });
      page?.dispose();
      page = openWebviewPage(renderPage('taskBoard'), board);
      const badge = page.find('.priority-badge.priority-highest');
      assert.strictEqual(badge.querySelector('.priority-mark')?.textContent, '↑↑', `${layout}: the arrow says how far from the middle`);
      assert.match(badge.textContent ?? '', /Highest/);
      const details = page.text(layout === 'board' ? '.board-details' : '.task-meta') ?? '';
      // Where the task is written folds under a card as under a row: the file
      // and line, then the headings above it.
      assert.deepStrictEqual(
        page.findAll(layout === 'board' ? '.board-card .task-source' : '.task-row .task-source').map((span) => span.textContent),
        ['atlas / line 2', 'Atlas'],
        `${layout}: the two provenance lines`,
      );
      assert.ok(!/atlas\.md/.test(details), `${layout}: the file name is not a detail`);
      assert.ok(!/PRIORITY|SCHEDULED|REPEATS/.test(details), `${layout}: the details read as written`);
      if (layout === 'list') {
        assert.match(details, /Scheduled 2026-09-22/);
        assert.match(details, /Repeats every month on the 15th/);
      }
    }
  });

  test('a card\'s menu checks what the task is now, and shows the key for each choice', () => {
    const { page, taskId } = open();
    page.click('.board-card [data-action="board-menu"]');
    const item = (value: string) => page.find(`#action-menu [data-menu-value="${value}"]`);
    for (const value of ['status:todo', 'priority:', 'due:today']) {
      assert.strictEqual(item(value).getAttribute('role'), 'menuitemradio', `${value} is one of a single choice`);
      assert.strictEqual(item(value).getAttribute('aria-checked'), 'true', `${value} is the task's own`);
      assert.ok(item(value).querySelector('.menu-check svg'), `${value} draws its check`);
    }
    assert.strictEqual(item('status:in-progress').getAttribute('aria-checked'), 'false');
    assert.strictEqual(item('priority:high').querySelector('.menu-key')?.textContent, '2');
    assert.strictEqual(item('priority:high').getAttribute('aria-keyshortcuts'), '2');
    assert.strictEqual(item('done').querySelector('.menu-key')?.textContent, 'x');
    assert.strictEqual(item('done').getAttribute('role'), 'menuitem');
    assert.ok(page.findAll('#action-menu [data-menu-value]').every((row) => row.querySelector('.menu-check')), 'every row keeps a check column');

    // Choosing what the task already is changes nothing, and says so.
    page.click('#action-menu [data-menu-value="due:today"]');
    assert.strictEqual(page.lastPosted('moveTask'), undefined);
    assert.match(page.text('#live-status') ?? '', /Due is already Due today\./);

    // The key a row shows works while the menu is open.
    page.click('.board-card [data-action="board-menu"]');
    page.document.activeElement?.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: '2', bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, column: 'priority:high', from: 'status:todo', requestId: 1 });
  });

  test('List in Tasks view sits in the gear, and says when there is nothing to change', () => {
    const index = buildWorkspaceIndex(new Map([['notes/a.md', parseMarkdown('notes/a.md', '- [ ] One')]]));
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board' }, search: { query: 'is:mine' }, options, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), { ...board, agendaListsThisSearch: false, agendaQueryIsDefault: true });
    assert.strictEqual(page.findAll('.query-bar-row [data-action="use-for-agenda"]').length, 0, 'not in the search bar');
    const toggle = () => page!.find('.view-options [data-action="use-for-agenda"]');
    assert.strictEqual(toggle().textContent, 'List in Tasks view');
    assert.strictEqual(toggle().getAttribute('aria-pressed'), 'false');
    page.click('.view-options [data-action="use-for-agenda"]');
    assert.deepStrictEqual(page.lastPosted('useSearchForAgenda'), { type: 'useSearchForAgenda' });
    page.send({ ...board, agendaListsThisSearch: true, agendaQueryIsDefault: false });
    assert.strictEqual(toggle().getAttribute('aria-pressed'), 'true');
    assert.strictEqual(toggle().getAttribute('aria-disabled'), null, 'pressed again, it lists every open task');
    page.send({ ...board, agendaListsThisSearch: true, agendaQueryIsDefault: true });
    assert.strictEqual(toggle().getAttribute('aria-disabled'), 'true');
    assert.strictEqual(toggle().getAttribute('data-tip-disabled'), 'The Tasks view lists every open task, as this search does.');
  });

  test('a card moved from the keyboard moves at once, and says so if it could not be written', () => {
    const { page, taskId } = open();
    const card = () => page.find(`.board-card[data-task-id="${taskId}"]`);
    const column = (id: string) => page.find(`.board-column[data-column-id="${id}"]`);
    assert.strictEqual(column('status:todo').querySelector('.board-count')?.textContent, '1');
    (card() as HTMLElement).focus();
    card().dispatchEvent(new page.window.KeyboardEvent('keydown', { key: ']', bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, column: 'status:in-progress', from: 'status:todo', requestId: 1 });
    assert.strictEqual(card().closest('.board-column')?.getAttribute('data-column-id'), 'status:in-progress', 'in its new column before the host answers');
    assert.ok(card().classList.contains('is-pending'));
    assert.strictEqual(card().getAttribute('aria-busy'), 'true');
    assert.strictEqual(column('status:todo').querySelector('.board-count')?.textContent, '0');
    assert.strictEqual(column('status:in-progress').querySelector('.board-count')?.textContent, '1');
    assert.match(column('status:in-progress').getAttribute('aria-label') ?? '', /^In progress \[\/\], 1 task/);
    assert.strictEqual(page.document.activeElement, card(), 'focus stays on the card');

    page.window.dispatchEvent(new page.window.MessageEvent('message', { data: { type: 'moveRefused', taskId, requestId: 1 } }));
    assert.match(page.text('#live-status') ?? '', /Send the proposal was not moved\./);
  });

  test('checking a task in the list says which task it completed, and reopened', () => {
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-09-21\n')]]),
    );
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const list = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'list' }, search: { query: '' }, options, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), list);
    const box = page.find('.task-row input[data-action="toggle-task"]') as HTMLInputElement;

    box.checked = true;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.strictEqual(page.text('#live-status'), 'Completed Send the proposal.');
    box.checked = false;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.strictEqual(page.text('#live-status'), 'Reopened Send the proposal.');
  });

  test('checking a task in the table names it by its title column, wherever that column is', () => {
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-09-21\n')]]),
    );
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const table = createTaskBoard({
      index,
      preferences: { ...store.reader.value, taskBoardLayout: 'table', taskTableColumns: ['due', 'title'] },
      search: { query: '' },
      options,
      tagTitleDisplayMode: 'inline',
    });
    page = openWebviewPage(renderPage('taskBoard'), table);
    const box = page.find('.result-row input[data-action="toggle-task"]') as HTMLInputElement;
    assert.strictEqual(box.getAttribute('aria-label'), 'Toggle Send the proposal');
    assert.strictEqual(page.find('.result-row [data-action="task-row-menu"]').getAttribute('aria-label'), 'Change Send the proposal: status, priority, or due date');

    box.checked = true;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.strictEqual(page.text('#live-status'), 'Completed Send the proposal.');
    box.checked = false;
    box.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.strictEqual(page.text('#live-status'), 'Reopened Send the proposal.');
  });

  test('a long column offers the rest of its cards', () => {
    const lines = Array.from({ length: 120 }, (_, number) => `- [/] Task ${number}`);
    const index = buildWorkspaceIndex(new Map([['notes/a.md', parseMarkdown('notes/a.md', lines.join('\n'))]]));
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board', taskBoardGroup: 'status' }, search: { query: '' }, options, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), board);
    const column = page.find('.board-column[data-column-id="status:in-progress"]');
    assert.strictEqual(column.querySelectorAll('.board-card').length, 100);
    assert.strictEqual(column.querySelector('.board-count')?.textContent, '120', 'the count is of the whole column');
    assert.strictEqual(column.getAttribute('data-hidden-count'), '20');
    page.click('.board-column[data-column-id="status:in-progress"] [data-action="show-column-rest"]');
    assert.deepStrictEqual(page.lastPosted('showColumnRest'), { type: 'showColumnRest', columnId: 'status:in-progress' });
  });

  test('the menu closes on Escape and gives focus back to its button', () => {
    const { page } = open();
    page.click('.board-card [data-action="board-menu"]');
    const menu = page.find('#action-menu') as HTMLElement;
    assert.strictEqual(menu.hidden, false);
    page.document.activeElement?.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual(menu.hidden, true);
    assert.strictEqual(page.document.activeElement, page.find('.board-card [data-action="board-menu"]'));
    assert.strictEqual(page.lastPosted('moveTask'), undefined);
  });

  test('a right-click on a card opens the same menu', () => {
    const { page } = open();
    page.find('.board-card .task-title').dispatchEvent(new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.strictEqual((page.find('#action-menu') as HTMLElement).hidden, false);
  });

  test('a card\'s menu closes when Tab or focus leaves it, and keys typed elsewhere stay there', () => {
    const shown = show(boardOf(TWO));
    const menu = () => shown.find('#action-menu') as HTMLElement;
    shown.click('.board-card [data-action="board-menu"]');
    press(shown, shown.document.activeElement as Element, 'Tab');
    assert.strictEqual(menu().hidden, true, 'Tab closes the menu');

    shown.click('.board-card [data-action="board-menu"]');
    assert.strictEqual(menu().hidden, false);
    const box = shown.find('[data-action="query-input"]') as HTMLInputElement;
    box.focus();
    assert.strictEqual(menu().hidden, true, 'focus moving to the search box closes the menu');
    assert.strictEqual(shown.document.activeElement, box, 'and stays where it went');
    press(shown, box, 't');
    assert.strictEqual(shown.lastPosted('moveTask'), undefined, 'a t typed in the search box moves no task');
  });

  test('after the host confirms a key edit, focus and the next key stay on the task that was edited', () => {
    const shown = show(boardOf(TWO));
    cardTitled(shown, 'Beta').focus();
    press(shown, cardTitled(shown, 'Beta'), ']');
    // The edit rewrites the task's line, which gives it a new id.
    const moved = boardOf({ 'notes/a.md': '- [ ] Alpha\n- [/] Beta\n' });
    shown.send(moved);
    assert.strictEqual(shown.document.activeElement, cardTitled(shown, 'Beta'), 'focus is on Beta, not the card at its old place');
    press(shown, shown.document.activeElement as Element, ']');
    const beta = moved.columns.flatMap((column) => column.cards).find((card) => card.title === 'Beta');
    assert.strictEqual(shown.lastPosted('moveTask')?.taskId, beta?.taskId, 'the next ] moves Beta');

    // A priority sorts the column again, and focus follows the task.
    shown.dispose();
    const sorted = show(boardOf({ 'notes/a.md': '- [ ] Alpha\n- [ ] Beta\n' }));
    cardTitled(sorted, 'Beta').focus();
    press(sorted, cardTitled(sorted, 'Beta'), '1');
    sorted.send(boardOf({ 'notes/a.md': '- [ ] Alpha\n- [ ] Beta 🔺\n' }));
    assert.strictEqual(sorted.document.activeElement, cardTitled(sorted, 'Beta'));
  });

  test('a drag cut short by a redraw is let go, and only a card\'s drag is taken by a column', () => {
    const board = boardOf(TWO);
    const shown = show(board);
    /** A drag event at `target`, carrying `transfer` as the browser's data would. */
    const drag = (type: string, target: Element, transfer: { types: string[] }): Event => {
      const event = new shown.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      target.dispatchEvent(event);
      return event;
    };
    const cardDrag = { types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string) { this.types.push(type); } };
    const doing = () => shown.find('.board-column[data-column-id="status:in-progress"]');
    const beta = cardTitled(shown, 'Beta');
    drag('dragstart', beta, cardDrag);
    shown.send(board);
    // The browser ends the drag at the card it began on, which the redraw took away.
    drag('dragend', beta, cardDrag);

    const text = { types: ['text/plain'], dropEffect: '' };
    assert.strictEqual(drag('dragover', doing(), text).defaultPrevented, false, 'a column does not offer to take dragged words');
    drag('drop', doing(), text);
    assert.strictEqual(shown.lastPosted('moveTask'), undefined, 'and dropping them moves no card');

    const alpha = { types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string) { this.types.push(type); } };
    drag('dragstart', cardTitled(shown, 'Alpha'), alpha);
    assert.strictEqual(drag('dragover', doing(), alpha).defaultPrevented, true, 'a column takes a card');
    drag('drop', doing(), alpha);
    assert.strictEqual(shown.lastPosted('moveTask')?.column, 'status:in-progress', 'and the card dropped there moves');
    assert.strictEqual(shown.findAll('.task-board.is-dragging-card, .board-column.drop-target, .board-card.dragging').length, 0, 'nothing is left marked as dragged');
  });

  test('on a board sorted by rank, a card takes its own place in its column, by drag or Alt+arrows', () => {
    const THREE = { 'notes/a.md': '- [ ] One\n- [ ] Two\n- [ ] Three\n' };
    const board = boardOf(THREE);
    const ids = Object.fromEntries(board.columns.flatMap((column) => column.cards).map((card) => [card.title, card.taskId]));
    const shown = show(board);
    const titles = () => shown.findAll('.board-column[data-column-id="status:todo"] .board-card .task-title').map((title) => String(title.textContent));
    const reordered = () => shown.lastPosted('reorderTasks')?.taskIds;

    press(shown, cardTitled(shown, 'One'), 'ArrowDown', { altKey: true });
    assert.deepStrictEqual(reordered(), [ids.Two, ids.One, ids.Three], 'Alt+Down moves it one place down and ranks the column');
    assert.deepStrictEqual(titles(), ['Two', 'One', 'Three'], 'at once');

    /** A drag event at `target` with the pointer at `clientY`. */
    const drag = (type: string, target: Element, transfer: object, clientY = 0): Event => {
      const event = new shown.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      Object.defineProperty(event, 'clientY', { value: clientY });
      target.dispatchEvent(event);
      return event;
    };
    const transfer = { types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string) { this.types.push(type); } };
    const three = cardTitled(shown, 'Three');
    drag('dragstart', three, transfer);
    // jsdom lays nothing out, so every card's middle is at 0: above it is before the first card.
    assert.strictEqual(drag('dragover', cardTitled(shown, 'Two'), transfer, -1).defaultPrevented, true, 'its own column takes it');
    assert.strictEqual(shown.findAll('.rank-drop-line').length, 1, 'a line shows where it will land');
    drag('drop', cardTitled(shown, 'Two'), transfer, -1);
    assert.deepStrictEqual(reordered(), [ids.Three, ids.Two, ids.One]);
    assert.strictEqual(shown.lastPosted('moveTask'), undefined, 'a drop in its own column moves it nowhere else');
    assert.strictEqual(shown.findAll('.rank-drop-line').length, 0, 'and the line goes');

    const sorted = show(boardOf(THREE, { taskSortMode: 'created' }));
    sorted.posted.length = 0;
    press(sorted, cardTitled(sorted, 'One'), 'ArrowDown', { altKey: true });
    assert.strictEqual(sorted.lastPosted('reorderTasks'), undefined, 'under another sort, a card keeps the place the sort gives it');
  });

  test('x pressed twice before the host answers completes the card, then reopens it', async () => {
    const shown = show(boardOf(TWO));
    const beta = cardTitled(shown, 'Beta');
    beta.focus();
    press(shown, beta, 'x');
    assert.ok(beta.classList.contains('completed'), 'the card shows it is done at once');
    assert.strictEqual((beta.querySelector('[data-action="board-toggle-task"]') as HTMLInputElement).checked, true, 'and so does its box');
    press(shown, beta, 'x');
    const toggles = () => shown.posted.filter((message) => message.type === 'toggleTask');
    assert.deepStrictEqual(toggles().map((message) => message.completed), [true], 'the reopening waits for the host to answer the completion');
    assert.ok(!beta.classList.contains('completed'), 'though it shows at once');
    assert.strictEqual(shown.text('#live-status'), 'Reopened Beta.');
    const done = boardOf({ 'notes/a.md': '- [ ] Alpha\n- [x] Beta ✅ 2026-09-21\n' });
    shown.send(done);
    // The completed card lingers a moment before the state is drawn.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const id = done.columns.flatMap((column) => column.cards).find((card) => card.title === 'Beta')?.taskId;
    assert.deepStrictEqual(toggles().map(({ taskId, completed }) => ({ taskId, completed })).slice(1), [{ taskId: id, completed: false }], 'then goes with the id the completion gave it');
  });

  test('a key that asks for what a card already has says so, and sends nothing', () => {
    const shown = show(boardOf({ 'notes/a.md': '- [ ] Gamma 📅 2026-09-21\n- [ ] Delta 🔺\n' }));
    const gamma = cardTitled(shown, 'Gamma');
    gamma.focus();
    press(shown, gamma, 't');
    assert.strictEqual(shown.text('#live-status'), 'Gamma: Due is already Due today.');
    const delta = cardTitled(shown, 'Delta');
    delta.focus();
    press(shown, delta, '1');
    assert.strictEqual(shown.text('#live-status'), 'Delta: Priority is already Highest.');
    assert.strictEqual(shown.lastPosted('moveTask'), undefined, 'neither is sent to be refused');
  });

  test('a card moved at once opens its menu before the host answers, checked where it went', () => {
    const shown = show(boardOf(TWO));
    const beta = cardTitled(shown, 'Beta');
    beta.focus();
    press(shown, beta, ']');
    (beta.querySelector('[data-action="board-menu"]') as HTMLElement).click();
    assert.strictEqual((shown.find('#action-menu') as HTMLElement).hidden, false, 'the menu opens');
    assert.deepStrictEqual(
      shown.findAll('#action-menu [aria-checked="true"]').map((item) => item.getAttribute('data-menu-value')),
      ['status:in-progress', 'priority:', 'due:'],
    );
  });

  test('a completion the host could not write is said, as a move it could not write is', () => {
    const shown = show(boardOf(TWO));
    const beta = cardTitled(shown, 'Beta');
    beta.focus();
    press(shown, beta, 'x');
    shown.window.dispatchEvent(new shown.window.MessageEvent('message', { data: { type: 'toggleRefused', taskId: beta.dataset.taskId, completed: true } }));
    assert.strictEqual(shown.text('#live-status'), 'Beta was not completed.');
  });

  test('words typed in the box narrow every layout by what each entry shows, and the board recounts', () => {
    /** Types `words` into the search box without running them. */
    const type = (shown: WebviewPage, words: string): void => {
      const box = shown.find('[data-action="query-input"]') as HTMLInputElement;
      box.focus();
      box.value = words;
      box.dispatchEvent(new shown.window.Event('input', { bubbles: true }));
    };
    const shownCards = (shown: WebviewPage) => shown.findAll('.board-card').filter((card) => !(card as HTMLElement).hidden);
    const files = { 'notes/a.md': '- [ ] Alpha\n- [ ] Beta\n', 'notes/atlas.md': '- [/] Send the proposal\n' };
    const board = boardOf(files);
    const shown = show(board);
    type(shown, 'beta');
    assert.deepStrictEqual(shownCards(shown).map((card) => card.querySelector('.task-title')?.textContent), ['Beta']);
    assert.strictEqual(shown.find('.board-column[data-column-id="status:todo"] .board-count').textContent, '1', 'the column counts what the words leave');
    assert.match(shown.find('.board-column[data-column-id="status:todo"]').getAttribute('aria-label') ?? '', /^Todo \[ \], 1 task/);
    assert.deepStrictEqual(shownCards(shown).map((card) => card.getAttribute('tabindex')), ['0'], 'a card the words leave is the Tab stop');

    // A card shown by its file's name is still shown once the board is drawn again.
    type(shown, 'atlas');
    shown.send(board);
    assert.deepStrictEqual(shownCards(shown).map((card) => card.querySelector('.task-title')?.textContent), ['Send the proposal']);
    shown.dispose();

    const table = show(boardOf(files, { taskBoardLayout: 'table' }));
    type(table, 'beta');
    assert.strictEqual(table.findAll('.result-row').filter((row) => !(row as HTMLElement).hidden).length, 1, 'the table narrows as the list does');
  });

  test('the board drawn again after a move keeps where each column and the board were scrolled', () => {
    const lines = Array.from({ length: 40 }, (_, number) => `- [/] Task ${number}`);
    const files = { 'notes/a.md': `${lines.join('\n')}\n- [ ] Lone\n` };
    const shown = show(boardOf(files));
    const cards = () => shown.find('.board-column[data-column-id="status:in-progress"] .board-cards');
    cards().scrollTop = 300;
    shown.find('.task-board').scrollLeft = 120;
    const card = cardTitled(shown, 'Task 30');
    card.focus();
    press(shown, card, '2');
    shown.send(boardOf({ 'notes/a.md': files['notes/a.md'].replace('Task 30\n', 'Task 30 ⏫\n') }));
    assert.strictEqual(cards().scrollTop, 300, 'the Doing column is where it was, not back at its top');
    assert.strictEqual(shown.find('.task-board').scrollLeft, 120);
  });

  test('Alt+Enter on a list row opens its menu and leaves its note closed', () => {
    const shown = show(boardOf(TWO, { taskBoardLayout: 'list', taskSortMode: 'created' }));
    const row = shown.find('.task-list .task-row') as HTMLElement;
    row.focus();
    press(shown, row, 'Enter', { altKey: true });
    assert.strictEqual((shown.find('#action-menu') as HTMLElement).hidden, false, 'the menu opens');
    assert.strictEqual(shown.lastPosted('openSource'), undefined, 'and the note does not');
  });

  test('a right-click on a ranked list row opens one menu', () => {
    const shown = show(boardOf(TWO, { taskBoardLayout: 'list', taskSortMode: 'rank' }));
    const title = shown.find('.task-list .task-row .task-title');
    title.dispatchEvent(new shown.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const open = ['rank-context-menu', 'action-menu'].filter((id) => {
      const menu = shown.document.getElementById(id);
      return menu !== null && !menu.hidden;
    });
    assert.strictEqual(open.length, 1, `open: ${open.join(', ')}`);
  });

  test('the arrows, Home, and End walk a ranked list row\'s menu, as they walk every menu', () => {
    const shown = show(boardOf(TWO, { taskBoardLayout: 'list', taskSortMode: 'rank' }));
    const row = shown.find('.task-list .task-row') as HTMLElement;
    row.focus();
    press(shown, row, 'F10', { shiftKey: true });
    const menu = shown.find('#rank-context-menu') as HTMLElement;
    assert.strictEqual(menu.hidden, false, 'the rank menu opens');
    const items = shown.findAll('#rank-context-menu [data-context-action]');
    assert.ok(items.length > 2, `items: ${items.length}`);
    assert.strictEqual(shown.document.activeElement, items[0]);
    assert.strictEqual(press(shown, items[0], 'ArrowDown').defaultPrevented, true, 'the menu takes the key');
    assert.strictEqual(shown.document.activeElement, items[1]);
    press(shown, items[1], 'End');
    assert.strictEqual(shown.document.activeElement, items[items.length - 1]);
    press(shown, items[items.length - 1], 'ArrowDown');
    assert.strictEqual(shown.document.activeElement, items[0], 'down from the last goes round to the first');
    press(shown, items[0], 'ArrowUp');
    assert.strictEqual(shown.document.activeElement, items[items.length - 1], 'and up from the first to the last');
    press(shown, items[items.length - 1], 'Home');
    assert.strictEqual(shown.document.activeElement, items[0]);
    assert.strictEqual(menu.hidden, false, 'and it stays open');
  });

  test('Shift+F10 and the menu key on a table row open its menu, as a right-click does', () => {
    const shown = show(boardOf(TWO, { taskBoardLayout: 'table' }));
    const row = shown.find('.result-row') as HTMLElement;
    row.focus();
    press(shown, row, 'F10', { shiftKey: true });
    assert.strictEqual((shown.find('#action-menu') as HTMLElement).hidden, false, 'Shift+F10 opens it');
    press(shown, shown.document.activeElement as Element, 'Escape');
    press(shown, row, 'ContextMenu');
    assert.strictEqual((shown.find('#action-menu') as HTMLElement).hidden, false, 'so does the menu key');
  });

  test('Ctrl+Enter or Cmd+Enter on a card opens it beside, as a click with either does', () => {
    const shown = show(boardOf(TWO));
    const card = cardTitled(shown, 'Alpha');
    card.focus();
    press(shown, card, 'Enter', { ctrlKey: true });
    assert.strictEqual(shown.lastPosted('openSource')?.beside, true);
    shown.posted.length = 0;
    press(shown, card, 'Enter', { metaKey: true });
    assert.strictEqual(shown.lastPosted('openSource')?.beside, true);
    shown.posted.length = 0;
    press(shown, card, 'Enter');
    assert.deepStrictEqual(shown.lastPosted('openSource'), { type: 'openSource', filePath: 'notes/a.md', line: 1 }, 'Enter alone opens it in place');
  });

  test('a card\'s parent tag narrows the search as Refine does, and Cmd/Ctrl opens its page', () => {
    const index = buildWorkspaceIndex(new Map([['notes/z.md', parseMarkdown('notes/z.md', '# Zeus #project/zeus\n- [ ] Alpha #project/atlas\n')]]));
    const preferences = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...preferences.reader.value, taskBoardLayout: 'board' }, search: { query: '#project/atlas' }, options: { ...options, parentTag: true }, tagTitleDisplayMode: 'inline' });
    store = preferences;
    const shown = show(board);
    const tag = () => shown.find('.board-card .parent-tag');
    const click = (init: MouseEventInit = {}) => {
      shown.posted.length = 0;
      tag().dispatchEvent(new shown.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    };
    assert.strictEqual(tag().getAttribute('data-tag-key'), '#project/zeus');
    click();
    assert.strictEqual(shown.lastPosted('setBoardQuery')?.query, '#project/atlas AND #project/zeus', 'a click adds it with AND');
    click({ altKey: true });
    assert.strictEqual(shown.lastPosted('setBoardQuery')?.query, '#project/atlas AND -#project/zeus', 'Alt leaves it out');
    click({ shiftKey: true });
    assert.strictEqual(shown.lastPosted('setBoardQuery')?.query, '(#project/atlas OR #project/zeus)', 'Shift allows it beside the tag searched');
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      click(modifier);
      assert.deepStrictEqual(shown.lastPosted('openTag'), { type: 'openTag', tagKey: '#project/zeus' }, 'Cmd/Ctrl opens its page');
      assert.strictEqual(shown.lastPosted('setBoardQuery'), undefined, 'and leaves the search as it is');
    }

    // A search leaving the tag out shows no card under it, so there is no third case.
    for (const query of ['#project/atlas AND #project/zeus', '(#project/atlas OR #project/zeus)']) {
      const again = show(createTaskBoard({ index, preferences: { ...preferences.reader.value, taskBoardLayout: 'board' }, search: { query }, options: { ...options, parentTag: true }, tagTitleDisplayMode: 'inline' }));
      for (const init of [{}, { altKey: true }, { shiftKey: true }]) {
        again.posted.length = 0;
        again.find('.board-card .parent-tag').dispatchEvent(new again.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
        assert.strictEqual(again.lastPosted('setBoardQuery'), undefined, `${query}: a tag the search already names is not added again`);
      }
      assert.strictEqual(again.find('#live-status').textContent, '#project/zeus is already in the search.');
    }
  });

  test('the gear lists every status, ticked to show its column, and opens the status list', () => {
    const shown = show(boardOf({ 'notes/a.md': '- [ ] Alpha\n- [s] Later\n- [s] Much later\n' }, { taskBoardHiddenColumns: ['Someday'] }));
    (shown.find('details.view-options') as HTMLDetailsElement).open = true;
    const rows = shown.findAll('.board-status').map((row) => [
      row.querySelector('.board-status-box')?.textContent,
      row.querySelector('.board-status-name')?.textContent,
      (row.querySelector('input[data-action="show-status-column"]') as HTMLInputElement).checked,
      row.querySelector('.board-status-count')?.textContent ?? '',
    ]);
    assert.deepStrictEqual(rows, [
      ['[ ]', 'Todo', true, '1 open'],
      ['[/]', 'In progress', true, ''],
      ['[w]', 'Waiting', true, ''],
      ['[s]', 'Someday', false, '2 open, hidden'],
      ['[=]', 'Blocked', true, ''],
      ['[x]', 'Done', true, ''],
      ['[-]', 'Cancelled', true, ''],
    ]);
    assert.strictEqual((shown.find('.board-status input[data-name="Done"]') as HTMLInputElement).disabled, true, 'Done is always a column');
    assert.strictEqual(shown.findAll('.board-status.is-draggable').length, 5, 'the open statuses are dragged into order');
    assert.deepStrictEqual(shown.findAll('.board-column').map((column) => column.getAttribute('aria-label')), [
      'Todo [ ], 1 task', 'In progress [/], 0 tasks', 'Waiting [w], 0 tasks', 'Blocked [=], 0 tasks', 'Done [x], 0 tasks', 'Cancelled [-], 0 tasks',
    ], 'each column says its character once, in its name; hiding Someday shows Cancelled, which the gear no longer hides');
    assert.strictEqual(shown.find('.board-column[data-column-id="status:todo"] .board-column-symbol').textContent, '[ ]');

    const someday = shown.find('.board-status input[data-name="Someday"]') as HTMLInputElement;
    someday.checked = true;
    someday.dispatchEvent(new shown.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(shown.lastPosted('setBoardColumnShown'), { type: 'setBoardColumnShown', name: 'Someday', shown: true });

    shown.find('.board-status[data-status="Blocked"]').dispatchEvent(new shown.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    shown.click('#rank-context-menu [data-context-action="top"]');
    assert.deepStrictEqual(shown.lastPosted('setBoardColumnOrder'), { type: 'setBoardColumnOrder', names: ['Blocked', 'Todo', 'In progress', 'Waiting', 'Someday'] });

    shown.click('[data-action="new-task-status"]');
    assert.deepStrictEqual(shown.lastPosted('editTaskStatuses'), { type: 'editTaskStatuses', newStatus: true });
    shown.click('[data-action="edit-task-statuses"]');
    assert.deepStrictEqual(shown.lastPosted('editTaskStatuses'), { type: 'editTaskStatuses' });
  });

  test('while status tags are left, a strip says how many and offers to move them', () => {
    const plain = boardOf({ 'notes/a.md': '- [ ] Alpha #status/doing\n' });
    const shown = show(plain);
    assert.strictEqual(shown.findAll('.board-hint').length, 0, 'the host says when there are any');
    shown.send({ ...plain, statusTagsLeft: '1 task still has a #status tag.' });
    assert.strictEqual(shown.text('.board-hint'), '1 task still has a #status tag.Move them');
    shown.click('.board-hint [data-action="move-status-tags"]');
    assert.deepStrictEqual(shown.lastPosted('moveStatusTags'), { type: 'moveStatusTags' });
  });

  test('a card\'s menu offers the columns\' statuses, and every other under More statuses', () => {
    const shown = show(boardOf({ 'notes/a.md': '- [ ] Alpha\n' }, { taskBoardHiddenColumns: ['Someday', 'Cancelled'] }));
    (shown.find('.board-card [data-action="board-menu"]') as HTMLElement).click();
    const group = (label: string) => {
      const heading = shown.findAll('#action-menu .menu-heading').find((each) => each.textContent === label);
      assert.ok(heading, label);
      const items: string[] = [];
      for (let next = heading.nextElementSibling; next && !next.classList.contains('menu-heading'); next = next.nextElementSibling) {
        items.push(String(next.querySelector('.menu-label')?.textContent ?? next.textContent));
      }
      return items;
    };
    assert.deepStrictEqual(group('Status'), ['Todo', 'In progress', 'Waiting', 'Blocked']);
    assert.deepStrictEqual(group('More statuses'), ['Someday', 'Cancelled']);
  });

  test('a list row\'s and a card\'s controls are named by the title as it reads, not its Markdown', () => {
    const files = { 'notes/a.md': '- [ ] Send **the** [proposal](https://x.example/p)\n' };
    const list = show(boardOf(files, { taskBoardLayout: 'list' }));
    assert.strictEqual(list.find('.task-row [data-action="task-row-menu"]').getAttribute('aria-label'), 'Change Send the proposal: status, priority, or due date');
    assert.strictEqual(list.find('.task-row [data-action="toggle-task"]').getAttribute('aria-label'), 'Toggle Send the proposal');
    list.dispose();

    const cards = show(boardOf(files));
    assert.strictEqual(cards.find('.board-card [data-action="board-menu"]').getAttribute('aria-label'), 'Change Send the proposal: status, priority, or due date');
    assert.strictEqual(cards.find('.board-card [data-action="board-toggle-task"]').getAttribute('aria-label'), 'Complete Send the proposal');
    assert.match(cards.find('.board-card').getAttribute('aria-label') ?? '', /^Send the proposal, Todo/);
  });

  test('a card dragged onto the search box puts nothing in it', () => {
    const shown = show(boardOf(TWO));
    const transfer = { types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string) { this.types.push(type); } };
    /** A drag event at `target`, carrying the card's data as the browser would. */
    const drag = (type: string, target: Element): Event => {
      const event = new shown.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      target.dispatchEvent(event);
      return event;
    };
    drag('dragstart', cardTitled(shown, 'Beta'));
    // A field takes a drop's plain text as typing; a card carries none.
    assert.deepStrictEqual(transfer.types, ['application/x-deckard-card'], 'the drag carries no words a field would take');
    const box = shown.find('[data-action="query-input"]');
    assert.strictEqual(drag('drop', box).defaultPrevented, true, 'and the page keeps the drop from the field');
    assert.strictEqual(shown.lastPosted('moveTask'), undefined);
  });

  test('a card\'s second edit before the host answers its first waits, and goes with the task\'s new id', () => {
    const shown = show(boardOf(TWO));
    const moves = () => shown.posted.filter((message) => message.type === 'moveTask');
    cardTitled(shown, 'Beta').focus();
    press(shown, cardTitled(shown, 'Beta'), '2');
    press(shown, cardTitled(shown, 'Beta'), ']');
    assert.strictEqual(moves().length, 1, 'the second is not sent with the id the first is about to change');
    assert.strictEqual(cardTitled(shown, 'Beta').closest('.board-column')?.getAttribute('data-column-id'), 'status:in-progress', 'though it shows at once');

    // The first is written: the task's line, and so its id, changed.
    const written = boardOf({ 'notes/a.md': '- [ ] Alpha\n- [ ] Beta ⏫\n' });
    shown.send(written);
    const beta = written.columns.flatMap((column) => column.cards).find((card) => card.title === 'Beta');
    assert.deepStrictEqual(moves().slice(1).map(({ taskId, column, from }) => ({ taskId, column, from })), [{ taskId: beta?.taskId, column: 'status:in-progress', from: 'status:todo' }]);
    assert.strictEqual(cardTitled(shown, 'Beta').closest('.board-column')?.getAttribute('data-column-id'), 'status:in-progress');
    assert.strictEqual(shown.document.activeElement, cardTitled(shown, 'Beta'), 'focus stays with it');

    // A refused edit leaves the task's id as it was. An edit held behind it
    // that asks for where the task already is sends nothing, and the next
    // goes at once, with the id the task still has.
    press(shown, cardTitled(shown, 'Beta'), '[');
    assert.strictEqual(moves().length, 2, 'held behind the move to In progress');
    shown.window.dispatchEvent(new shown.window.MessageEvent('message', { data: { type: 'moveRefused', taskId: beta?.taskId } }));
    shown.send(written);
    assert.strictEqual(moves().length, 2, 'Beta is in Todo already');
    press(shown, cardTitled(shown, 'Beta'), ']');
    assert.deepStrictEqual(moves().slice(2).map(({ taskId, column }) => ({ taskId, column })), [{ taskId: beta?.taskId, column: 'status:in-progress' }]);
  });

  test('a list or table row\'s second edit before the host answers its first waits, and goes with the task\'s new id', () => {
    for (const layout of ['list', 'table']) {
      const shown = show(boardOf(TWO, { taskBoardLayout: layout, taskSortMode: 'created' }));
      const rowTitled = (title: string): HTMLElement => {
        const row = shown.findAll('.task-row, .result-row').find((candidate) => candidate.textContent?.includes(title));
        assert.ok(row, `${layout}: a row titled ${title}`);
        return row as HTMLElement;
      };
      const sent = (type: string) => shown.posted.filter((message) => message.type === type);
      const choose = (value: string): void => {
        (rowTitled('Beta').querySelector('[data-action="task-row-menu"]') as HTMLElement).click();
        shown.click(`#action-menu [data-menu-value="${value}"]`);
      };
      const firstId = rowTitled('Beta').dataset.taskId;

      choose('priority:high');
      choose('status:in-progress');
      const box = rowTitled('Beta').querySelector('input[data-action="toggle-task"]') as HTMLInputElement;
      box.checked = true;
      box.dispatchEvent(new shown.window.Event('change', { bubbles: true }));
      assert.deepStrictEqual(sent('moveTask').map(({ taskId, column }) => ({ taskId, column })), [{ taskId: firstId, column: 'priority:high' }],
        `${layout}: the second is not sent with the id the first is about to change`);
      assert.strictEqual(sent('toggleTask').length, 0, `${layout}: nor is the completion`);
      assert.strictEqual(shown.text('#live-status'), 'Completed Beta.', `${layout}: though it is said at once`);

      // The first is written, and the task's line and id changed. The next
      // edit goes with the new id, one at a time.
      const high = boardOf({ 'notes/a.md': '- [ ] Alpha\n- [ ] Beta ⏫\n' }, { taskBoardLayout: layout, taskSortMode: 'created' });
      shown.send(high);
      const highId = rowTitled('Beta').dataset.taskId;
      assert.notStrictEqual(highId, firstId);
      assert.deepStrictEqual(sent('moveTask').slice(1).map(({ taskId, column }) => ({ taskId, column })), [{ taskId: highId, column: 'status:in-progress' }], layout);
      assert.strictEqual(sent('toggleTask').length, 0, `${layout}: the completion waits on the status`);

      shown.send(boardOf({ 'notes/a.md': '- [ ] Alpha\n- [/] Beta ⏫\n' }, { taskBoardLayout: layout, taskSortMode: 'created' }));
      assert.deepStrictEqual(sent('toggleTask').map(({ taskId, completed }) => ({ taskId, completed })), [{ taskId: highId, completed: true }], layout);
      assert.strictEqual((rowTitled('Beta').querySelector('input[data-action="toggle-task"]') as HTMLInputElement).checked, true, `${layout}: its box shows it`);

      // A refusal leaves the id as it was, so the next edit goes at once.
      shown.window.dispatchEvent(new shown.window.MessageEvent('message', { data: { type: 'toggleRefused', taskId: highId, completed: true } }));
      choose('priority:low');
      assert.deepStrictEqual(sent('moveTask').slice(2).map(({ taskId, column }) => ({ taskId, column })), [{ taskId: highId, column: 'priority:low' }], layout);
      page?.dispose();
      page = undefined;
    }
  });
  /** Types `words` into the search box without running them, as a reader does. */
  const typeWords = (shown: WebviewPage, words: string): void => {
    const box = shown.find('[data-action="query-input"]') as HTMLInputElement;
    box.focus();
    box.value = words;
    box.dispatchEvent(new shown.window.Event('input', { bubbles: true }));
  };

  /** The search bar's own buttons, after the box and its terms, in the order Tab reaches them. */
  const barButtons = (shown: WebviewPage) =>
    shown.findAll('.query-bar-row > button').map((button) => button.getAttribute('data-action'));

  test('a plain board has no Tasks view strip, and keeps its Save and its filled Search', () => {
    const shown = show(boardOf(TWO, {}, 'is:open'));
    assert.deepStrictEqual(shown.findAll('.tasks-view-strip'), []);
    assert.deepStrictEqual(barButtons(shown), ['apply-query', 'clear-query', 'save-board-search', 'export-tasks']);
    assert.strictEqual(shown.text('[data-action="save-board-search"]'), 'Save');
    assert.ok(shown.find('[data-action="apply-query"]').classList.contains('query-apply'), 'Search is the filled button');
    assert.strictEqual(shown.savedState() && (shown.savedState() as Record<string, unknown>).tasksViewMode, undefined);
  });

  test('opened from the Tasks view, it says so above the search box, and saves what the box shows to the view', () => {
    const board = boardOf(TWO, {}, 'is:open');
    const shown = show({ ...board, tasksViewMode: { listed: false } });
    const strip = shown.find('.tasks-view-strip');
    assert.strictEqual(strip.tagName, 'SECTION', 'a region');
    const label = shown.document.getElementById(String(strip.getAttribute('aria-labelledby')));
    assert.strictEqual(label?.textContent, 'Editing what the Tasks view lists', 'named by what it says');
    assert.ok(strip.compareDocumentPosition(shown.find('.query-workspace')) & shown.window.Node.DOCUMENT_POSITION_FOLLOWING, 'above the search box');
    const cancel = strip.querySelector('[data-action="leave-tasks-view-mode"]');
    assert.strictEqual(cancel?.textContent, 'Cancel');
    assert.ok(cancel?.getAttribute('data-tip'), 'its tip says what Cancel keeps');

    assert.deepStrictEqual(barButtons(shown), ['apply-query', 'clear-query', 'save-to-tasks-view', 'save-board-search', 'export-tasks'], 'Save to Tasks view first, then Save as search');
    const save = () => shown.find('[data-action="save-to-tasks-view"]');
    assert.strictEqual(save().textContent, 'Save to Tasks view');
    assert.strictEqual(shown.text('[data-action="save-board-search"]'), 'Save as search');
    assert.ok(save().classList.contains('query-primary'), 'Save to Tasks view is the filled button');
    assert.ok(!shown.find('[data-action="apply-query"]').classList.contains('query-apply'), 'and Search is not, one filled button to a page');
    assert.strictEqual(save().getAttribute('aria-disabled'), null);
    assert.ok(save().getAttribute('data-tip'));
    assert.deepStrictEqual(shown.findAll('.tasks-view-strip [title], .query-bar-row [title]'), [], 'tips, not native titles');

    // Typed and never run, as Save keeps it. A click focuses the button, as
    // in Chrome, and the words typed stay in the box.
    typeWords(shown, '#project/atlas');
    (save() as HTMLElement).focus();
    shown.click('[data-action="save-to-tasks-view"]');
    assert.deepStrictEqual(shown.lastPosted('saveToTasksView'), { type: 'saveToTasksView', query: 'is:open AND #project/atlas' });
    shown.window.dispatchEvent(new shown.window.MessageEvent('message', { data: { type: 'savedToTasksView', query: '#project/atlas' } }));
    assert.strictEqual(shown.text('#live-status'), 'The Tasks view lists "#project/atlas" now.', 'saving is said');
    shown.window.dispatchEvent(new shown.window.MessageEvent('message', { data: { type: 'savedToTasksView', query: '' } }));
    assert.strictEqual(shown.text('#live-status'), 'The Tasks view lists every open task now.');

    // The host runs what it saved, and says the view lists it.
    shown.send({ ...boardOf(TWO, {}, 'is:open AND #project/atlas'), tasksViewMode: { listed: true } });
    assert.ok(shown.find('.tasks-view-strip'), 'still editing the Tasks view, to refine it further');
    assert.strictEqual(save().getAttribute('aria-disabled'), 'true', 'nothing to save until the box changes');
    assert.strictEqual(save().getAttribute('data-tip-disabled'), 'The Tasks view lists this search');
    const posted = shown.posted.length;
    shown.click('[data-action="save-to-tasks-view"]');
    assert.strictEqual(shown.posted.length, posted, 'held, it sends nothing');
    typeWords(shown, 'is:mine');
    assert.strictEqual(save().getAttribute('aria-disabled'), null, 'a change to the box can be saved');
    typeWords(shown, '');
    assert.strictEqual(save().getAttribute('aria-disabled'), 'true', 'and the box as the view lists it cannot');
  });

  test('Cancel asks the host to leave the mode, and the plain board it sends has its Save back, focused', () => {
    const board = boardOf(TWO, {}, 'is:open');
    const shown = show({ ...board, tasksViewMode: { listed: true } });
    assert.deepStrictEqual(shown.savedState(), { query: 'is:open', tasksViewMode: true }, 'kept for a reload while it lives');
    shown.click('[data-action="leave-tasks-view-mode"]');
    assert.deepStrictEqual(shown.lastPosted('leaveTasksViewMode'), { type: 'leaveTasksViewMode' });
    shown.send(board);
    assert.deepStrictEqual(shown.findAll('.tasks-view-strip'), []);
    assert.strictEqual(shown.text('[data-action="save-board-search"]'), 'Save');
    assert.strictEqual(shown.document.activeElement, shown.find('[data-action="save-board-search"]'), 'focus is not lost with Cancel');
    assert.deepStrictEqual(shown.savedState(), { query: 'is:open' });
  });
});
