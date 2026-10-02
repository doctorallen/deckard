// End-to-end: the Task Board against the real host and script.
//
// The board searches with the same search box as the Dashboard and a tag
// overview, and its gear switches between columns and a list and edits the
// status columns, so these check each of those through real messages.
const assert = require('assert');
const vscode = require('vscode');
const { createGlobalState, mountWebview } = require('./support.js');
const modules = require('../harness/modules.js');
const { TaskBoardPanel } = modules.taskBoard;
const { createPreferences } = modules.preferenceServices;
const { ActiveSearch } = modules.activeSearch;
const { DashboardPanel } = modules.dashboard;
const { ThemePreview } = modules.themePreview;

function createIndex() {
  const task = (id, title, lineNumber, { tags = [], completed = false } = {}) => ({
    id, filePath: 'notes/tasks.md', title, completed, tags,
    tagLabels: Object.fromEntries(tags.map((tag) => [tag, tag])),
    lineNumber, checkboxColumn: 3, checkboxValue: completed ? 'x' : ' ',
    sourceLineText: `- [${completed ? 'x' : ' '}] ${title} ${tags.join(' ')}`.trim(),
  });
  const tasks = [
    task('audit', 'Send the audit summary', 1, { tags: ['#project/atlas', '#status/doing'] }),
    task('room', 'Book the review room', 2, { tags: ['#project/beta'] }),
    task('call', 'Call Ren', 3, { tags: ['#project/atlas'] }),
    task('ship', 'Ship the release', 4, { completed: true }),
  ];
  const tag = (key, taskIds) => [key, {
    key, label: key, sectionIds: [], taskIds, filePaths: [],
    count: taskIds.length, isFavorite: false,
  }];
  return {
    files: new Map(),
    sections: new Map(),
    tasks: new Map(tasks.map((entry) => [entry.id, entry])),
    tags: new Map([
      tag('#project/atlas', ['audit', 'call']),
      tag('#project/beta', ['room']),
      tag('#status/doing', ['audit']),
    ]),
    entities: new Map(),
    tagAssociations: new Map(),
    updatedAt: Date.now(),
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openBoard(prepare = async () => undefined, makeIndex = createIndex) {
  vscode._test.createdPanels.length = 0;
  vscode._test.settings.clear();
  vscode._test.configurationUpdates.length = 0;
  const updates = new vscode.EventEmitter();
  const index = makeIndex();
  const preferences = createPreferences(createGlobalState());
  await prepare(preferences);
  const activeSearch = new ActiveSearch();
  const board = new TaskBoardPanel({
    indexer: { ready: Promise.resolve(), getSnapshot: () => index, onDidUpdate: updates.event },
    preferences,
    extensionUri: vscode.Uri.file('/ext'),
    openTag: async () => undefined,
    activeSearch,
    writes: modules.taskWrites.createTaskWrites(),
    themePreview: new ThemePreview(),
  });
  await board.show();
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  panel._toWebview.forEach((message) => panel._deliver(message));
  const lastState = () =>
    JSON.parse(JSON.stringify(panel._toWebview[panel._toWebview.length - 1]));
  const cards = () => view.findAll('.board-card').map((card) => card.dataset.taskId).sort();
  const shownCards = () =>
    view.findAll('.board-card').filter((card) => !card.hidden).map((card) => card.dataset.taskId).sort();
  return { view, panel, board, preferences, updates, lastState, cards, shownCards, activeSearch, index };
}

test('Save keeps the search the box shows, before it is run', async () => {
  const { view, preferences } = await openBoard();
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, '#project/atlas');
  vscode._test.setInputBoxResponse('Atlas');
  view.click(view.find('[data-action="save-board-search"]'));
  await delay(10);
  vscode._test.setInputBoxResponse(undefined);
  // The words typed after the board's own is:open, as Enter would run them.
  assert.deepStrictEqual(preferences.reader.value.savedFilters.map((saved) => saved.query), ['is:open AND #project/atlas']);
  view.keydown(bar, 'Enter');
  assert.strictEqual(view.posted.filter((message) => message.type === 'setBoardQuery').at(-1).query, 'is:open AND #project/atlas');
});

/**
 * Restores the board from what VS Code kept for it across a reload, as the
 * serializer does, and says what its search box holds.
 */
async function reopenBoard(state) {
  vscode._test.createdPanels.length = 0;
  vscode._test.settings.clear();
  const index = createIndex();
  const preferences = createPreferences(createGlobalState());
  const board = new TaskBoardPanel({
    indexer: { ready: Promise.resolve(), getSnapshot: () => index, onDidUpdate: new vscode.EventEmitter().event },
    preferences,
    extensionUri: vscode.Uri.file('/ext'),
    openTag: async () => undefined,
    activeSearch: new ActiveSearch(),
    writes: modules.taskWrites.createTaskWrites(),
    themePreview: new ThemePreview(),
  });
  const panel = vscode.window.createWebviewPanel('deckard.taskBoard', 'Saved', -1, {});
  await board.restore(panel, state);
  const view = mountWebview(panel.webview.html, panel);
  panel._toWebview.forEach((message) => panel._deliver(message));
  const shown = view.find('.query-bar-shell').getAttribute('data-query-text');
  board.dispose();
  return shown;
}

// ---------------------------------------------------------------------------

// Persisted formats, row 21: the board reopens on the search it was saved
// with, pinned before Phase 6 rewrites the page.
test('a board saved with a search reopens on it, and on its default without one', async () => {
  assert.strictEqual(await reopenBoard({ query: 'is:open #project/atlas' }), 'is:open #project/atlas');
  for (const state of [{}, undefined, null, { query: 7 }, 'is:open #project/atlas']) {
    assert.strictEqual(await reopenBoard(state), 'is:open', `${JSON.stringify(state)} opens on the default search`);
  }
});

test('the gear\'s Theme row runs Choose Theme', async () => {
  const { view } = await openBoard();
  vscode._test.executedCommands.length = 0;
  view.click(view.find('[data-action="choose-theme"]'));
  await delay(10);
  assert.ok(vscode._test.executedCommands.some((entry) => entry.command === 'deckard.chooseTheme'));
});

test('searches tasks with the search box every search page uses', async () => {
  const { view, preferences, cards } = await openBoard();
  assert.ok(view.find('.query-workspace'), 'the shared search box is drawn');
  assert.strictEqual(view.find('#board-query'), null, 'the old filter form is gone');
  // The board opens on a search of its own: the tasks still open.
  assert.strictEqual(view.find('.query-bar-shell').getAttribute('data-query-text'), 'is:open');
  assert.deepStrictEqual(cards(), ['audit', 'call', 'room']);

  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'tag = #project/atlas');
  view.keydown(bar, 'Enter');
  await delay(10);

  assert.deepStrictEqual(cards(), ['audit', 'call']);
  // What is typed narrows the search the board opened on, rather than
  // replacing it, so the board still holds its own tasks.
  assert.strictEqual(
    view.find('.query-bar-shell').getAttribute('data-query-text'),
    'is:open AND tag = #project/atlas',
  );
  assert.strictEqual(view.find('[data-action="query-input"]').value, '', 'the search is a chip now');
  // The count names tasks alone, since the board finds nothing else.
  assert.strictEqual(view.find('.query-facets-count').textContent, '2 tasks');
  assert.deepStrictEqual(preferences.reader.value.recentQueries, ['is:open AND tag = #project/atlas']);
  assert.strictEqual(
    view.state.query,
    'is:open AND tag = #project/atlas',
    'a reload reopens the search',
  );

  view.click(view.find('[data-action="clear-query"]'));
  await delay(10);
  assert.deepStrictEqual(cards(), ['audit', 'call', 'room', 'ship'], 'clearing it shows finished tasks too');
});

