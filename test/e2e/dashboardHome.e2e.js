// End-to-end: the Dashboard's Home and Tags tabs against the real host and
// script.
//
// Home's widgets are arranged on the page and kept by the host, which answers
// each change with the whole state. Storing a tag search does the same, so
// these also check that typing survives that round trip.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview, createGlobalState } = require('./support.js');
const { loadPage } = require('../harness/loadPage.js');
const modules = require('../harness/modules.js');
const { DashboardPanel } = modules.dashboard;
const { createPreferences } = modules.preferenceServices;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexState;
const { ThemePreview } = modules.themePreview;

/** Longer than the page's search debounce. */
const SETTLE_MS = 450;

function createIndex() {
  const task = (id, title, lineNumber) => ({
    id, filePath: 'notes/tasks.md', title, completed: false, tags: [],
    tagLabels: {}, lineNumber, checkboxColumn: 3, checkboxValue: ' ',
    sourceLineText: `- [ ] ${title}`,
  });
  const tasks = [
    task('audit', 'Send the audit summary', 1),
    task('room', 'Book the review room', 2),
    task('call', 'Call Ren', 3),
  ];
  return {
    files: new Map(),
    sections: new Map(),
    tasks: new Map(tasks.map((entry) => [entry.id, entry])),
    tags: new Map(),
    entities: new Map(),
    tagAssociations: new Map(),
    updatedAt: Date.now(),
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The Home most of these tests work on: one arranged with a tasks widget
 * beside the Tasks view, as Home started before 2.2 and as anyone who adds
 * one has it. A new Home starts without it; the first test checks that.
 */
const HOME_WITH_TASKS = [
  { id: 'tryNext', kind: 'tryNext', width: 'full' },
  { id: 'search', kind: 'search', width: 'full' },
  { id: 'agenda', kind: 'agenda', width: 'half', count: 5 },
  { id: 'tasks', kind: 'tasks', width: 'half', count: 5, query: 'is:open' },
  { id: 'favoriteTags', kind: 'favoriteTags', width: 'half', count: 8 },
  { id: 'savedSearches', kind: 'savedSearches', width: 'half' },
];

/**
 * Opens the Dashboard and mounts its webview, wired to the real host, on
 * HOME_WITH_TASKS.
 * `prepare` sets preferences first, as an earlier visit would have;
 * `indexerExtras` adds to the stand-in indexer, and `whatsNew` and `tryNext`
 * are the host's own, when a test gives them.
 */
async function openDashboard(
  index = createIndex(),
  prepare = async () => undefined,
  { indexerExtras = {}, whatsNew = undefined, tryNext = undefined } = {},
) {
  vscode._test.createdPanels.length = 0;
  const updates = new vscode.EventEmitter();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: updates.event,
    ...indexerExtras,
  };
  const preferences = createPreferences(createGlobalState());
  await preferences.homeWidgets.setDashboardWidgets(HOME_WITH_TASKS);
  await prepare(preferences);
  const navigation = createNavigation();
  const dashboard = new DashboardPanel({
    indexer,
    preferences,
    extensionUri: vscode.Uri.file('/ext'),
    navigation,
    whatsNew,
    tryNext,
    writes: modules.taskWrites.createTaskWrites(),
    themePreview: new ThemePreview(),
  });
  await dashboard.show();
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  panel._toWebview.forEach((message) => panel._deliver(message));

  /** The last state the host sent, as a fresh copy to deliver again. */
  const lastState = () =>
    JSON.parse(JSON.stringify(panel._toWebview[panel._toWebview.length - 1]));
  const stored = (field) =>
    view.posted
      .filter((message) => message.type === 'setDashboardSearch' && message.field === field)
      .map((message) => message.query);
  return { view, panel, updates, lastState, stored, preferences, navigation };
}

/** Where the Dashboard sent the reader. */
function createNavigation() {
  const opened = [];
  return {
    opened,
    openTag: (tagKey) => {
      opened.push(`tag ${tagKey}`);
    },
    openSearch: (query) => {
      opened.push(`search ${query}`);
    },
    openTaskBoard: (query) => {
      opened.push(`board ${query ?? ''}`);
    },
    openDailyNote: () => {
      opened.push('today');
    },
    quickAdd: (text) => {
      opened.push(`add ${text}`);
      return !text.includes('refused');
    },
    createHubNote: (tagKey) => {
      opened.push(`hub ${tagKey}`);
    },
  };
}

/** A note in the editor, a note sharing its tags, and a tag with no hub. */
function createNotesIndex() {
  const note = (filePath, content) =>
    parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 2 }, {});
  const files = [
    note('notes/current.md', '# Current work #project/atlas #risk/vendor\n- [ ] Draft the plan'),
    note('notes/vendor.md', '# Vendor call #risk/vendor\n- [ ] Call the vendor\n- [ ] Send the notes'),
    note('notes/atlas.md', '# Atlas #project/atlas'),
    note('notes/contract.md', '# Contract review #risk/vendor'),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

// ---------------------------------------------------------------------------

test('opens on Home, even when it was left on Search or Tasks', async () => {
  for (const mode of ['notes', 'tasks']) {
    const globalState = createGlobalState();
    // Preferences saved while the Dashboard still had these tabs.
    await globalState.update('deckard.preferences', {
      version: 1,
      dashboardViewState: { mode, taskSearchQuery: 'audit', noteSearchQuery: 'vault', tagSearchQuery: '' },
    });
    vscode._test.createdPanels.length = 0;
    const updates = new vscode.EventEmitter();
    const index = createIndex();
    const dashboard = new DashboardPanel({
      indexer: { ready: Promise.resolve(), getSnapshot: () => index, onDidUpdate: updates.event },
      preferences: createPreferences(globalState),
      extensionUri: vscode.Uri.file('/ext'),
      navigation: createNavigation(),
      writes: modules.taskWrites.createTaskWrites(),
      themePreview: new ThemePreview(),
    });
    await dashboard.show();
    const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
    const view = mountWebview(panel.webview.html, panel);
    panel._toWebview.forEach((message) => panel._deliver(message));

    assert.deepStrictEqual(
      view.findAll('[role="tab"][data-dashboard-mode]').map((tab) => tab.dataset.dashboardMode),
      ['home', 'browse'],
    );
    assert.strictEqual(view.find('[data-dashboard-mode="home"]').getAttribute('aria-selected'), 'true');
    assert.strictEqual(view.find('h1').textContent, 'Dashboard: Home');
    // Home starts with its default widgets.
    assert.deepStrictEqual(
      view.findAll('.home-widget').map((widget) => widget.dataset.widgetId),
      ['search', 'agenda', 'recentNotes', 'favoriteTags', 'savedSearches'],
    );
    const labels = view.findAll('.view-options-group').map((group) => group.children[0].textContent);
    assert.deepStrictEqual(labels, ['Home', 'Tag columns', 'Get started', 'Theme', 'Zen']);
  }
});

test('after an update Home says so once, and Dismiss takes the line away', async () => {
  const changed = new vscode.EventEmitter();
  let pending = { version: '1.23' };
  const whatsNew = {
    pending: () => pending,
    clear: async () => {
      pending = undefined;
      changed.fire();
    },
    onDidChange: changed.event,
  };
  const { view, lastState } = await openDashboard(createIndex(), undefined, { whatsNew });
  assert.deepStrictEqual(lastState().data.whatsNew, { version: '1.23' });
  assert.strictEqual(view.find('.whats-new-bar span').textContent, 'Updated to Deckard 1.23.');

  view.click(view.find('[data-action="dismiss-whats-new"]'));
  await delay(20);
  assert.strictEqual(lastState().data.whatsNew, undefined, 'the next state has no line');
  assert.strictEqual(view.findAll('.whats-new-bar').length, 0);
});

test('Try next suggests the Task board, and runs only the command it chose', async () => {
  const index = createIndex();
  for (let i = 0; i < 8; i += 1) {
    const id = `more-${i}`;
    index.tasks.set(id, { ...index.tasks.get('audit'), id, title: `More ${i}`, lineNumber: 10 + i });
  }
  const changed = new vscode.EventEmitter();
  const retired = new Set();
  const ledger = {
    retired: () => retired,
    snoozed: () => ({}),
    retire: async (key) => {
      retired.add(key);
      changed.fire();
    },
    snooze: async () => undefined,
    onDidChange: changed.event,
  };
  const { view, lastState } = await openDashboard(index, undefined, { tryNext: ledger });
  const card = lastState().data.widgets.find((widget) => widget.kind === 'tryNext');
  assert.strictEqual(card.tryNext.id, 'taskBoard');
  assert.match(view.find('.try-next-text').textContent, /^You have 11 open tasks\./);

  vscode._test.executedCommands.length = 0;
  view.posted.length = 0;
  view.click(view.find('[data-action="run-try-next"]'));
  await delay(20);
  assert.deepStrictEqual(
    vscode._test.executedCommands.map((entry) => entry.command),
    ['deckard.showTaskBoard'],
  );

  view.click(view.find('[data-action="retire-try-next"]'));
  await delay(20);
  assert.ok(retired.has('taskBoard'));
  assert.strictEqual(lastState().data.widgets.find((widget) => widget.kind === 'tryNext').tryNext, undefined);
  assert.strictEqual(view.findAll('.home-widget[data-widget-id="tryNext"]').length, 0);
});

test('a hidden Dashboard skips updates and catches up when shown', async () => {
  const { panel, updates } = await openDashboard();
  panel._setVisible(false);
  const before = panel._toWebview.length;
  updates.fire();
  updates.fire();
  assert.strictEqual(panel._toWebview.length, before, 'nothing is drawn while hidden');

  panel._setVisible(true);
  assert.strictEqual(panel._toWebview.length, before + 1, 'showing it draws once');
});

test('only Home is sent its widgets', async () => {
  const { view, lastState } = await openDashboard(createIndex(), (preferences) =>
    preferences.homeWidgets.setDashboardMode('browse'),
  );
  assert.strictEqual(lastState().data.widgets, undefined, 'the Tags tab is sent no widgets');
  assert.ok(lastState().data.widgetConfig.length > 0, 'but it knows how Home is arranged');

  view.click(view.find('[data-dashboard-mode="home"]'));
  await delay(20);
  const tasks = lastState().data.widgets.find((widget) => widget.kind === 'tasks');
  assert.strictEqual(tasks.total, 3);
  assert.deepStrictEqual(
    view.findAll('.home-widget[data-widget-id="tasks"] .task-row').map((row) => row.dataset.taskId),
    ['audit', 'room', 'call'],
    'the tasks widget lists the open tasks, as the Task Board ranks them',
  );
});

test('a Dashboard opened on the Tags tab tells Related Notes what Home can add', async () => {
  const { view } = await openDashboard(createIndex(), (preferences) =>
    preferences.homeWidgets.setDashboardMode('browse'),
  );
  const sent = view.posted.filter((message) => message.type === 'widgetChoices');
  assert.strictEqual(sent.length, 1, 'told once, before Home is shown');
  const offered = sent[0].choices.map((choice) => choice.value);
  assert.ok(offered.includes('stats'), 'a widget Home does not hold is offered');
  assert.ok(!offered.includes('search'), 'one it holds, that cannot repeat, is not');
});

test('every page size a paged widget offers is the size Home keeps', async () => {
  const { view, preferences } = await openDashboard(createIndex(), async (store) => {
    await store.homeWidgets.setDashboardWidgets([{ id: 'paged', kind: 'tasks', width: 'half', count: 5, paged: true, page: 1, query: 'is:open' }]);
  });
  const sizes = () => view.find('[data-action="set-widget-page-size"]');
  const offered = [...sizes().options].map((option) => Number(option.value));
  assert.ok(offered.length > 1);
  for (const size of offered) {
    view.change(sizes(), String(size));
    await delay(20);
    assert.strictEqual(preferences.reader.value.dashboardWidgets[0].count, size, `${size} per page`);
    assert.strictEqual(Number(sizes().value), size);
  }
});

test('Escape closes a widget\'s gear and hands focus back to it', async () => {
  const { view, panel, lastState } = await openDashboard();
  view.click(view.find('[data-action="customize-home"]'));
  const gear = () => view.find('.home-widget[data-widget-id="tasks"] .home-widget-options');
  gear().open = true;
  view.fire('toggle', gear());
  const choice = gear().querySelector('[data-action="set-widget-count"]');
  choice.focus();
  view.keydown(choice, 'Escape');
  assert.strictEqual(gear().open, false);
  assert.strictEqual(view.document.activeElement, gear().querySelector('summary'));
  panel._deliver(lastState());
  assert.strictEqual(gear().open, false, 'and it stays closed when Home is drawn again');
});

test('Undo of a removed widget hands focus back to the widget it put back', async () => {
  const { view } = await openDashboard();
  view.click(view.find('[data-action="customize-home"]'));
  const remove = () => view.find('.home-widget[data-widget-id="agenda"] [data-action="remove-widget"]');
  remove().focus();
  view.click(remove());
  await delay(20);
  const undo = view.find('#undo-toast [data-action="undo-remove-widget"]');
  assert.strictEqual(view.document.activeElement, undo, 'focus moves to Undo');
  view.click(undo);
  await delay(20);
  assert.ok(remove(), 'the widget is back');
  assert.strictEqual(view.document.activeElement, remove(), 'focus is where the removal was made, not on the page itself');
});

test('Undo that lapses with focus on it hands focus to the widget now in the removed one\'s place', async () => {
  const { view } = await openDashboard();
  // Undo stands for 8 seconds; here it lapses at once.
  const setTimer = view.window.setTimeout;
  view.window.setTimeout = (run, ms, ...rest) => setTimer(run, ms === 8000 ? 0 : ms, ...rest);
  view.click(view.find('[data-action="customize-home"]'));
  const ids = view.findAll('.home-widget').map((widget) => widget.dataset.widgetId);
  const at = ids.indexOf('agenda');
  const remove = view.find('.home-widget[data-widget-id="agenda"] [data-action="remove-widget"]');
  remove.focus();
  view.click(remove);
  assert.strictEqual(view.document.activeElement, view.find('#undo-toast [data-action="undo-remove-widget"]'), 'focus moves to Undo');
  await delay(20);
  assert.strictEqual(view.find('#undo-toast [data-action="undo-remove-widget"]'), null, 'Undo has lapsed');
  assert.strictEqual(view.document.activeElement, view.find(`.home-widget[data-widget-id="${ids[at + 1]}"]`), 'focus is on the widget that took its place, not on the page itself');
});

test('a widget added is announced by its name alone', async () => {
  const { view } = await openDashboard();
  view.click(view.find('[data-action="customize-home"]'));
  view.change(view.find('[data-action="add-widget"]'), 'recentNotes');
  await delay(20);
  assert.strictEqual(view.find('#live-status').textContent, 'Added Recently opened to the top of Home.');
});

test('a widget Related Notes adds while the Tags tab shows is added on Home, in view', async () => {
  const { view, panel, preferences } = await openDashboard(createIndex(), (store) =>
    store.homeWidgets.setDashboardMode('browse'),
  );
  panel._deliver({ type: 'addWidget', value: 'stats' });
  await delay(20);
  assert.strictEqual(view.find('#home-panel').hidden, false, 'Home is shown');
  assert.ok(view.find('.home-edit-bar'), 'being customized');
  assert.strictEqual(preferences.reader.value.dashboardViewState.mode, 'home');
  const added = view.find('.home-widget[data-widget-id^="stats-"]');
  assert.ok(added, 'with the new widget drawn');
  assert.strictEqual(view.document.activeElement, added, 'and focused');
});

test('Home\'s search box opens a search page, and its links lead on', async () => {
  const { view, navigation, preferences } = await openDashboard();
  const bar = view.find('.home-widget[data-widget-id="search"] [data-action="query-input"]');
  assert.ok(bar, 'the search widget is the shared search box');

  view.type(bar, '#project/atlas is:open');
  view.keydown(bar, 'Enter');
  await delay(20);
  assert.deepStrictEqual(navigation.opened, ['search #project/atlas is:open']);
  assert.deepStrictEqual(preferences.reader.value.recentQueries, ['#project/atlas is:open']);
  assert.strictEqual(
    view.find('.home-widget[data-widget-id="search"] [data-action="query-input"]').value,
    '',
    'the box is empty again once the page opens',
  );

  view.click(view.find('.home-widget[data-widget-id="tasks"] [data-action="open-task-board"]'));
  view.click(view.find('.home-widget[data-widget-id="favoriteTags"] [data-action="set-dashboard-mode"]'));
  assert.deepStrictEqual(navigation.opened.slice(1), ['board is:open']);
  assert.strictEqual(view.find('h1').textContent, 'Dashboard: Tags', 'All tags goes to the Tags tab');
});

test('a saved search offers to show its results on Home, once', async () => {
  const { view, preferences } = await openDashboard(createIndex(), async (store) => {
    await store.savedSearches.saveSavedQueryFilter('Open work', 'is:open');
  });
  const savedId = preferences.reader.value.savedFilters[0].id;
  const show = () => view.find(`[data-action="add-saved-search-widget"][data-saved-filter-id="${savedId}"]`);
  assert.ok(show(), 'its row offers Show results');
  assert.strictEqual(show().getAttribute('aria-label'), 'Show the results of Open work on Home');
  view.click(show());
  await delay(20);
  const widgets = preferences.reader.value.dashboardWidgets.filter((widget) => widget.kind === 'savedQuery');
  assert.deepStrictEqual(widgets.map((widget) => [widget.filterId, widget.width, widget.count]), [[savedId, 'half', 5]]);
  assert.strictEqual(show(), null, 'and no longer offers it');
});

test('customizing Home removes, resizes, adds, reorders, and resets widgets', async () => {
  const { view, preferences, lastState } = await openDashboard(createIndex(), async (store) => {
    await store.savedSearches.saveSavedQueryFilter('Open work', 'is:open');
  });
  const ids = () => view.findAll('.home-widget').map((widget) => widget.dataset.widgetId);
  const widget = (id) => view.find(`.home-widget[data-widget-id="${id}"]`);
  assert.strictEqual(view.find('[data-action="remove-widget"]'), null, 'nothing to edit until asked');

  view.click(view.find('[data-action="customize-home"]'));
  assert.ok(view.find('.home-edit-bar'), 'Home says it is being customized');
  assert.ok(widget('agenda').classList.contains('is-editing'));
  assert.strictEqual(view.state.editingHome, true, 'and remembers it');

  view.click(widget('agenda').querySelector('[data-action="remove-widget"]'));
  await delay(20);
  // Try next is drawn while Home is arranged, though it has nothing to suggest.
  assert.deepStrictEqual(ids(), ['tryNext', 'search', 'tasks', 'favoriteTags', 'savedSearches']);
  assert.ok(view.find('.home-edit-bar'), 'a change keeps Home in customizing');
  assert.strictEqual(lastState().data.homeArranged, true, 'and the host knows Home has been arranged');

  view.click(widget('tasks').querySelector('[data-action="set-widget-width"][data-value="full"]'));
  await delay(20);
  assert.ok(widget('tasks').classList.contains('is-full'));
  const tasksConfig = () => preferences.reader.value.dashboardWidgets.find((entry) => entry.id === 'tasks');
  assert.strictEqual(tasksConfig().width, 'full');

  view.click(widget('tasks').querySelector('[data-action="set-widget-count"][data-value="10"]'));
  await delay(20);
  assert.strictEqual(tasksConfig().count, 10);

  const add = view.find('[data-action="add-widget"]');
  const offered = [...add.children].map((option) => option.getAttribute('value'));
  assert.ok(offered.includes('agenda'), 'a removed widget can be added again');
  assert.ok(!offered.includes('search'), 'a widget Home holds once is not offered twice');
  assert.ok(offered.includes('tasks'), 'a tasks widget can be added again');
  const savedId = preferences.reader.value.savedFilters[0].id;
  assert.ok(offered.includes(`savedQuery:${savedId}`), 'each saved search is offered');
  view.change(add, `savedQuery:${savedId}`);
  await delay(20);
  // A new widget goes first, after Try next, where it is seen.
  const added = ids()[1];
  assert.match(added, /^savedQuery-/);
  assert.match(widget(added).querySelector('.home-widget-title').textContent, /Open work/, 'named after its saved search');

  // Drag the saved search's widget above the search box.
  view.fire('pointerdown', widget(added).querySelector('.home-widget-title'), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  view.document.pointerTarget = widget('search');
  view.fire('pointermove', widget(added), { pointerId: 1, clientX: 10, clientY: 5 });
  view.fire('pointerup', widget(added), { pointerId: 1, clientX: 10, clientY: 5 });
  await delay(20);
  assert.deepStrictEqual(ids(), ['tryNext', added, 'search', 'tasks', 'favoriteTags', 'savedSearches']);

  view.fire('contextmenu', widget('search'));
  assert.deepStrictEqual(
    view.findAll('#rank-context-menu button').map((button) => button.textContent),
    ['Move up', 'Move down', 'Move to first', 'Move to last'],
  );
  view.click(view.find('#rank-context-menu [data-context-action="bottom"]'));
  await delay(20);
  assert.strictEqual(ids()[ids().length - 1], 'search');

  // Reset discards an arrangement, so it asks first, in a modal.
  const warn = vscode.window.showWarningMessage;
  const asked = [];
  vscode.window.showWarningMessage = async (text, options) => { asked.push([text, options && options.modal]); return undefined; };
  view.click(view.find('[data-action="reset-widgets"]'));
  await delay(20);
  assert.deepStrictEqual(asked, [['Reset Home to its default widgets?', true]]);
  assert.deepStrictEqual(ids(), ['tryNext', added, 'tasks', 'favoriteTags', 'savedSearches', 'search'], 'nothing changes unless it is confirmed');
  vscode.window.showWarningMessage = async () => 'Reset Widgets';
  view.click(view.find('[data-action="reset-widgets"]'));
  await delay(20);
  vscode.window.showWarningMessage = warn;
  assert.deepStrictEqual(ids(), ['tryNext', 'search', 'agenda', 'recentNotes', 'favoriteTags', 'savedSearches']);

  view.click(view.find('.home-edit-bar [data-action="finish-customizing"]'));
  assert.strictEqual(view.find('.home-edit-bar'), null);
  assert.strictEqual(view.find('[data-action="remove-widget"]'), null);
});

test('a widget\'s gear is a control, not a handle to drag the widget by', async () => {
  const { view } = await openDashboard();
  view.click(view.find('[data-action="customize-home"]'));
  const gear = view.find('.home-widget[data-widget-id="tasks"] .home-widget-options summary');
  assert.ok(gear, 'the tasks widget has its own gear');

  // Pressing the gear and moving must not start a drag, which would capture
  // the pointer and keep the gear from opening.
  view.fire('pointerdown', gear, { button: 0, pointerId: 7, clientX: 10, clientY: 10 });
  view.document.pointerTarget = view.find('.home-widget[data-widget-id="search"]');
  view.fire('pointermove', gear, { pointerId: 7, clientX: 10, clientY: 60 });
  view.fire('pointerup', gear, { pointerId: 7, clientX: 10, clientY: 60 });
  assert.deepStrictEqual(
    view.posted.filter((message) => message.type === 'setDashboardWidgets'),
    [],
  );
  assert.strictEqual(view.find('.drag-ghost'), null);

  // Opened, the gear stays open when the host redraws the page.
  const options = view.find('.home-widget[data-widget-id="tasks"] .home-widget-options');
  options.open = true;
  view.fire('toggle', options);
  view.click(view.find('.home-widget[data-widget-id="tasks"] [data-action="set-widget-count"][data-value="3"]'));
  await delay(20);
  assert.ok(
    view.find('.home-widget[data-widget-id="tasks"] .home-widget-options').open,
    'the gear is still open after the change',
  );
});

test('a snapshot that arrives mid-drag leaves one of each widget once the drop is answered', async () => {
  const { view, panel, lastState } = await openDashboard();
  view.click(view.find('[data-action="customize-home"]'));
  const ids = () => view.findAll('.home-widget').map((widget) => widget.dataset.widgetId);
  const widget = (id) => view.find(`.home-widget[data-widget-id="${id}"]`);
  const before = ids();

  view.fire('pointerdown', widget('tasks').querySelector('.home-widget-title'), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  view.document.pointerTarget = widget('search');
  view.fire('pointermove', widget('tasks'), { pointerId: 1, clientX: 10, clientY: 5 });
  // An index update redraws Home while the widget is held.
  panel._deliver(lastState());
  view.document.pointerTarget = widget('search');
  view.fire('pointerup', view.document.body, { pointerId: 1, clientX: 10, clientY: 5 });
  await delay(20);

  assert.deepStrictEqual([...ids()].sort(), [...before].sort(), 'each widget once');
  assert.strictEqual(ids().indexOf('tasks') < ids().indexOf('search'), true, 'the drop still moved it');
  assert.strictEqual(view.findAll('.drag-placeholder, .drag-ghost').length, 0);
});

test('the Tasks view widget reaches as far ahead as the Tasks view, at most 90 days', async () => {
  const day = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const note = parseMarkdown(
    'notes/plan.md',
    `# Plan\n- [ ] Near task 📅 ${day(3)}\n- [ ] Far task 📅 ${day(120)}\n`,
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  // Outside the manifest's 1 to 90, which VS Code only warns about.
  vscode._test.settings.set('deckard.agenda.upcomingDays', 365);
  try {
    const { view } = await openDashboard(buildWorkspaceIndex(new Map([[note.filePath, note]])));
    const groups = view.findAll('.home-widget[data-widget-id="agenda"] .home-widget-group').map((heading) => heading.textContent);
    // The far task is Later, past the 90 days Upcoming reaches in the Tasks view.
    assert.deepStrictEqual(groups, ['Upcoming 1', 'Later 1']);
  } finally {
    vscode._test.settings.delete('deckard.agenda.upcomingDays');
  }
});

test('the tiles say what is due today, overdue, and done this week, and each opens its search', async () => {
  const { view, navigation } = await openDashboard();
  const tiles = view.findAll('.metrics .metric-open');
  assert.deepStrictEqual(
    tiles.map((tile) => tile.querySelector('.metric-label').textContent),
    ['Due today', 'Overdue', 'Done this week'],
  );
  view.click(tiles[0]);
  await delay(20);
  assert.strictEqual(navigation.opened[navigation.opened.length - 1], 'search is:today');
});

test('Gone quiet chooses its namespace, and a project with nothing open offers a next action', async () => {
  const note = (filePath, content) => parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 1 }, {});
  const files = [
    note('notes/beacon.md', '# Beacon #project/beacon\n- [x] Shipped'),
    note('notes/ren.md', '# Call @ren-kade'),
  ];
  const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const { view, preferences } = await openDashboard(index, async (store) => {
    await store.homeWidgets.setDashboardWidgets([
      { id: 'q', kind: 'quietPeople', width: 'half', count: 5, days: 30, namespace: 'project', noOpenTasks: true },
    ]);
  });
  const action = view.find('.home-widget[data-widget-id="q"] [data-action="add-next-action"]');
  assert.ok(action, 'a stuck project offers its next action');
  view.posted.length = 0;
  view.click(action);
  assert.deepStrictEqual(view.posted.filter((message) => message.type === 'addNextAction'), [
    { type: 'addNextAction', tagKey: '#project/beacon' },
  ]);

  view.click(view.find('[data-action="customize-home"]'));
  const select = view.find('.home-widget[data-widget-id="q"] [data-action="set-widget-namespace"]');
  assert.ok(select, 'the gear chooses the namespace');
  assert.ok(view.find('.home-widget[data-widget-id="q"] [data-action="set-widget-no-open-tasks"]'));
  view.change(select, 'person');
  await delay(20);
  assert.strictEqual(preferences.reader.value.dashboardWidgets[0].namespace, undefined, 'person is the default');
});

test('a tasks widget runs the search set in its options', async () => {
  const { view, preferences } = await openDashboard();
  view.click(view.find('[data-action="customize-home"]'));
  const field = () => view.find('.home-widget[data-widget-id="tasks"] [data-action="widget-query-draft"]');
  assert.ok(field(), 'the tasks widget has a search to set');

  view.type(field(), 'text ~ audit');
  view.submit(view.find('.home-widget[data-widget-id="tasks"] [data-form="widget-query"]'));
  await delay(20);
  assert.strictEqual(
    preferences.reader.value.dashboardWidgets.find((widget) => widget.id === 'tasks').query,
    'text ~ audit',
  );
  assert.deepStrictEqual(
    view.findAll('.home-widget[data-widget-id="tasks"] .task-row').map((row) => row.dataset.taskId),
    ['audit'],
  );
});

test('the namespace filter narrows the Tags tab and keeps its choice', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha #project/atlas #project/relay #topic/leadership #follow-up\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view, panel, lastState } = await openDashboard(index);
  view.click(view.find('[data-dashboard-mode="browse"]'));
  await delay(20);
  const namespace = () => view.find('[data-action="set-tag-namespace"]');
  const shownTags = () =>
    Array.from(view.findAll('.tag-row')).map((row) => row.dataset.tagKey).sort();

  assert.deepStrictEqual(
    [...namespace().children].map((option) => option.getAttribute('value')),
    ['', 'project', 'topic', '/'],
    'each namespace in use, then None',
  );
  assert.strictEqual(shownTags().length, 4);

  view.change(namespace(), 'project');
  assert.deepStrictEqual(shownTags(), ['#project/atlas', '#project/relay']);
  assert.strictEqual(view.document.activeElement, namespace(), 'the filter keeps focus');
  assert.strictEqual(view.state.tagNamespaceFilter, 'project', 'the page keeps the choice');

  panel._deliver(lastState());
  assert.deepStrictEqual(shownTags(), ['#project/atlas', '#project/relay'], 'a host update keeps it');

  const notice = () => view.find('#browse-panel .search-notice');
  assert.ok(notice(), 'a namespace alone says it is narrowing the tags');
  assert.strictEqual(notice().querySelector('strong').textContent, '2');
  assert.match(notice().textContent, /of 4 tags, in project/i);
  assert.doesNotMatch(notice().textContent, /matching/);
  assert.ok(view.find('select[data-action="set-tag-namespace"][data-has-query]'), 'the filter is marked');
  assert.ok(view.find('#browse-tab .tab-search-mark'), 'the tab is marked');

  view.change(namespace(), '/');
  assert.deepStrictEqual(shownTags(), ['#follow-up'], 'None shows tags without a namespace');
  assert.match(notice().textContent, /of 4 tags, without a namespace/);

  view.click(view.find('[data-action="clear-tag-search"]'));
  assert.strictEqual(notice(), null);
  assert.strictEqual(view.find('#browse-tab .tab-search-mark'), null);
  assert.strictEqual(view.find('select[data-action="set-tag-namespace"][data-has-query]'), null);
  assert.strictEqual(view.state.tagNamespaceFilter, '', 'clearing lifts the filter');
  assert.strictEqual(shownTags().length, 4);
});

test('an @ tag is a person in the Tags tab, beside #person/ tags', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha @ren-kade #person/mara-vale #follow-up\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view } = await openDashboard(index);
  view.click(view.find('[data-dashboard-mode="browse"]'));
  await delay(20);
  const namespace = () => view.find('[data-action="set-tag-namespace"]');
  const shownTags = () =>
    Array.from(view.findAll('.tag-row')).map((row) => row.dataset.tagKey).sort();

  assert.deepStrictEqual(
    [...namespace().children].map((option) => option.getAttribute('value')),
    ['', 'person', '/'],
    'people under one Person namespace, not None',
  );
  const ren = view.find('.tag-row[data-tag-key="@ren-kade"]');
  assert.ok(ren, 'the @ tag is listed');
  assert.strictEqual(ren.querySelector('.entity-kind').textContent, 'person');
  assert.strictEqual(ren.querySelector('.tag-name').textContent, 'ren kade');

  view.change(namespace(), 'person');
  assert.deepStrictEqual(shownTags(), ['#person/mara-vale', '@ren-kade']);
  view.change(namespace(), '/');
  assert.deepStrictEqual(shownTags(), ['#follow-up'], 'None leaves people out');
});

