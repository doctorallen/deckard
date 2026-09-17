// End-to-end: the real panel host, the real webview script, real messages.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview } = require('./webviewRuntime.js');
const { TagOverviewPanels } = require('../../out/ui/webview/tagOverview.js');
const { PreferencesStore } = require('../../out/core/storage/preferences.js');
const { SidebarNotesView } = require('../../out/ui/webview/sidebarNotes.js');

function createIndex() {
  const section = (id, filePath, heading, tags, rawContent) => ({
    id, filePath, heading, headingLevel: 2, tags, tagLabels: {},
    links: [], rawContent, startLine: 1, endLine: 5,
    headingTags: tags.map((key) => ({ key, label: key })),
  });
  const sections = [
    section('atlas-1', 'notes/2026-09-08.md', 'Shutdown telemetry audit',
      ['#project/atlas', '@ren-kade'], 'Ren will retain the telemetry feed.'),
    section('atlas-2', 'notes/2026-09-09.md', 'Atlas planning',
      ['#project/atlas'], 'Sequencing for the milestone.'),
    section('vendor-1', 'notes/2026-09-11.md', 'Vendor risk',
      ['#risk/vendor'], 'Documented the absent elevator contract.'),
    section('beta-1', 'notes/2026-09-12.md', 'Beta kickoff',
      ['#project/beta'], 'Kickoff notes for beta.'),
  ];
  const tasks = [{
    id: 'task-1', filePath: 'notes/2026-09-08.md', sectionId: 'atlas-1',
    title: 'Send the audit summary', completed: false,
    tags: ['#project/atlas'], tagLabels: {}, lineNumber: 9,
    checkboxColumn: 3, checkboxValue: ' ', sourceLineText: '- [ ] Send it',
  }];
  const tag = (key, sectionIds, taskIds) => [key, {
    key, label: key, sectionIds, taskIds, filePaths: [],
    count: sectionIds.length + taskIds.length, isFavorite: false,
  }];
  return {
    files: new Map(),
    sections: new Map(sections.map((s) => [s.id, s])),
    tasks: new Map(tasks.map((t) => [t.id, t])),
    tags: new Map([
      tag('#project/atlas', ['atlas-1', 'atlas-2'], ['task-1']),
      tag('@ren-kade', ['atlas-1'], []),
      tag('#risk/vendor', ['vendor-1'], []),
      tag('#project/beta', ['beta-1'], []),
    ]),
    entities: new Map([
      ['#project/atlas', { key: '#project/atlas', label: '#project/atlas', kind: 'project', name: 'atlas', sectionIds: ['atlas-1','atlas-2'], taskIds: ['task-1'], filePaths: [], count: 3, isFavorite: false }],
      ['#project/beta', { key: '#project/beta', label: '#project/beta', kind: 'project', name: 'beta', sectionIds: ['beta-1'], taskIds: [], filePaths: [], count: 1, isFavorite: false }],
      ['@ren-kade', { key: '@ren-kade', label: '@ren-kade', kind: 'person', name: 'ren-kade', sectionIds: ['atlas-1'], taskIds: [], filePaths: [], count: 1, isFavorite: false }],
    ]),
    tagAssociations: new Map(),
    updatedAt: Date.now(),
  };
}