test('Can start now narrows the board to is:available, and back to is:open', async () => {
  const { view } = await openBoard();
  const toggle = () => view.find('[data-action="toggle-available"]');
  assert.ok(toggle(), 'the switch is beside the grouping');
  assert.strictEqual(toggle().getAttribute('aria-pressed'), 'false');
  view.click(toggle());
  await delay(10);
  assert.strictEqual(view.find('.query-bar-shell').getAttribute('data-query-text'), 'is:available');
  assert.strictEqual(toggle().getAttribute('aria-pressed'), 'true', 'pressed while the search asks for it');
  view.click(toggle());
  await delay(10);
  assert.strictEqual(view.find('.query-bar-shell').getAttribute('data-query-text'), 'is:open');
  assert.strictEqual(toggle().getAttribute('aria-pressed'), 'false');
});

test('the board is one Tab stop, and a focused card answers single keys', async () => {
  const { view, updates } = await openBoard();
  const stops = () => view.findAll('.board-card').filter((card) => card.getAttribute('tabindex') === '0');
  assert.strictEqual(stops().length, 1, 'one card is the Tab stop');
  assert.ok(
    view.findAll('.board-card input, .board-card .board-move').every((control) => control.getAttribute('tabindex') === '-1'),
    'a card\'s checkbox and menu are keys, not Tab stops',
  );

  const first = stops()[0];
  const column = first.closest('.board-column');
  const inColumn = column.querySelectorAll('.board-card');
  first.focus();
  view.keydown(first, 'ArrowDown');
  assert.strictEqual(view.document.activeElement, inColumn[1], 'down is the next card in the column');
  assert.strictEqual(stops().length, 1);
  assert.strictEqual(stops()[0], inColumn[1], 'and becomes the Tab stop');

  const taskId = inColumn[1].dataset.taskId;
  const columnId = column.dataset.columnId;
  // The card as the last state drew it.
  const card = () => view.find(`.board-card[data-task-id="${taskId}"]`);
  const sent = () => view.posted[view.posted.length - 1];
  // A card's next edit waits for the host to answer the last with a state,
  // since the edit gives the task a new id; this index keeps its ids.
  const answered = async () => {
    updates.fire();
    await delay(10);
  };
  view.keydown(card(), 'e');
  assert.deepStrictEqual(sent(), { type: 'editTask', taskId });
  view.keydown(card(), 'd');
  assert.deepStrictEqual(sent(), { type: 'pickTaskDate', taskId });
  view.keydown(card(), 't');
  assert.deepStrictEqual(sent(), { type: 'moveTask', taskId, column: 'due:today', from: columnId, requestId: 1 });
  await answered();
  view.keydown(card(), '2');
  assert.deepStrictEqual(sent(), { type: 'moveTask', taskId, column: 'priority:high', from: columnId, requestId: 2 });
  await answered();
  view.keydown(card(), ']');
  const droppable = view.findAll('.board-column').filter((candidate) => candidate.dataset.droppable === 'true');
  const next = droppable[droppable.findIndex((candidate) => candidate.dataset.columnId === columnId) + 1];
  assert.deepStrictEqual(sent(), { type: 'moveTask', taskId, column: next.dataset.columnId, from: columnId, requestId: 3 });
  await answered();
  view.keydown(card(), 'x');
  assert.deepStrictEqual(sent(), { type: 'toggleTask', taskId, completed: true });

  view.keydown(card(), '?');
  const sheet = view.find('.key-sheet');
  assert.ok(sheet, 'the keys are listed on ?');
  assert.strictEqual(sheet.getAttribute('role'), 'dialog');
  view.keydown(view.document.activeElement, 'Escape');
  assert.strictEqual(view.find('.key-sheet'), null, 'Escape closes it');
});