test('a tag search finds a tag by the name its row shows', async () => {
  const note = parseMarkdown('notes/alpha.md', '# Alpha #follow-up #person/mara-vale #atlas\nBody text.', { createdAt: 1, updatedAt: 2 }, {});
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view } = await openDashboard(index);
  view.click(view.find('[data-dashboard-mode="browse"]'));
  await delay(20);
  const shownTags = () => view.findAll('.tag-row').map((row) => row.dataset.tagKey);
  view.type(view.find('[data-action="search-browse"]'), 'follow up');
  assert.deepStrictEqual(shownTags(), ['#follow-up']);
  view.type(view.find('[data-action="search-browse"]'), 'mara vale');
  assert.deepStrictEqual(shownTags(), ['#person/mara-vale']);
  view.type(view.find('[data-action="search-browse"]'), 'follow-up');
  assert.deepStrictEqual(shownTags(), ['#follow-up'], 'and as it is written');
});

test('nested tags in one namespace are named apart in the Tags tab', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha #project/alpha/notes #project/beta/notes #project/atlas\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view } = await openDashboard(index);
  view.click(view.find('[data-dashboard-mode="browse"]'));
  await delay(20);
  const name = (key) => view.find(`.tag-row[data-tag-key="${key}"] .tag-name`).textContent;
  assert.strictEqual(name('#project/alpha/notes'), 'alpha/notes');
  assert.strictEqual(name('#project/beta/notes'), 'beta/notes');
  assert.strictEqual(name('#project/atlas'), 'atlas');
  assert.strictEqual(
    view.find('.tag-row[data-tag-key="#project/beta/notes"] [data-action="favorite-tag"]').getAttribute('aria-label'),
    'Favorite beta/notes project',
  );
});