function createIndexer(index) {
  const emitter = new vscode.EventEmitter();
  return {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: emitter.event,
    _emitter: emitter,
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

/**
 * Opens a page through the real panel registry and mounts its webview, with
 * the real Related Notes view listening to the same registry.
 */
async function openPanel(open) {
  vscode._test.createdPanels.length = 0;
  const index = createIndex();
  const indexer = createIndexer(index);
  const preferences = new PreferencesStore(createGlobalState());
  const panels = new TagOverviewPanels(indexer, preferences, { fsPath: '/ext' });

  await open(panels);
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  // Replay the state the host already sent before the script was mounted.
  panel._toWebview.forEach((message) => panel._deliver(message));
  const sidebarView = new SidebarNotesView(
    indexer,
    preferences,
    panels,
    () => undefined,
    '0.0.0-test',
  );
  const sidebarHost = vscode._test.createWebviewView();
  sidebarView.resolveWebviewView(sidebarHost);
  // The sidebar renders once its script reports ready.
  sidebarHost._fromWebview({ type: 'ready' });

  /** The state the sidebar last pushed to its own webview. */
  const sidebar = () => {
    const last = sidebarHost.posted[sidebarHost.posted.length - 1];
    return last && last.data;
  };

  return {
    panels, panel, view, preferences, index, indexer,
    sidebar, sidebarView, sidebarHost,
  };
}

/** A tag overview, which the search box narrows. */
function openOverview(tagKey = '#project/atlas', filterTagKeys = []) {
  return openPanel((panels) => panels.show(tagKey, undefined, filterTagKeys));
}

/** A query view, whose search box holds the whole query. */
function openSearch(queryText) {
  return openPanel((panels) => panels.showQuery(queryText));
}

/** The titles of the cards a reader can see. */
function visibleTitles(view) {
  return view
    .findAll('.card')
    .filter((card) => !card.hidden)
    .map((card) => card.querySelector('.card-title').textContent.trim())
    .sort();
}

/** Types into the search box and presses Enter. */
function search(view, text) {
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, text);
  view.keydown(bar, 'Enter');
}

/** Opens the builder and returns its first row's value field. */
function openBuilder(view) {
  view.click(view.find('[data-action="toggle-builder"]'));
  const rows = view.findAll('[data-action="builder-set-value"]');
  return rows[rows.length - 1];
}

const tests = [];
const only = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

test('the search box is shown without a toggle', async () => {
  const { view } = await openOverview();
  assert.ok(view.find('[data-action="query-input"]'), 'the search box is on the page');
  assert.strictEqual(view.find('[data-action="toggle-query"]'), null);
});

test('Clear holds its place, and waits for more than the page\'s own tag', async () => {
  const { view } = await openOverview();
  const clear = () => view.find('[data-action="clear-query"]');
  assert.ok(clear(), 'Clear is on the page');
  assert.strictEqual(
    view.find('[data-action="query-input"]').value,
    '#project/atlas',
    "the page's tag is written in the box",
  );
  assert.notStrictEqual(clear().getAttribute('disabled'), null, 'with nothing else, there is nothing to clear');

  view.type(view.find('[data-action="query-input"]'), '#project/atlas planning');
  assert.strictEqual(clear().getAttribute('disabled'), null, 'typing more makes it live');
  assert.strictEqual(clear().disabled, false);

  view.type(view.find('[data-action="query-input"]'), '#project/atlas');
  assert.strictEqual(clear().disabled, true, 'and back to the tag alone, it waits again');
});

test('Clear returns the page to its own tag, dropping added tags and words', async () => {
  const { view } = await openOverview();
  search(view, '#project/atlas @ren-kade text ~ telemetry');
  assert.deepStrictEqual(view.state.filterTagKeys, ['@ren-kade']);
  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);

  view.click(view.find('[data-action="clear-query"]'));

  assert.strictEqual(view.find('[data-action="query-input"]').value, '#project/atlas');
  assert.deepStrictEqual(view.state.filterTagKeys, [], 'the added tag is gone');
  assert.strictEqual(view.state.refinement, '#project/atlas', 'and so are the words');
  assert.strictEqual(view.state.tagKey, '#project/atlas', 'the page keeps its tag');
  assert.deepStrictEqual(visibleTitles(view).sort(), ['Atlas planning', 'Shutdown telemetry audit']);
  assert.notStrictEqual(view.find('[data-action="clear-query"]').getAttribute('disabled'), null);
});

test('plain words narrow the page as they are typed', async () => {
  const { view } = await openOverview();
  view.posted.length = 0;
  view.type(view.find('[data-action="query-input"]'), 'planning');

  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning']);
  assert.deepStrictEqual(view.posted, [], 'nothing is asked of the host until Enter');
});

test('Enter narrows the entries within the tag', async () => {
  const { view } = await openOverview();
  search(view, 'text ~ telemetry');

  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);
  assert.strictEqual(view.state.refinement, '#project/atlas AND text ~ telemetry');
  assert.strictEqual(view.state.tagKey, '#project/atlas', 'the tag stays the page');
});

test('a tag typed in the search box joins the tags in the title', async () => {
  const { view } = await openOverview();
  search(view, '@ren-kade');

  assert.deepStrictEqual(view.state.filterTagKeys, ['@ren-kade']);
  assert.strictEqual(
    view.find('[data-action="query-input"]').value,
    '#project/atlas AND @ren-kade',
    'both tags stay in the box',
  );
  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);
});

test('completing in the search box keeps the rest of the search', async () => {
  const { view } = await openOverview();
  view.type(view.find('[data-action="query-input"]'), 'task = open AND tag = #project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  assert.strictEqual(
    view.find('[data-action="query-input"]').value,
    'task = open AND tag = #project/beta ',
  );
});

test('a parse error is reported and the results stay put', async () => {
  const { view } = await openOverview();
  search(view, '(tag = #project/atlas');

  assert.ok(view.find('.query-error'), 'the error should be shown');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning', 'Shutdown telemetry audit']);
});

test('removing a term keeps the rest of the search as typed', async () => {
  const { view } = await openOverview();
  search(view, 'telemetry is:open');
  const remove = view
    .findAll('[data-action="remove-term"]')
    .find((button) => button.getAttribute('data-without') === '#project/atlas AND telemetry');
  assert.ok(remove, 'each term has its own remove button');

  view.click(remove);

  assert.strictEqual(
    view.find('[data-action="query-input"]').value,
    '#project/atlas AND telemetry',
  );
  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);
});

test('a facet value narrows the page', async () => {
  const { view } = await openOverview();
  const open = view.find('[data-action="facet"][data-clause="is:open"]');
  assert.ok(open, 'open tasks are offered as a refinement');

  view.click(open);

  assert.strictEqual(view.state.refinement, '#project/atlas AND is:open');
  assert.deepStrictEqual(visibleTitles(view), [], 'is:open keeps only tasks');
});