test('a card\'s menu checks where the task is, and its keys work inside it', async () => {
  const { view } = await openBoard();
  const card = view.find('.board-card[data-task-id="audit"]');
  view.click(card.querySelector('[data-action="board-menu"]'));
  const columnId = card.closest('.board-column').dataset.columnId;
  const own = view.find(`#action-menu [data-menu-value="${columnId}"]`);
  assert.strictEqual(own.getAttribute('aria-checked'), 'true', 'the column the card is in is checked');
  assert.strictEqual(view.document.activeElement, own, 'and focus starts there');
  view.keydown(view.document.activeElement, 't');
  assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'moveTask', taskId: 'audit', column: 'due:today', from: columnId, requestId: 1 });
  assert.strictEqual(view.find('#action-menu').hidden, true, 'the menu closes on a choice');
});

test('a card\'s menu has a Note group with Move to…, which asks the host', async () => {
  const { view, panel } = await openBoard();
  const card = view.find('.board-card[data-task-id="audit"]');
  view.click(card.querySelector('[data-action="board-menu"]'));
  const moveTo = view.find('#action-menu [data-menu-value="move-to"]');
  assert.ok(moveTo, 'Move to… is in the menu');
  assert.ok(moveTo.textContent.includes('Move to…'));
  const deliver = panel._onWebviewMessage;
  panel._onWebviewMessage = () => undefined;
  try {
    view.click(moveTo);
    assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'moveTaskTo', taskId: 'audit' });
  } finally {
    panel._onWebviewMessage = deliver;
  }
});