test('a tag search kept from an earlier visit says so above the tags', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha #project/atlas #project/relay #topic/leadership #follow-up\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view } = await openDashboard(index, async (preferences) => {
    await preferences.homeWidgets.setDashboardSearch('tags', 'proj');
    await preferences.homeWidgets.setDashboardMode('browse');
  });

  const notice = view.find('#browse-panel .search-notice');
  assert.ok(notice, 'the tags say a search is narrowing them');
  assert.strictEqual(notice.querySelector('strong').textContent, '2');
  assert.match(notice.textContent, /of 4 tags matching “proj”/);
  assert.ok(view.find('#browse-tab .tab-search-mark'), 'the tab is marked');

  view.change(view.find('[data-action="set-tag-namespace"]'), 'topic');
  const both = view.find('#browse-panel .search-notice');
  assert.strictEqual(both.querySelector('strong').textContent, '0');
  assert.match(both.textContent, /of 4 tags, in topic matching “proj”/i);

  view.click(view.find('[data-action="clear-tag-search"]'));

  assert.strictEqual(view.find('.search-notice'), null);
  assert.strictEqual(view.state.tagNamespaceFilter, '', 'the namespace clears with the search');
  assert.strictEqual(view.findAll('.tag-row').length, 4);
});

test('ranked tags move by drag or from their menu, which also renames', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha #alpha #beta #gamma\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view } = await openDashboard(index, async (preferences) => {
    await preferences.homeWidgets.setDashboardMode('browse');
    await preferences.display.setTagSortMode('custom');
  });
  const row = (key) => view.find(`.tag-row[data-tag-key="${key}"]`);
  const sent = (type) => view.posted.filter((message) => message.type === type);
  const order = () => view.findAll('.tag-row').map((tag) => tag.dataset.tagKey);
  assert.deepStrictEqual(order(), ['#alpha', '#beta', '#gamma']);
  assert.ok(row('#alpha').classList.contains('is-draggable'));

  view.fire('pointerdown', row('#alpha').children[0], { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  view.document.pointerTarget = row('#gamma');
  view.fire('pointermove', row('#alpha'), { pointerId: 1, clientX: 10, clientY: 40 });
  view.fire('pointerup', row('#alpha'), { pointerId: 1, clientX: 10, clientY: 40 });
  view.click(row('#alpha'));
  assert.deepStrictEqual(sent('reorderTags').map((message) => message.tagKeys), [['#beta', '#gamma', '#alpha']]);
  assert.strictEqual(sent('openTag').length, 0, 'the click a drag ends with opens nothing');
  await delay(20);

  view.fire('contextmenu', row('#beta'));
  assert.deepStrictEqual(
    view.findAll('#rank-context-menu button').map((button) => button.textContent),
    ['Rename tag', 'Park tag', 'Move up', 'Move down', 'Move to top', 'Move to bottom'],
  );
  view.click(view.find('#rank-context-menu [data-context-action="bottom"]'));
  assert.deepStrictEqual(sent('reorderTags')[1].tagKeys.slice(-1), ['#beta']);

  view.fire('contextmenu', row('#gamma'));
  view.click(view.find('#rank-context-menu [data-context-action="rename-tag"]'));
  assert.deepStrictEqual(sent('renameTag'), [{ type: 'renameTag', tagKey: '#gamma' }]);

  view.fire('contextmenu', row('#gamma'));
  view.click(view.find('#rank-context-menu [data-context-action="park-tag"]'));
  assert.deepStrictEqual(sent('parkTag'), [{ type: 'parkTag', tagKey: '#gamma' }]);
});

