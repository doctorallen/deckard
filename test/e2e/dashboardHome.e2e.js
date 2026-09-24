// End-to-end: the Dashboard's Home and Tags tabs against the real host and
// script.
//
// Home's widgets are arranged on the page and kept by the host, which answers
// each change with the whole state. Storing a tag search does the same, so
// these also check that typing survives that round trip.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview } = require('./webviewRuntime.js');
const { DashboardPanel } = require('../../out/ui/webview/dashboard.js');
const { PreferencesStore } = require('../../out/core/storage/preferences.js');
const { parseMarkdown } = require('../../out/core/markdown/parser.js');
const { buildWorkspaceIndex } = require('../../out/core/workspace/indexer.js');

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

function createGlobalState() {
  const store = new Map();
  return {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    update: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens the Dashboard and mounts its webview, wired to the real host.
 * `prepare` sets preferences first, as an earlier visit would have.
 */
async function openDashboard(
  index = createIndex(),
  prepare = async () => undefined,
  indexerExtras = {},
) {
  vscode._test.createdPanels.length = 0;
  const updates = new vscode.EventEmitter();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: updates.event,
    ...indexerExtras,
  };
  const preferences = new PreferencesStore(createGlobalState());
  await prepare(preferences);
  const navigation = createNavigation();
  const dashboard = new DashboardPanel(
    indexer,
    preferences,
    { fsPath: '/ext' },
    navigation,
  );
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

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

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
    const dashboard = new DashboardPanel(
      { ready: Promise.resolve(), getSnapshot: () => index, onDidUpdate: updates.event },
      new PreferencesStore(globalState),
      { fsPath: '/ext' },
      createNavigation(),
    );
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
      ['search', 'tasks', 'agenda', 'favoriteTags', 'savedSearches'],
    );
    const labels = view.findAll('.view-options-group').map((group) => group.children[0].textContent);
    assert.deepStrictEqual(labels, ['Home', 'Tag columns', 'Zen']);
  }
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
    preferences.setDashboardMode('browse'),
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