test('a list row and a table row have the card\'s menu, which checks where the task is', async () => {
  const { view, panel } = await openBoard(async (store) => {
    await store.taskLayout.setTaskBoardLayout('list');
  });
  const row = view.find('.task-list .task-row[data-task-id="audit"]');
  assert.ok(row, 'the board opened as a list');
  view.click(row.querySelector('[data-action="task-row-menu"]'));
  assert.strictEqual(
    view.find('#action-menu [data-menu-value="priority:"]').getAttribute('aria-checked'),
    'true',
    'the priority the task has, none, is checked',
  );
  assert.ok(view.find('#action-menu [data-menu-value="move-to"]'), 'with the Note group');
  view.keydown(view.document.activeElement, 't');
  assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'moveTask', taskId: 'audit', column: 'due:today', requestId: 1 });
  assert.strictEqual(view.find('#action-menu').hidden, true, 'the menu closes on a choice');

  view.click(view.find('[data-action="set-task-layout"][data-value="table"]'));
  await delay(10);
  const tableRow = view.find('.result-table .result-row[data-task-id="room"]');
  assert.ok(tableRow, 'the board is a table');
  const deliver = panel._onWebviewMessage;
  panel._onWebviewMessage = () => undefined;
  try {
    view.click(tableRow.querySelector('[data-action="task-row-menu"]'));
    assert.strictEqual(view.find('#action-menu [data-menu-value="status:"]').getAttribute('aria-checked'), 'true');
    view.click(view.find('#action-menu [data-menu-value="move-to"]'));
    assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'moveTaskTo', taskId: 'room' });
  } finally {
    panel._onWebviewMessage = deliver;
  }
});

test('a card breaks into steps from its menu and from s, which ask the host', async () => {
  const { view, panel } = await openBoard();
  const card = view.find('.board-card[data-task-id="audit"]');
  assert.ok(card.getAttribute('aria-keyshortcuts').split(' ').includes('s'), 's is one of the card\'s keys');
  view.click(card.querySelector('[data-action="board-menu"]'));
  const steps = view.find('#action-menu [data-menu-value="break-steps"]');
  assert.ok(steps, 'Break into steps… is in the menu');
  assert.ok(steps.textContent.includes('Break into steps…'));
  const deliver = panel._onWebviewMessage;
  panel._onWebviewMessage = () => undefined;
  try {
    view.click(steps);
    assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'breakIntoSteps', taskId: 'audit' });
    view.keydown(card, 's');
    assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'breakIntoSteps', taskId: 'audit' });
    view.keydown(card, '?');
    assert.ok(view.find('.key-sheet').textContent.includes('Break it into steps'), 'the key sheet lists s');
  } finally {
    panel._onWebviewMessage = deliver;
  }
});

/** A task with three steps: one done, one plain, and one with a date of its own. */
function createIndexWithSteps() {
  const index = createIndex();
  const step = (id, title, lineNumber, { completed, ...extra }) => ({
    id, filePath: 'notes/tasks.md', title, completed, tags: [], tagLabels: {},
    associationTagGroups: [[]], lineNumber, checkboxColumn: 5, checkboxValue: completed ? 'x' : ' ',
    sourceLineText: `  - [${completed ? 'x' : ' '}] ${title}`, parentTaskId: 'plan', ...extra,
  });
  index.tasks.set('plan', {
    id: 'plan', filePath: 'notes/tasks.md', title: 'Plan the offsite', completed: false, tags: [], tagLabels: {},
    associationTagGroups: [[]], lineNumber: 10, checkboxColumn: 3, checkboxValue: ' ',
    sourceLineText: '- [ ] Plan the offsite',
    steps: { ids: ['venue', 'email', 'caterer'], total: 3, done: 1, next: 'Draft the email' },
  });
  index.tasks.set('venue', step('venue', 'Book the venue', 11, { completed: true }));
  index.tasks.set('email', step('email', 'Draft the email', 12, { completed: false }));
  index.tasks.set('caterer', step('caterer', 'Call the caterer', 13, { completed: false, dueAt: Date.now(), dueText: 'today' }));
  return index;
}