test('Alt+Up and Alt+Down move a tag within favorites or the rest, never across', async () => {
  const note = parseMarkdown('notes/alpha.md', '# Alpha #alpha #beta #gamma\nBody text.', { createdAt: 1, updatedAt: 2 }, {});
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view } = await openDashboard(index, async (preferences) => {
    await preferences.homeWidgets.setDashboardMode('browse');
    await preferences.display.setTagSortMode('custom');
    await preferences.favorites.toggleFavorite('#alpha');
  });
  const row = (key) => view.find(`.tag-row[data-tag-key="${key}"]`);
  const sent = () => view.posted.filter((message) => message.type === 'reorderTags');
  const status = () => view.find('#live-status').textContent;

  // #beta is the first of the rest, right under the favorite #alpha.
  view.fire('keydown', row('#beta'), { key: 'ArrowUp', altKey: true });
  assert.deepStrictEqual(sent(), [], 'the first of the rest stays first of the rest');
  assert.notStrictEqual(status(), 'Moved up.');

  view.fire('keydown', row('#alpha'), { key: 'ArrowDown', altKey: true });
  assert.deepStrictEqual(sent(), [], 'the last favorite stays a favorite');

  view.fire('keydown', row('#beta'), { key: 'ArrowDown', altKey: true });
  assert.deepStrictEqual(sent().map((message) => [message.tagKeys, message.isFavorite]), [[['#alpha', '#gamma', '#beta'], false]]);
  assert.strictEqual(status(), 'Moved down.');
});

