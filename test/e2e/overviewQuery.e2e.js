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

/** Opens a tag overview and mounts its webview, wired to the real host. */
async function openOverview(tagKey = '#project/atlas', filterTagKeys = []) {
  vscode._test.createdPanels.length = 0;
  const index = createIndex();
  const indexer = createIndexer(index);
  const preferences = new PreferencesStore(createGlobalState());
  const panels = new TagOverviewPanels(indexer, preferences, { fsPath: '/ext' });

  await panels.show(tagKey, undefined, filterTagKeys);
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  // Replay the state the host already sent before the script was mounted.
  panel._toWebview.forEach((message) => panel._deliver(message));
  // The real Related Notes view, listening to the real panel registry.
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

const tests = [];
const only = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

test('the builder shows the tag the overview was opened on', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));

  const value = view.find('[data-action="builder-set-value"]');
  assert.ok(value, 'the builder should render a value field');
  assert.strictEqual(value.value, '#project/atlas');
});

test('choosing a completion in a builder row updates the value', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));

  const value = view.find('[data-action="builder-set-value"]');
  view.type(value, '#project/b');

  const option = view.find('[data-action="query-suggestion"]');
  assert.ok(option, 'a completion should be offered for #project/b');
  view.press(option);

  const updated = view.find('[data-action="builder-set-value"]');
  assert.strictEqual(
    updated.value,
    '#project/beta',
    'the row should show the tag that was chosen',
  );
});

test('choosing a completion updates the results on the page', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  view.type(view.find('[data-action="builder-set-value"]'), '#project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  const headings = view
    .findAll('.card-title')
    .map((card) => card.textContent.trim());
  assert.deepStrictEqual(headings, ['Beta kickoff']);
});

test('the page does not open a second panel while editing', async () => {
  const { view } = await openOverview();
  const before = vscode._test.createdPanels.length;
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  view.type(view.find('[data-action="builder-set-value"]'), '#project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  assert.strictEqual(
    vscode._test.createdPanels.length,
    before,
    'editing a query must not open another overview',
  );
});

test('adding a second condition narrows the results', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  view.click(view.find('[data-action="builder-add-row"]'));

  const rows = view.findAll('[data-action="builder-set-value"]');
  assert.strictEqual(rows.length, 2, 'the new row should be on the page');

  view.type(rows[1], '@ren');
  view.press(view.find('[data-action="query-suggestion"]'));

  const headings = view
    .findAll('.card-title')
    .map((card) => card.textContent.trim());
  assert.deepStrictEqual(headings, ['Shutdown telemetry audit']);
});

test('an OR group finds notes from either branch', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'tag = #risk/vendor OR tag = #project/beta');
  view.keydown(bar, 'Enter');

  const headings = view
    .findAll('.card-title')
    .map((card) => card.textContent.trim())
    .sort();
  assert.deepStrictEqual(headings, ['Beta kickoff', 'Vendor risk']);
});

test('a text condition matches note bodies', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'text ~ elevator');
  view.keydown(bar, 'Enter');

  const headings = view
    .findAll('.card-title')
    .map((card) => card.textContent.trim());
  assert.deepStrictEqual(headings, ['Vendor risk']);
});

test('completing in the query bar keeps the rest of the query', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'task = open AND tag = #project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  const updated = view.find('[data-action="query-input"]');
  assert.strictEqual(updated.value, 'task = open AND tag = #project/beta ');
});

test('a parse error is reported and the results stay put', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, '(tag = #project/atlas');
  view.keydown(bar, 'Enter');

  assert.ok(view.find('.query-error'), 'the error should be shown');
  const headings = view
    .findAll('.card-title')
    .map((card) => card.textContent.trim())
    .sort();
  assert.deepStrictEqual(headings, ['Atlas planning', 'Shutdown telemetry audit']);
});

test('the toggle says it opens an advanced search', async () => {
  const { view } = await openOverview();
  const toggle = view.find('[data-action="toggle-query"]');
  assert.strictEqual(toggle.textContent.trim(), 'Advanced search');

  view.click(toggle);
  assert.strictEqual(
    view.find('[data-action="toggle-query"]').textContent.trim(),
    'Hide advanced search',
  );
});

test('the operator dropdown offers the operators themselves', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));

  const options = view
    .findAll('[data-action="builder-set-operator"] option')
    .map((option) => option.textContent.trim());
  assert.deepStrictEqual(options, ['=', '!=']);
});

test('a two-tag overview builds one row per chip', async () => {
  const { view } = await openOverview('#project/atlas', ['@ren-kade']);
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  const values = view
    .findAll('[data-action="builder-set-value"]')
    .map((input) => input.value);
  assert.deepStrictEqual(values, ['#project/atlas', '@ren-kade']);
});