test('a card says how far along its steps are, and a plain step rides on it', async () => {
  const { view, cards } = await openBoard(undefined, createIndexWithSteps);
  const ids = cards();
  assert.ok(ids.includes('plan'));
  assert.ok(!ids.includes('email'), 'a plain step has no card of its own');
  assert.ok(ids.includes('caterer'), 'a dated step keeps its card');
  const plan = view.find('.board-card[data-task-id="plan"]');
  assert.strictEqual(plan.querySelector('.board-steps').textContent, '1 of 3 steps · next: Draft the email');
  assert.ok(plan.getAttribute('aria-label').includes('1 of 3 steps'));
  view.click(plan.querySelector('[data-action="board-menu"]'));
  assert.ok(view.find('#action-menu [data-menu-value="break-steps"]').textContent.includes('Add steps…'));
});

test('a column that takes a card takes a new task, and a menu offers any date', async () => {
  const { view } = await openBoard();
  const add = view.find('[data-action="board-add-task"]');
  assert.ok(add, 'a column that takes a drop has + Add task');
  view.click(add);
  assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'addTaskToColumn', column: add.dataset.columnId });
});

test('saves its search as a view that reopens on the Task Board', async () => {
  const { view, preferences, index } = await openBoard();
  const save = () => view.find('[data-action="save-board-search"]');
  assert.ok(save(), 'Save sits in the search bar');
  view.click(view.find('[data-action="clear-query"]'));
  await delay(10);
  assert.strictEqual(save().getAttribute('aria-disabled'), 'true', 'with no search, there is nothing to save');
  assert.strictEqual(save().getAttribute('data-tip-disabled'), 'Type a search to save it');

  const bar = view.find('[data-action="query-input"]');
  view.type(bar, '#project/atlas is:open');
  view.keydown(bar, 'Enter');
  await delay(10);
  assert.strictEqual(save().getAttribute('aria-disabled'), null);

  vscode._test.setInputBoxResponse('Atlas board');
  vscode._test.setInformationResponse('Show Results on Home');
  vscode._test.executedCommands.length = 0;
  view.click(save());
  await delay(10);
  vscode._test.setInputBoxResponse(undefined);
  const [saved] = preferences.reader.value.savedFilters;
  assert.deepStrictEqual(
    { name: saved.name, query: saved.query, page: saved.page },
    { name: 'Atlas board', query: '#project/atlas is:open', page: 'taskBoard' },
  );
  assert.ok(vscode._test.shown.info.includes('Saved the search "Atlas board".'));
  // Show Results on Home adds its widget and opens Home on Home.
  assert.ok(preferences.reader.value.dashboardWidgets.some((widget) => widget.kind === 'savedQuery' && widget.filterId === saved.id));
  assert.strictEqual(preferences.reader.value.dashboardViewState.mode, 'home');
  assert.ok(vscode._test.executedCommands.some((entry) => entry.command === 'deckard.showDashboard'));

  // The Dashboard reopens it on the board, not on a search page.
  const opened = [];
  const dashboard = new DashboardPanel({
    indexer: { ready: Promise.resolve(), getSnapshot: () => index, onDidUpdate: new vscode.EventEmitter().event },
    preferences,
    extensionUri: vscode.Uri.file('/ext'),
    navigation: {
      openTag: () => undefined,
      openSearch: (query) => opened.push(`search ${query}`),
      openTaskBoard: (query) => opened.push(`board ${query}`),
    },
    writes: modules.taskWrites.createTaskWrites(),
    themePreview: new ThemePreview(),
  });
  await dashboard.openSavedFilter(saved.id);
  dashboard.dispose();
  assert.deepStrictEqual(opened, ['board #project/atlas is:open']);
});