test('a new builder row starts from its value', async () => {
  const { view } = await openOverview();
  const row = openBuilder(view);
  assert.strictEqual(row.dataset.pending, 'true', 'the builder opens on a new row');

  view.type(row, '@ren');
  view.press(view.find('[data-action="query-suggestion"]'));

  assert.deepStrictEqual(view.state.filterTagKeys, ['@ren-kade']);
  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);
});

test('the page does not open a second panel while editing', async () => {
  const { view } = await openOverview();
  const before = vscode._test.createdPanels.length;
  view.type(openBuilder(view), '#project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  assert.strictEqual(
    vscode._test.createdPanels.length,
    before,
    'editing a search must not open another overview',
  );
});

test('clicking the label inside a completion still applies it', async () => {
  const { view } = await openOverview();
  view.type(openBuilder(view), '#risk/v');

  // A real pointer lands on the deepest element, which is the label span.
  const option = view.find('[data-action="query-suggestion"]');
  view.press(option.children[0] ?? option);

  assert.deepStrictEqual(view.state.filterTagKeys, ['#risk/vendor']);
});

test('the keyboard can pick a completion in a builder row', async () => {
  const { view } = await openOverview();
  const row = openBuilder(view);
  view.type(row, '#risk/v');
  view.keydown(row, 'ArrowDown');
  view.keydown(row, 'Enter');

  assert.deepStrictEqual(view.state.filterTagKeys, ['#risk/vendor']);
});

test('a field chosen in a new row offers the operators themselves', async () => {
  const { view } = await openOverview();
  view.type(openBuilder(view), 'tag');
  view.press(view.find('[data-action="query-suggestion"]'));

  // The page's own tag fills the first row, so the chosen field is the last.
  const selects = view.findAll('[data-action="builder-set-operator"]');
  const options = [...selects[selects.length - 1].children].map((option) =>
    option.textContent.trim(),
  );
  assert.deepStrictEqual(options, ['=', '!=']);
});

test('typing a value and leaving the field applies it, and again', async () => {
  const { view } = await openOverview();
  view.type(openBuilder(view), 'text');
  view.press(view.find('[data-action="query-suggestion"]'));

  const value = () => {
    const rows = view.findAll('[data-action="builder-set-value"]');
    return rows[rows.length - 1];
  };
  view.change(value(), 'telemetry');
  assert.deepStrictEqual(visibleTitles(view), ['Shutdown telemetry audit']);

  view.change(value(), 'planning');
  assert.strictEqual(value().value, 'planning');
  assert.deepStrictEqual(visibleTitles(view), ['Atlas planning']);
});

test('the field dropdown switches which values are completed', async () => {
  const { view } = await openOverview();
  view.type(openBuilder(view), 'tag');
  view.press(view.find('[data-action="query-suggestion"]'));
  view.change(view.find('[data-action="builder-set-field"]'), 'task');

  view.type(view.find('[data-action="builder-set-value"]'), 'op');
  const labels = view
    .findAll('[data-action="query-suggestion"]')
    .map((option) => option.textContent.trim());
  assert.ok(labels.some((label) => label.includes('open')), labels.join(','));
});

test('an OR group in a query view finds notes from either branch', async () => {
  const { view } = await openSearch('text ~ elevator');
  search(view, 'tag = #risk/vendor OR tag = #project/beta');

  assert.deepStrictEqual(visibleTitles(view), ['Beta kickoff', 'Vendor risk']);
});

test('the sidebar follows a query view', async () => {
  const { view, sidebar } = await openSearch('text ~ elevator');
  assert.strictEqual(sidebar().tagOverviewQuery, 'text ~ elevator');

  search(view, 'tag = #risk/vendor OR tag = #project/beta');

  const after = sidebar();
  assert.strictEqual(
    after.tagOverviewQuery,
    'tag = #risk/vendor OR tag = #project/beta',
    'the sidebar should name the query as its scope',
  );
  assert.deepStrictEqual(
    after.notes.map((note) => note.title).sort(),
    ['Beta kickoff', 'Vendor risk'],
    'the sidebar should list what the query matched',
  );
});

test('the sidebar keeps the tag while its entries are narrowed', async () => {
  const { view, sidebar } = await openOverview();
  search(view, 'telemetry');

  const after = sidebar();
  assert.strictEqual(after.tagOverview.key, '#project/atlas');
  assert.strictEqual(after.tagOverviewQuery, undefined);
});

// ---------------------------------------------------------------------------

(async () => {
  let pass = 0;
  const failures = [];
  const list = only.length ? only : tests;
  for (const entry of list) {
    try {
      await entry.fn();
      pass += 1;
      console.log('  ok   ' + entry.name);
    } catch (error) {
      failures.push(entry.name + '\n       ' + String(error.message).split('\n').slice(0, 8).join('\n       '));
      console.log('  FAIL ' + entry.name);
    }
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(failures.length ? 1 : 0);
})();