test('changing the second chip in a two-tag overview keeps the page', async () => {
  const { view } = await openOverview('#project/atlas', ['@ren-kade']);
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));

  const rows = view.findAll('[data-action="builder-set-value"]');
  view.type(rows[1], '#risk/v');
  view.press(view.find('[data-action="query-suggestion"]'));

  const values = view
    .findAll('[data-action="builder-set-value"]')
    .map((input) => input.value);
  assert.deepStrictEqual(values, ['#project/atlas', '#risk/vendor']);
});

test('changing the leading chip in a two-tag overview keeps the page', async () => {
  const { view } = await openOverview('#project/atlas', ['@ren-kade']);
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));

  const rows = view.findAll('[data-action="builder-set-value"]');
  view.type(rows[0], '#project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  const values = view
    .findAll('[data-action="builder-set-value"]')
    .map((input) => input.value);
  assert.deepStrictEqual(values, ['#project/beta', '@ren-kade']);
});

test('clicking the label inside a completion still applies it', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  view.type(view.find('[data-action="builder-set-value"]'), '#project/b');

  // A real pointer lands on the deepest element, which is the label span.
  const option = view.find('[data-action="query-suggestion"]');
  const label = option.children[0] ?? option;
  view.press(label);

  assert.strictEqual(
    view.find('[data-action="builder-set-value"]').value,
    '#project/beta',
  );
});

test('the keyboard can pick a completion in a builder row', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  const input = view.find('[data-action="builder-set-value"]');
  view.type(input, '#project/b');
  view.keydown(input, 'ArrowDown');
  view.keydown(input, 'Enter');

  assert.strictEqual(
    view.find('[data-action="builder-set-value"]').value,
    '#project/beta',
  );
});

test('typing a value and leaving the field applies it', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  const input = view.find('[data-action="builder-set-value"]');
  input.value = '#risk/vendor';
  view.change(input);

  const headings = view
    .findAll('.card-title')
    .map((card) => card.textContent.trim());
  assert.deepStrictEqual(headings, ['Vendor risk']);
});

test('changing a row twice keeps the second choice', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));

  view.type(view.find('[data-action="builder-set-value"]'), '#project/b');
  view.press(view.find('[data-action="query-suggestion"]'));
  view.type(view.find('[data-action="builder-set-value"]'), '#risk/v');
  view.press(view.find('[data-action="query-suggestion"]'));

  assert.strictEqual(
    view.find('[data-action="builder-set-value"]').value,
    '#risk/vendor',
  );
  assert.deepStrictEqual(
    view.findAll('.card-title').map((card) => card.textContent.trim()),
    ['Vendor risk'],
  );
});

test('the field dropdown switches which values are completed', async () => {
  const { view } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));

  const field = view.find('[data-action="builder-set-field"]');
  view.change(field, 'task');

  const input = view.find('[data-action="builder-set-value"]');
  view.type(input, 'op');
  const labels = view
    .findAll('[data-action="query-suggestion"]')
    .map((option) => option.textContent.trim());
  assert.ok(labels.some((label) => label.includes('open')), labels.join(','));
});

test('the sidebar follows a query applied in the page', async () => {
  const { view, sidebar } = await openOverview();
  assert.strictEqual(sidebar().tagOverview.key, '#project/atlas');

  view.click(view.find('[data-action="toggle-query"]'));
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'tag = #risk/vendor OR tag = #project/beta');
  view.keydown(bar, 'Enter');

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

test('the sidebar follows a query applied from the builder', async () => {
  const { view, sidebar } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  view.click(view.find('[data-action="toggle-builder"]'));
  view.type(view.find('[data-action="builder-set-value"]'), '#project/b');
  view.press(view.find('[data-action="query-suggestion"]'));

  const after = sidebar();
  assert.deepStrictEqual(
    after.notes.map((note) => note.title),
    ['Beta kickoff'],
  );
  // One named tag still gets its chip, so its associations stay navigable.
  assert.strictEqual(after.tagOverview.key, '#project/beta');
});

test('the sidebar returns to the tag when the query is cleared', async () => {
  const { view, sidebar } = await openOverview();
  view.click(view.find('[data-action="toggle-query"]'));
  const bar = view.find('[data-action="query-input"]');
  view.type(bar, 'text ~ elevator');
  view.keydown(bar, 'Enter');
  assert.strictEqual(sidebar().tagOverviewQuery, 'text ~ elevator');

  view.click(view.find('[data-action="clear-query"]'));

  const after = sidebar();
  assert.strictEqual(after.tagOverviewQuery, undefined);
  assert.strictEqual(after.tagOverview.key, '#project/atlas');
  assert.deepStrictEqual(
    after.notes.map((note) => note.title).sort(),
    ['Atlas planning', 'Shutdown telemetry audit'],
  );
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
      failures.push(entry.name + '\n       ' + String(error.message).split('\n')[0]);
      console.log('  FAIL ' + entry.name);
    }
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(failures.length ? 1 : 0);
})();