test('hands its search to the Tasks view, and says when the view has it', async () => {
  const { view } = await openBoard();
  const button = () => view.find('[data-action="use-for-agenda"]');
  assert.ok(button(), 'List in Tasks view sits in the gear');
  assert.strictEqual(button().closest('.view-options') !== null, true, 'in the gear, not the search bar');
  assert.strictEqual(view.find('.query-bar-row [data-action="use-for-agenda"]'), null);
  assert.strictEqual(button().getAttribute('aria-pressed'), 'true', 'the view lists every open task, and so does a board with no search');
  assert.strictEqual(button().getAttribute('aria-disabled'), 'true', 'so there is nothing to change');

  // The board opens on is:open, so the search is cleared before it is typed.
  view.click(view.find('[data-action="clear-query"]'));
  await delay(10);
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'is:mine');
  view.keydown(bar, 'Enter');
  await delay(10);
  assert.ok(!button().classList.contains('active'), 'the view does not list this search yet');

  view.click(button());
  await delay(10);
  assert.deepStrictEqual(
    vscode._test.configurationUpdates.map((update) => [update.name, update.value]),
    [['deckard.agenda.query', 'is:mine']],
    "the search is written as the view's own",
  );
  assert.strictEqual(vscode._test.configurationUpdates[0].target, vscode.ConfigurationTarget.Global);
  assert.ok(button().classList.contains('active'), "lit once the view lists the board's search");
  assert.strictEqual(button().getAttribute('aria-disabled'), null);

  // Pressed again, the Tasks view lists every open task again.
  view.click(button());
  await delay(10);
  assert.deepStrictEqual(
    vscode._test.configurationUpdates.map((update) => [update.name, update.value]),
    [['deckard.agenda.query', 'is:mine'], ['deckard.agenda.query', '']],
  );
  assert.ok(vscode._test.shown.info.includes('The Tasks view lists every open task again.'));
  assert.strictEqual(button().getAttribute('aria-pressed'), 'false');
});

test('shows a line for Refine while the sidebar holds it', async () => {
  const { view, activeSearch, board } = await openBoard();
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'tag = #project/atlas');
  view.keydown(bar, 'Enter');
  await delay(10);
  assert.ok(view.find('.query-facet-value'), 'Refine is on the page while no sidebar shows it');
  assert.strictEqual(activeSearch.active, board, 'the open board is the active search');

  activeSearch.setSidebarVisible(true);
  assert.strictEqual(view.find('.query-facet-value'), null);
  assert.ok(view.find('.query-facets.is-elsewhere'), 'a line takes Refine\'s place');
  assert.deepStrictEqual(board.getRefineState().resultKinds, ['tasks']);

  await board.applySearch('tag = #project/atlas is:done');
  assert.strictEqual(view.find('.query-bar-shell').getAttribute('data-query-text'), 'tag = #project/atlas is:done');

  activeSearch.setSidebarVisible(false);
  assert.strictEqual(view.find('.query-facets.is-elsewhere'), null, 'closing the sidebar brings Refine back');
});

test('plain words hide cards at once, and typing survives a host update', async () => {
  const { view, panel, updates, shownCards } = await openBoard();
  const bar = () => view.find('[data-action="query-input"]');

  view.type(bar(), 'ren');
  assert.deepStrictEqual(shownCards(), ['call'], 'the board narrows as words are typed');
  assert.strictEqual(view.posted.some((message) => message.type === 'setBoardQuery'), false);

  updates.fire();
  assert.strictEqual(bar().value, 'ren', 'the newer typing must survive');
  assert.strictEqual(view.document.activeElement, bar(), 'the box keeps focus');
  assert.deepStrictEqual(shownCards(), ['call']);
  assert.ok(panel._toWebview.length > 1);
});

test('a search that does not parse keeps the board and says why', async () => {
  const { view, cards } = await openBoard();
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'tag = #project/atlas');
  view.keydown(bar, 'Enter');
  await delay(10);

  view.type(view.find('[data-action="query-input"]'), 'priority >=');
  view.keydown(view.find('[data-action="query-input"]'), 'Enter');
  await delay(10);

  assert.ok(view.find('.query-error'), 'the error is under the box');
  assert.strictEqual(view.find('[data-action="query-input"]').value, 'priority >=');
  assert.deepStrictEqual(cards(), ['audit', 'call'], 'the last search still applies');
});