test('typing a tag search keeps focus and text through a host update', async () => {
  const { view, panel, lastState, stored } = await openDashboard();
  view.click(view.find('[data-dashboard-mode="browse"]'));
  const search = () => view.find('[data-action="search-browse"]');

  view.type(search(), 'pro');
  panel._deliver(lastState());
  assert.strictEqual(search().value, 'pro');
  assert.strictEqual(view.document.activeElement, search());

  await delay(SETTLE_MS);
  assert.deepStrictEqual(stored('tags'), ['pro']);
  assert.strictEqual(view.document.activeElement, search());
});

// ---------------------------------------------------------------------------

test('the new widgets act on notes, tags, and today\'s note', async () => {
  vscode.window.activeTextEditor = {
    document: { uri: vscode.Uri.file('notes/current.md'), languageId: 'markdown' },
    selection: { active: { line: 0 } },
  };
  try {
    const { view, navigation, preferences } = await openDashboard(
      createNotesIndex(),
      async (store) => {
        await store.homeWidgets.setDashboardWidgets([
          { id: 'today', kind: 'todayNote', width: 'half' },
          { id: 'add', kind: 'quickAdd', width: 'full' },
          { id: 'related', kind: 'relatedNotes', width: 'half' },
          { id: 'pairs', kind: 'tagPairs', width: 'half' },
          { id: 'hubs', kind: 'unhubbedTags', width: 'half' },
          { id: 'pins', kind: 'pinnedNotes', width: 'half' },
          { id: 'stale', kind: 'staleTasks', width: 'half' },
        ]);
        // Pinning happens where the note is, so Home is opened with one.
        await store.pins.pinNote({ filePath: 'notes/current.md' });
      },
      {
        indexerExtras: {
          isNotesFile: () => true,
          getFilePath: (uri) => uri.fsPath.replace(/^\//, ''),
        },
      },
    );
    const widget = (id) => view.find(`.home-widget[data-widget-id="${id}"]`);

    // Today's note does not exist yet, so the widget offers to create it.
    view.click(widget('today').querySelector('[data-action="open-daily-note"]'));
    await delay(20);
    assert.deepStrictEqual(navigation.opened, ['today']);

    // Quick add sends the task, clears the field, and says what happened.
    const field = () => widget('add').querySelector('[data-action="quick-add-draft"]');
    view.type(field(), 'Call Ren #risk/vendor');
    view.submit(widget('add').querySelector('form'));
    await delay(20);
    assert.strictEqual(navigation.opened[1], 'add Call Ren #risk/vendor');
    assert.strictEqual(field().value, '');
    assert.match(widget('add').querySelector('.home-quick-add-status').textContent, /Added/);
    view.type(field(), 'refused task');
    view.submit(widget('add').querySelector('form'));
    await delay(20);
    assert.strictEqual(field().value, 'refused task', 'a task not added is given back');

    // Related notes follow the note in the editor.
    assert.match(widget('related').querySelector('.home-widget-source').textContent, /Current work/);
    const related = [...widget('related').querySelectorAll('[data-action="open-source"]')];
    assert.deepStrictEqual(
      related.map((row) => row.dataset.filePath).sort(),
      ['notes/atlas.md', 'notes/contract.md', 'notes/vendor.md'],
    );

    // A pair of tags opens a search for both.
    view.click(widget('pairs').querySelector('[data-action="open-search"]'));
    await delay(20);
    assert.strictEqual(navigation.opened[3], 'search #project/atlas AND #risk/vendor');

    // Vendor is used three times and has no hub.
    const createHub = widget('hubs').querySelector('[data-action="create-tag-hub"]');
    assert.strictEqual(createHub.dataset.tagKey, '#risk/vendor');
    view.click(createHub);
    await delay(20);
    assert.strictEqual(navigation.opened[4], 'hub #risk/vendor');

    // Home lists what was pinned elsewhere, opens it where the pin was put,
    // and lets go of it.
    assert.strictEqual(
      widget('pins').querySelector('[data-action="pin-note"]'),
      null,
      'Home does not pin: it lists the pins',
    );
    const pin = widget('pins').querySelector('[data-action="open-source"]');
    assert.strictEqual(pin.dataset.filePath, 'notes/current.md');
    view.click(widget('pins').querySelector('[data-action="unpin-note"]'));
    await delay(20);
    assert.deepStrictEqual(preferences.reader.value.pinnedNotes, []);

    // A look-back widget chooses its days in its options.
    view.click(view.find('[data-action="customize-home"]'));
    view.click(widget('stale').querySelector('[data-action="set-widget-days"][data-value="7"]'));
    await delay(20);
    assert.strictEqual(
      preferences.reader.value.dashboardWidgets.find((entry) => entry.id === 'stale').days,
      7,
    );
  } finally {
    vscode.window.activeTextEditor = undefined;
  }
});

test('a full Home offers no widget to add, and says why, rather than drop its last', async () => {
  const widgets = Array.from({ length: 30 }, (_, at) => ({ id: `tasks${at}`, kind: 'tasks', width: 'half', count: 3, query: 'is:open' }));
  const { view, panel, preferences } = await openDashboard(createIndex(), async (store) => {
    await store.homeWidgets.setDashboardWidgets(widgets);
  });
  const choices = view.posted.filter((message) => message.type === 'widgetChoices');
  assert.deepStrictEqual(choices[choices.length - 1].choices, [], 'Related Notes is offered nothing to add');

  view.click(view.find('[data-action="customize-home"]'));
  assert.strictEqual(view.find('[data-action="add-widget"]').disabled, true);
  assert.match(view.find('.home-edit-bar').textContent, /Home is full: it holds 30 widgets at most\. Remove one to add another\./);

  // Related Notes may still ask, from a list it was sent before.
  panel._deliver({ type: 'addWidget', value: 'stats' });
  await delay(20);
  assert.deepStrictEqual(view.posted.filter((message) => message.type === 'setDashboardWidgets'), []);
  assert.strictEqual(view.find('#live-status').textContent, 'Home is full: it holds 30 widgets at most. Remove one to add another.');
  assert.strictEqual(preferences.reader.value.dashboardWidgets.length, 30);
  assert.ok(view.find('.home-widget[data-widget-id="tasks29"]'), 'the last widget is still there');
});

test('Quick add takes no longer a task than the host adds', async () => {
  const { view, navigation } = await openDashboard(createIndex(), async (store) => {
    await store.homeWidgets.setDashboardWidgets([{ id: 'add', kind: 'quickAdd', width: 'full' }]);
  });
  const field = () => view.find('[data-action="quick-add-draft"]');
  assert.ok(field().maxLength > 0, 'the field says how long a task may be');
  const longest = 'x'.repeat(field().maxLength);
  view.type(field(), longest);
  view.submit(view.find('form[data-form="quick-add"]'));
  await delay(20);
  assert.deepStrictEqual(navigation.opened, [`add ${longest}`], 'the longest task the field takes is added');
  assert.match(view.find('.home-quick-add-status').textContent, /Added/);
});

test('the gear turns zen on through the host, and the page carries the marker', async () => {
  const { view, panel } = await openDashboard();
  try {
    // Off to begin with: the sheet ships either way, the marker does not.
    // The sheet is in tail.css, which every page links; the loader inlines it.
    assert.ok(loadPage(panel.webview.html).includes('body.zen {'), 'the zen sheet ships');
    assert.ok(!panel.webview.html.includes('<body class="zen">'), 'zen starts off');

    view.click(view.find('[data-action="set-zen-mode"][data-value="on"]'));
    await delay(20);

    // The page posts intent; the host is what writes the setting, globally,
    // so every Deckard surface follows it rather than this page alone.
    assert.deepStrictEqual(
      vscode._test.configurationUpdates.filter((update) => update.name === 'deckard.zenMode'),
      [{ name: 'deckard.zenMode', value: true, target: vscode.ConfigurationTarget.Global }],
    );
    // And the context key follows it, so the palette offers the other command.
    assert.deepStrictEqual(
      vscode._test.executedCommands.filter((entry) => entry.args[0] === 'deckard.zenMode'),
      [{ command: 'setContext', args: ['deckard.zenMode', true] }],
    );

    // A page drawn while the setting is on carries the marker the sheet needs.
    const { panel: second, view: secondView } = await openDashboard();
    assert.ok(second.webview.html.includes('<body class="zen">'), 'zen marks the body');

    // Nothing was taken off the page to achieve it.
    assert.ok(secondView.find('.eyebrow'), 'the eyebrow is still drawn');
  } finally {
    vscode._test.settings.delete('deckard.zenMode');
    vscode._test.configurationUpdates.length = 0;
    vscode._test.executedCommands.length = 0;
  }
});

