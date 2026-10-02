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
});