test('the gear switches between columns and a list, and stays open', async () => {
  const { view, preferences } = await openBoard();
  const gear = view.find('.view-options');
  assert.ok(gear, 'the board has the shared gear');
  assert.ok(view.find('.view-options summary .settings-icon'));
  // A browser reflects an open menu in its open attribute.
  view.find('.view-options').setAttribute('open', '');

  view.click(view.find('[data-action="set-task-layout"][data-value="list"]'));
  await delay(10);
  assert.strictEqual(preferences.reader.value.taskBoardLayout, 'list');
  assert.strictEqual(view.find('.view-options').open, true, 'the menu stays open for another choice');
  view.find('.view-options').setAttribute('open', '');
  assert.strictEqual(view.find('.task-board'), null);
  // The list starts on open tasks, with the counts of each filter.
  assert.deepStrictEqual(
    view.findAll('.task-list .task-row').map((row) => row.dataset.taskId).sort(),
    ['audit', 'call', 'room'],
  );
  assert.ok(view.find('[data-action="set-task-sort"]'), 'the list can be sorted');
  assert.ok(view.find('.task-list .task-row.is-draggable'), 'ranked rows can be dragged');

  // There is no All/Open/Done switch here: the board's search is its filter,
  // so finished tasks are asked for the same way as anything else.
  assert.strictEqual(view.find('[data-action="set-task-filter"]'), null, 'the status switch is gone');
  const bar = () => view.find('[data-action="query-input"]');
  view.click(view.find('[data-action="clear-query"]'));
  await delay(10);
  view.type(bar(), 'is:done');
  view.keydown(bar(), 'Enter');
  await delay(10);
  assert.deepStrictEqual(view.findAll('.task-list .task-row').map((row) => row.dataset.taskId), ['ship']);
  view.find('.view-options').setAttribute('open', '');

  view.change(view.find('[data-action="set-task-sort"]'), 'created');
  await delay(10);
  assert.strictEqual(preferences.reader.value.taskSortMode, 'created');
  assert.strictEqual(view.find('.task-list .task-row.is-draggable'), null, 'a date sort is not dragged');

  // A click outside the menu closes it.
  view.click(view.find('h1'));
  assert.strictEqual(view.find('.view-options').open, false);

  view.click(view.find('[data-action="set-task-layout"][data-value="board"]'));
  await delay(10);
  assert.ok(view.find('.task-board'), 'the board is back');
  assert.ok(view.find('[data-action="set-board-group"]'), 'with its grouping');
});

test('the gear turns the board into a table, whose headers sort and whose columns are chosen', async () => {
  const { view, preferences } = await openBoard();
  view.find('.view-options').setAttribute('open', '');
  view.click(view.find('[data-action="set-task-layout"][data-value="table"]'));
  await delay(10);
  assert.strictEqual(preferences.reader.value.taskBoardLayout, 'table');
  assert.ok(view.find('.result-table'), 'the tasks are a table now');
  assert.deepStrictEqual(
    view.findAll('.result-table .result-row').map((row) => row.dataset.taskId).sort(),
    ['audit', 'call', 'room'],
    'the same open tasks the search found',
  );
  assert.deepStrictEqual(
    view.findAll('.result-table th button').map((button) => button.textContent),
    ['Task', 'Due', 'Priority', 'For', 'Note'],
  );

  view.click(view.find('[data-action="set-table-sort"][data-value="due"]'));
  await delay(10);
  assert.deepStrictEqual(preferences.reader.value.taskTableSort, { column: 'due', direction: 'asc' });
  view.click(view.find('[data-action="set-table-sort"][data-value="due"]'));
  await delay(10);
  assert.deepStrictEqual(preferences.reader.value.taskTableSort, { column: 'due', direction: 'desc' }, 'the same header again turns it round');
  assert.ok(view.find('th.is-sorted'), 'the sorted column is marked');
  view.click(view.findAll('[data-action="set-table-sort"]').find((button) => !button.dataset.value));
  await delay(10);
  assert.strictEqual(preferences.reader.value.taskTableSort, undefined, 'Rank order clears it');

  view.find('.view-options').setAttribute('open', '');
  const title = view.find('[data-action="toggle-table-column"][data-value="title"]');
  assert.notStrictEqual(title.getAttribute('disabled'), null, 'the title cannot be taken away');
  const status = view.find('[data-action="toggle-table-column"][data-value="status"]');
  status.checked = true;
  view.change(status);
  await delay(10);
  assert.deepStrictEqual(
    preferences.reader.value.taskTableColumns,
    ['title', 'due', 'priority', 'assignee', 'status', 'note'],
    'a column joins in the order the picker lists it',
  );
});

