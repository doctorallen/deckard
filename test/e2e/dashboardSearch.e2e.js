// End-to-end: the Dashboard's searches against the real host and script.
//
// Storing a search makes the host send the whole state back. These check that
// typing survives that round trip: the field keeps its focus and its newest
// text, and the query is stored once typing settles rather than per keystroke.
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
  taskLayout = 'list',
  index = createIndex(),
  prepare = async () => undefined,
) {
  vscode._test.createdPanels.length = 0;
  const updates = new vscode.EventEmitter();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: updates.event,
  };
  const preferences = new PreferencesStore(createGlobalState());
  await preferences.setDashboardTaskLayout(taskLayout);
  await prepare(preferences);
  const dashboard = new DashboardPanel(
    indexer,
    preferences,
    { fsPath: '/ext' },
    () => undefined,
    () => undefined,
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
  return { view, panel, updates, lastState, stored };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

for (const [layout, cardSelector] of [['list', '.task-row'], ['board', '.board-card']]) {
  test(`${layout} layout: typing a task search keeps focus and text through a host update`, async () => {
    const { view, panel, lastState, stored } = await openDashboard(layout);
    const search = () => view.find('[data-action="search-tasks"]');

    view.type(search(), 'a');
    view.type(search(), 'au');
    view.type(search(), 'aud');
    assert.deepStrictEqual(stored('tasks'), [], 'nothing is stored while typing');

    // A host update arrives mid-word, still carrying the older stored query.
    panel._deliver(lastState());
    assert.strictEqual(search().value, 'aud', 'the newer typing must survive');
    assert.strictEqual(view.document.activeElement, search(), 'the field must keep focus');
    assert.strictEqual(view.findAll(cardSelector).length, 1, 'the page filters at once');

    await delay(SETTLE_MS);
    assert.deepStrictEqual(stored('tasks'), ['aud'], 'the query is stored once typing settles');
    // The host's own echo of the stored query keeps the field as well.
    assert.strictEqual(search().value, 'aud');
    assert.strictEqual(view.document.activeElement, search());
  });
}

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

test('only the Search tab is sent notes, without HTML in the Markdown view', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha #work\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view, lastState } = await openDashboard('list', index);
  assert.strictEqual(lastState().data.notesOmitted, true, 'the Tasks tab is sent no notes');
  assert.deepStrictEqual(lastState().data.notes, []);

  view.click(view.find('[data-dashboard-mode="notes"]'));
  await delay(20);
  const state = lastState().data;
  assert.strictEqual(state.notesOmitted, undefined, 'the Search tab asks for them');
  assert.strictEqual(state.notes.length, 1);
  assert.strictEqual(state.notes[0].renderedHtml, '', 'the Markdown view is sent no HTML');
  assert.strictEqual(view.findAll('.note-row').length, 1, 'the card is drawn');
});

test('the namespace filter narrows the Tags tab and keeps its choice', async () => {
  const note = parseMarkdown(
    'notes/alpha.md',
    '# Alpha #project/atlas #project/relay #topic/leadership #follow-up\nBody text.',
    { createdAt: 1, updatedAt: 2 },
    {},
  );
  const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
  const { view, panel, lastState } = await openDashboard('list', index);
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
  const { view } = await openDashboard('list', index);
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

test('a kept Search tab search marks its tab from another tab', async () => {
  const { view } = await openDashboard('list', createIndex(), (preferences) =>
    preferences.setDashboardSearch('notes', 'vault'),
  );

  // The Tasks tab is open, so the host sends no notes; the mark still shows.
  const mark = view.find('#notes-tab .tab-search-mark');
  assert.ok(mark, 'the Search tab keeps its mark while another tab is open');
  assert.match(mark.getAttribute('title') || '', /vault/);
});

test('a task search kept from an earlier visit says so above the list', async () => {
  const { view } = await openDashboard('list', createIndex(), (preferences) =>
    preferences.setDashboardSearch('tasks', 'review'),
  );

  const notice = view.find('#tasks-panel .search-notice');
  assert.ok(notice, 'the list says a search is narrowing it');
  assert.strictEqual(notice.querySelector('strong').textContent, '1');
  assert.match(notice.textContent, /of 3 open tasks matching “review”/);
  assert.ok(view.find('input[data-action="search-tasks"][data-has-query]'), 'the box is marked');
  assert.ok(view.find('#tasks-tab .tab-search-mark'), 'the tab is marked');
  assert.strictEqual(view.findAll('.task-row').length, 1);

  view.click(view.find('[data-action="clear-task-search"]'));

  assert.strictEqual(view.find('.search-notice'), null);
  assert.strictEqual(view.find('#tasks-tab .tab-search-mark'), null);
  assert.strictEqual(view.find('input[data-action="search-tasks"]').value, '');
  assert.strictEqual(view.findAll('.task-row').length, 3);
  assert.strictEqual(
    view.document.activeElement,
    view.find('input[data-action="search-tasks"]'),
    'the box keeps focus for a new search',
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
  const { view } = await openDashboard('list', index, async (preferences) => {
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
