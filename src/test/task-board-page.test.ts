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
  const options = { queryContext: createQueryContext(NOW), statuses: ['todo', 'doing'], statusNamespace: 'status', format: 'emoji' as const };

  const open = (): { page: WebviewPage; taskId: string } => {
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Send the proposal 📅 2026-09-21\n')]]),
    );
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board' }, search: { query: '' }, options, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), board);
    return { page, taskId: board.columns[0].cards[0].taskId };
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

  /** Two tasks in one note: Alpha has a status, and Beta has none. */
  const TWO = { 'notes/a.md': '- [ ] Alpha #status/todo\n- [ ] Beta\n' };

  test('a column header counts its cards against its limit, and its overdue ones', () => {
    const lines = Array.from({ length: 5 }, (_, number) => `- [ ] Task ${number} #status/doing 📅 2026-09-0${number + 1}`);
    const index = buildWorkspaceIndex(
      new Map([['notes/atlas.md', parseMarkdown('notes/atlas.md', `# Atlas\n${lines.join('\n')}\n- [ ] Fresh #status/doing\n`)]]),
    );
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board', taskBoardGroup: 'status' }, search: { query: '' }, options: { ...options, limits: { doing: 3 } }, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), board);
    const column = page.find('.board-column[data-column-id="status:doing"]');
    assert.strictEqual(column.querySelector('.board-count')?.textContent, '6 / 3 · 5 overdue');
    assert.ok(column.classList.contains('over-limit'));
    assert.strictEqual(column.getAttribute('aria-label'), 'Doing, 6 tasks, limit 3, 5 overdue');
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
    assert.deepStrictEqual(headings, ['Status', 'Priority', 'Due', 'Steps', 'Done', 'Note']);
    const labels = page.findAll('#action-menu [data-menu-value] .menu-label').map((item) => item.textContent);
    for (const label of ['No status', 'Todo', 'Doing', 'High', 'Due tomorrow', 'No due date', 'Complete it']) {
      assert.ok(labels.includes(label), `offers ${label}`);
    }
    assert.strictEqual(page.document.activeElement, page.find('#action-menu [aria-checked="true"]'), 'focus is on what the task is now');

    page.click('#action-menu [data-menu-value="status:doing"]');
    assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, column: 'status:doing', from: 'status:', requestId: 1 });
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
    for (const value of ['status:', 'priority:', 'due:today']) {
      assert.strictEqual(item(value).getAttribute('role'), 'menuitemradio', `${value} is one of a single choice`);
      assert.strictEqual(item(value).getAttribute('aria-checked'), 'true', `${value} is the task's own`);
      assert.ok(item(value).querySelector('.menu-check svg'), `${value} draws its check`);
    }
    assert.strictEqual(item('status:doing').getAttribute('aria-checked'), 'false');
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
    assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, column: 'priority:high', from: 'status:', requestId: 1 });
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
    assert.strictEqual(column('status:').querySelector('.board-count')?.textContent, '1');
    (card() as HTMLElement).focus();
    card().dispatchEvent(new page.window.KeyboardEvent('keydown', { key: ']', bubbles: true }));
    assert.deepStrictEqual(page.lastPosted('moveTask'), { type: 'moveTask', taskId, column: 'status:todo', from: 'status:', requestId: 1 });
    assert.strictEqual(card().closest('.board-column')?.getAttribute('data-column-id'), 'status:todo', 'in its new column before the host answers');
    assert.ok(card().classList.contains('is-pending'));
    assert.strictEqual(card().getAttribute('aria-busy'), 'true');
    assert.strictEqual(column('status:').querySelector('.board-count')?.textContent, '0');
    assert.strictEqual(column('status:todo').querySelector('.board-count')?.textContent, '1');
    assert.match(column('status:todo').getAttribute('aria-label') ?? '', /^Todo, 1 task/);
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
    const lines = Array.from({ length: 120 }, (_, number) => `- [ ] Task ${number} #status/doing`);
    const index = buildWorkspaceIndex(new Map([['notes/a.md', parseMarkdown('notes/a.md', lines.join('\n'))]]));
    store = createPreferences({ get: (_k: string, d?: unknown) => d, keys: () => [], update: async () => undefined } as never);
    const board = createTaskBoard({ index, preferences: { ...store.reader.value, taskBoardLayout: 'board', taskBoardGroup: 'status' }, search: { query: '' }, options, tagTitleDisplayMode: 'inline' });
    page = openWebviewPage(renderPage('taskBoard'), board);
    const column = page.find('.board-column[data-column-id="status:doing"]');
    assert.strictEqual(column.querySelectorAll('.board-card').length, 100);
    assert.strictEqual(column.querySelector('.board-count')?.textContent, '120', 'the count is of the whole column');
    assert.strictEqual(column.getAttribute('data-hidden-count'), '20');
    page.click('.board-column[data-column-id="status:doing"] [data-action="show-column-rest"]');
    assert.deepStrictEqual(page.lastPosted('showColumnRest'), { type: 'showColumnRest', columnId: 'status:doing' });
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
    const moved = boardOf({ 'notes/a.md': '- [ ] Alpha #status/todo\n- [ ] Beta #status/todo\n' });
    shown.send(moved);
    assert.strictEqual(shown.document.activeElement, cardTitled(shown, 'Beta'), 'focus is on Beta, not the card at its old place');
    press(shown, shown.document.activeElement as Element, ']');
    const beta = moved.columns.flatMap((column) => column.cards).find((card) => card.title === 'Beta');
    assert.strictEqual(shown.lastPosted('moveTask')?.taskId, beta?.taskId, 'the next ] moves Beta');

    // A priority sorts the column again, and focus follows the task.
    shown.dispose();
    const sorted = show(boardOf({ 'notes/a.md': '- [ ] Alpha #status/todo\n- [ ] Beta #status/todo\n' }));
    cardTitled(sorted, 'Beta').focus();
    press(sorted, cardTitled(sorted, 'Beta'), '1');
    sorted.send(boardOf({ 'notes/a.md': '- [ ] Alpha #status/todo\n- [ ] Beta #status/todo 🔺\n' }));
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
    const doing = () => shown.find('.board-column[data-column-id="status:doing"]');
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
    assert.strictEqual(shown.lastPosted('moveTask')?.column, 'status:doing', 'and the card dropped there moves');
    assert.strictEqual(shown.findAll('.task-board.is-dragging-card, .board-column.drop-target, .board-card.dragging').length, 0, 'nothing is left marked as dragged');
  });

  test('x pressed twice before the host answers completes the card, then reopens it', () => {
    const shown = show(boardOf(TWO));
    const beta = cardTitled(shown, 'Beta');
    beta.focus();
    press(shown, beta, 'x');
    assert.ok(beta.classList.contains('completed'), 'the card shows it is done at once');
    assert.strictEqual((beta.querySelector('[data-action="board-toggle-task"]') as HTMLInputElement).checked, true, 'and so does its box');
    press(shown, beta, 'x');
    assert.deepStrictEqual(shown.posted.filter((message) => message.type === 'toggleTask').map((message) => message.completed), [true, false]);
    assert.strictEqual(shown.text('#live-status'), 'Reopened Beta.');
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
      ['status:todo', 'priority:', 'due:'],
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
    const files = { 'notes/a.md': '- [ ] Alpha #status/todo\n- [ ] Beta #status/todo\n', 'notes/atlas.md': '- [ ] Send the proposal #status/doing\n' };
    const board = boardOf(files);
    const shown = show(board);
    type(shown, 'beta');
    assert.deepStrictEqual(shownCards(shown).map((card) => card.querySelector('.task-title')?.textContent), ['Beta']);
    assert.strictEqual(shown.find('.board-column[data-column-id="status:todo"] .board-count').textContent, '1', 'the column counts what the words leave');
    assert.match(shown.find('.board-column[data-column-id="status:todo"]').getAttribute('aria-label') ?? '', /^Todo, 1 task/);
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
    const lines = Array.from({ length: 40 }, (_, number) => `- [ ] Task ${number} #status/doing`);
    const files = { 'notes/a.md': `${lines.join('\n')}\n- [ ] Lone #status/todo\n` };
    const shown = show(boardOf(files));
    const cards = () => shown.find('.board-column[data-column-id="status:doing"] .board-cards');
    cards().scrollTop = 300;
    shown.find('.task-board').scrollLeft = 120;
    const card = cardTitled(shown, 'Task 30');
    card.focus();
    press(shown, card, '2');
    shown.send(boardOf({ 'notes/a.md': files['notes/a.md'].replace('Task 30 #status/doing', 'Task 30 #status/doing ⏫') }));
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
});