test('the gear edits the status columns without opening settings', async () => {
  const { view, lastState } = await openBoard();
  const columns = () =>
    view.findAll('.board-column').map((column) => column.dataset.columnId);
  assert.deepStrictEqual(
    view.findAll('.board-status-name').map((name) => name.textContent),
    ['todo', 'doing', 'waiting'],
  );

  view.type(view.find('[data-action="status-draft"]'), 'Review');
  view.submit(view.find('[data-form="add-status"]'));
  await delay(10);
  assert.deepStrictEqual(vscode._test.configurationUpdates.map((update) => [update.name, update.value]), [
    ['deckard.board.statuses', ['todo', 'doing', 'waiting', 'review']],
  ]);
  assert.strictEqual(vscode._test.configurationUpdates[0].target, vscode.ConfigurationTarget.Global);
  assert.deepStrictEqual(lastState().data.settings.statuses, ['todo', 'doing', 'waiting', 'review']);
  assert.ok(columns().includes('status:review'), 'the board shows the new column');
  assert.strictEqual(view.find('[data-action="status-draft"]').value, '', 'the field empties');

  // Dragging a column's row past another moves it there.
  assert.strictEqual(view.find('[data-action="move-status"]'), null, 'no arrow buttons');
  const row = (status) => view.find(`.board-status[data-status="${status}"]`);
  assert.ok(row('review').classList.contains('is-draggable'));
  view.fire('pointerdown', row('review').children[0], { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  view.document.pointerTarget = row('waiting');
  view.fire('pointermove', row('review'), { pointerId: 1, clientX: 10, clientY: 2 });
  view.fire('pointerup', row('review'), { pointerId: 1, clientX: 10, clientY: 2 });
  // The click a drag ends with does nothing more.
  const posted = view.posted.length;
  view.click(row('review'));
  assert.strictEqual(view.posted.length, posted, 'only the new order is sent');
  await delay(10);
  assert.deepStrictEqual(lastState().data.settings.statuses, ['todo', 'doing', 'review', 'waiting']);
  assert.strictEqual(view.find('.drag-ghost'), null, 'the ghost is cleared');
  assert.strictEqual(view.find('.drag-placeholder'), null, 'the placeholder is cleared');

  // Right-click moves a column first or last, without a drag.
  view.fire('contextmenu', row('waiting'));
  const menu = view.findAll('#rank-context-menu button').map((button) => button.textContent);
  assert.deepStrictEqual(menu, ['Move up', 'Move down', 'Move to first column', 'Move to last column']);
  view.click(view.find('#rank-context-menu [data-context-action="top"]'));
  await delay(10);
  assert.deepStrictEqual(lastState().data.settings.statuses, ['waiting', 'todo', 'doing', 'review']);
  view.fire('contextmenu', row('waiting'));
  view.click(view.find('#rank-context-menu [data-context-action="bottom"]'));
  await delay(10);
  assert.deepStrictEqual(lastState().data.settings.statuses, ['todo', 'doing', 'review', 'waiting']);

  view.click(view.find('[data-action="remove-status"][data-status="todo"]'));
  await delay(10);
  assert.deepStrictEqual(lastState().data.settings.statuses, ['doing', 'review', 'waiting']);

  view.type(view.find('[data-action="status-draft"]'), 'to do');
  view.submit(view.find('[data-form="add-status"]'));
  assert.ok(view.find('.board-settings-error'), 'a name that cannot be a tag is refused');
  assert.strictEqual(view.find('[data-action="status-draft"]').value, 'to do', 'what was typed is kept');
  assert.strictEqual(view.document.activeElement, view.find('[data-action="status-draft"]'));

  view.type(view.find('[data-action="namespace-draft"]'), 'stage');
  view.submit(view.find('[data-form="status-namespace"]'));
  await delay(10);
  assert.strictEqual(vscode._test.settings.get('deckard.board.statusNamespace'), 'stage');
  assert.strictEqual(lastState().data.settings.statusNamespace, 'stage');
});

test('writes status columns where a workspace already sets them', async () => {
  const { view } = await openBoard();
  const getConfiguration = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = (section) => ({
    ...getConfiguration(section),
    inspect: (key) => ({ key, workspaceValue: ['todo'] }),
  });
  try {
    view.type(view.find('[data-action="status-draft"]'), 'blocked');
    view.submit(view.find('[data-form="add-status"]'));
    await delay(10);
  } finally {
    vscode.workspace.getConfiguration = getConfiguration;
  }
  assert.strictEqual(vscode._test.configurationUpdates[0].target, vscode.ConfigurationTarget.Workspace);
});

test('a hidden board skips updates and catches up when shown', async () => {
  const { panel, updates } = await openBoard();
  panel._setVisible(false);
  const before = panel._toWebview.length;
  updates.fire();
  assert.strictEqual(panel._toWebview.length, before, 'nothing is drawn while hidden');
  panel._setVisible(true);
  assert.strictEqual(panel._toWebview.length, before + 1, 'showing it draws once');
});