test('Home\'s search box opens a search page, and its links lead on', async () => {
  const { view, navigation, preferences } = await openDashboard();
  const bar = view.find('.home-widget[data-widget-id="search"] [data-action="query-input"]');
  assert.ok(bar, 'the search widget is the shared search box');

  view.type(bar, '#project/atlas is:open');
  view.keydown(bar, 'Enter');
  await delay(20);
  assert.deepStrictEqual(navigation.opened, ['search #project/atlas is:open']);
  assert.deepStrictEqual(preferences.value.recentQueries, ['#project/atlas is:open']);
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

test('customizing Home removes, resizes, adds, reorders, and resets widgets', async () => {
  const { view, preferences, lastState } = await openDashboard(createIndex(), async (store) => {
    await store.saveSavedQueryFilter('Open work', 'is:open');
  });
  const ids = () => view.findAll('.home-widget').map((widget) => widget.dataset.widgetId);
  const widget = (id) => view.find(`.home-widget[data-widget-id="${id}"]`);
  assert.strictEqual(view.find('[data-action="remove-widget"]'), null, 'nothing to edit until asked');

  assert.ok(view.find('.home-hint-bar'), 'a Home never arranged says it can be');
  view.click(view.find('[data-action="customize-home"]'));
  assert.ok(view.find('.home-edit-bar'), 'Home says it is being customized');
  assert.ok(widget('agenda').classList.contains('is-editing'));
  assert.strictEqual(view.state.editingHome, true, 'and remembers it');

  view.click(widget('agenda').querySelector('[data-action="remove-widget"]'));
  await delay(20);
  assert.deepStrictEqual(ids(), ['search', 'tasks', 'favoriteTags', 'savedSearches']);
  assert.ok(view.find('.home-edit-bar'), 'a change keeps Home in customizing');
  assert.strictEqual(lastState().data.homeArranged, true, 'and the host knows Home has been arranged');

  view.click(widget('tasks').querySelector('[data-action="set-widget-width"][data-value="full"]'));
  await delay(20);
  assert.ok(widget('tasks').classList.contains('is-full'));
  assert.strictEqual(preferences.value.dashboardWidgets[1].width, 'full');

  view.click(widget('tasks').querySelector('[data-action="set-widget-count"][data-value="10"]'));
  await delay(20);
  assert.strictEqual(preferences.value.dashboardWidgets[1].count, 10);

  const add = view.find('[data-action="add-widget"]');
  const offered = add.children.map((option) => option.getAttribute('value'));
  assert.ok(offered.includes('agenda'), 'a removed widget can be added again');
  assert.ok(!offered.includes('search'), 'a widget Home holds once is not offered twice');
  assert.ok(offered.includes('tasks'), 'a tasks widget can be added again');
  const savedId = preferences.value.savedFilters[0].id;
  assert.ok(offered.includes(`savedQuery:${savedId}`), 'each saved search is offered');
  view.change(add, `savedQuery:${savedId}`);
  await delay(20);
  const added = ids()[ids().length - 1];
  assert.match(added, /^savedQuery-/);
  assert.match(widget(added).querySelector('.home-widget-title').textContent, /Open work/, 'named after its saved search');

  // Drag the saved search's widget above the search box.
  view.fire('pointerdown', widget(added).querySelector('.home-widget-title'), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  view.document.pointerTarget = widget('search');
  view.fire('pointermove', widget(added), { pointerId: 1, clientX: 10, clientY: 5 });
  view.fire('pointerup', widget(added), { pointerId: 1, clientX: 10, clientY: 5 });
  await delay(20);
  assert.deepStrictEqual(ids(), [added, 'search', 'tasks', 'favoriteTags', 'savedSearches']);

  view.fire('contextmenu', widget('search'));
  assert.deepStrictEqual(
    view.findAll('#rank-context-menu button').map((button) => button.textContent),
    ['Move to first', 'Move to last'],
  );
  view.click(view.find('#rank-context-menu [data-context-action="bottom"]'));
  await delay(20);
  assert.strictEqual(ids()[ids().length - 1], 'search');

  // Reset discards an arrangement, so it asks before it does.
  view.click(view.find('[data-action="reset-widgets"]'));
  await delay(20);
  assert.deepStrictEqual(ids(), [added, 'tasks', 'favoriteTags', 'savedSearches', 'search'], 'nothing changes until it is confirmed');
  view.click(view.find('[data-action="cancel-reset-widgets"]'));
  await delay(20);
  assert.ok(view.find('[data-action="reset-widgets"]'), 'Reset is offered again');

  view.click(view.find('[data-action="reset-widgets"]'));
  view.click(view.find('[data-action="confirm-reset-widgets"]'));
  await delay(20);
  assert.deepStrictEqual(ids(), ['search', 'tasks', 'agenda', 'favoriteTags', 'savedSearches']);

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

test('a tasks widget runs the search set in its options', async () => {
  const { view, preferences } = await openDashboard();
  view.click(view.find('[data-action="customize-home"]'));
  const field = () => view.find('.home-widget[data-widget-id="tasks"] [data-action="widget-query-draft"]');
  assert.ok(field(), 'the tasks widget has a search to set');

  view.type(field(), 'text ~ audit');
  view.submit(view.find('.home-widget[data-widget-id="tasks"] [data-form="widget-query"]'));
  await delay(20);
  assert.strictEqual(preferences.value.dashboardWidgets[1].query, 'text ~ audit');
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
    namespace().children.map((option) => option.getAttribute('value')),
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
    namespace().children.map((option) => option.getAttribute('value')),
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

test('a tag search kept from an earlier visit says so above the tags', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha #project/atlas #project/relay #topic/leadership #follow-up\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view } = await openDashboard(index, async (preferences) => {
    await preferences.setDashboardSearch('tags', 'proj');
    await preferences.setDashboardMode('browse');
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
    await preferences.setDashboardMode('browse');
    await preferences.setTagSortMode('custom');
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
    ['Rename tag', 'Move to top', 'Move to bottom'],
  );
  view.click(view.find('#rank-context-menu [data-context-action="bottom"]'));
  assert.deepStrictEqual(sent('reorderTags')[1].tagKeys.slice(-1), ['#beta']);

  view.fire('contextmenu', row('#gamma'));
  view.click(view.find('#rank-context-menu [data-context-action="rename-tag"]'));
  assert.deepStrictEqual(sent('renameTag'), [{ type: 'renameTag', tagKey: '#gamma' }]);
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
        await store.setDashboardWidgets([
          { id: 'today', kind: 'todayNote', width: 'half' },
          { id: 'add', kind: 'quickAdd', width: 'full' },
          { id: 'related', kind: 'relatedNotes', width: 'half' },
          { id: 'pairs', kind: 'tagPairs', width: 'half' },
          { id: 'hubs', kind: 'unhubbedTags', width: 'half' },
          { id: 'pins', kind: 'pinnedNotes', width: 'half' },
          { id: 'stale', kind: 'staleTasks', width: 'half' },
        ]);
        // Pinning happens where the note is, so Home is opened with one.
        await store.pinNote({ filePath: 'notes/current.md' });
      },
      {
        isNotesFile: () => true,
        getFilePath: (uri) => uri.fsPath.replace(/^\//, ''),
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
    const related = widget('related').querySelectorAll('[data-action="open-source"]');
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
    assert.deepStrictEqual(preferences.value.pinnedNotes, []);

    // A look-back widget chooses its days in its options.
    view.click(view.find('[data-action="customize-home"]'));
    view.click(widget('stale').querySelector('[data-action="set-widget-days"][data-value="7"]'));
    await delay(20);
    assert.strictEqual(
      preferences.value.dashboardWidgets.find((entry) => entry.id === 'stale').days,
      7,
    );
  } finally {
    vscode.window.activeTextEditor = undefined;
  }
});

test('the gear turns zen on through the host, and the page carries the marker', async () => {
  const { view, panel } = await openDashboard();
  try {
    // Off to begin with: the sheet ships either way, the marker does not.
    assert.ok(panel.webview.html.includes('body.zen {'), 'the zen sheet ships');
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
    const { panel: second } = await openDashboard();
    assert.ok(second.webview.html.includes('<body class="zen">'), 'zen marks the body');

    // Nothing was taken off the page to achieve it.
    assert.ok(second.webview.html.includes('class="eyebrow"'), 'the eyebrow is still drawn');
  } finally {
    vscode._test.settings.delete('deckard.zenMode');
    vscode._test.configurationUpdates.length = 0;
    vscode._test.executedCommands.length = 0;
  }
});

(async () => {
  let pass = 0;
  const failures = [];
  for (const entry of tests) {
    try {
      await entry.fn();
      pass += 1;
      console.log('  ok   ' + entry.name);
    } catch (error) {
      failures.push(entry.name + '\n       ' + String(error.message).split('\n')[0]);
      console.log('  FAIL ' + entry.name);
    }
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(failures.length ? 1 : 0);
})();
