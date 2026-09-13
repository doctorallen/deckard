// End-to-end: the Stats page's most-viewed rows against the real host.
//
// Each row posts the message the host projected for it. These check that a
// click or a key on a row reaches the host as the right open, and that a row
// the index no longer has opens nothing.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview } = require('./webviewRuntime.js');
const { StatsPanel } = require('../../out/ui/webview/stats.js');
const { PreferencesStore } = require('../../out/core/storage/preferences.js');

// The stub has no editor, so record what the host tries to open instead.
const opened = [];
vscode.workspace.openTextDocument = (uri) => {
  opened.push(uri.fsPath);
  return Promise.reject(new Error('The e2e stub has no editor.'));
};
vscode.window.showErrorMessage = () => Promise.resolve(undefined);

const section = {
  id: 'relay-review',
  filePath: '/notes/relay.md',
  heading: 'Relay review #project/relay',
  headingLevel: 2,
  tags: ['#project/relay'],
  tagLabels: { '#project/relay': '#project/relay' },
  links: [],
  rawContent: '',
  startLine: 4,
  endLine: 8,
};

function createIndex() {
  const tag = { key: '#project/relay', label: '#project/relay', count: 3 };
  return {
    files: new Map(),
    sections: new Map([[section.id, section]]),
    tasks: new Map(),
    tags: new Map([[tag.key, tag]]),
    entities: new Map([
      [tag.key, { ...tag, kind: 'project', name: 'relay' }],
    ]),
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

/** Lets the host finish handling a message the page posted. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Opens Stats with one viewed tag, entity, and note entry. */
async function openStats() {
  vscode._test.createdPanels.length = 0;
  opened.length = 0;
  const index = createIndex();
  const updates = new vscode.EventEmitter();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: updates.event,
  };
  const preferences = new PreferencesStore(createGlobalState());
  await preferences.recordTagAccess('#project/relay');
  await preferences.recordEntityAccess('#project/relay');
  await preferences.recordSectionAccess(section.id);
  const openedTags = [];
  const stats = new StatsPanel(indexer, preferences, { fsPath: '/ext' }, (tagKey) => {
    openedTags.push(tagKey);
  });
  await stats.show();
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  panel._toWebview.forEach((message) => panel._deliver(message));
  // Tags, canonical tags, then note entries, in page order.
  const rows = () => view.findAll('.stat-row');
  return { view, panel, updates, index, preferences, openedTags, rows };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

test('each most-viewed list renders an openable row', async () => {
  const { rows } = await openStats();
  assert.strictEqual(rows().length, 3);
  for (const row of rows()) {
    assert.strictEqual(row.getAttribute('role'), 'button');
    assert.strictEqual(row.getAttribute('tabindex'), '0');
  }
  // A tag dims its namespace, as everywhere else a tag is shown; a canonical
  // tag is listed by its name, as on the Dashboard.
  const namespace = rows()[0].querySelector('.tag-namespace');
  assert.ok(namespace, 'a tag row dims its namespace');
  assert.strictEqual(namespace.textContent, '#project/');
  assert.ok(!rows()[1].querySelector('.tag-namespace'));
});

test('clicking a most-viewed tag opens its overview', async () => {
  const { view, openedTags, rows } = await openStats();
  // A click on the row's text still opens the row.
  view.click(rows()[0].querySelector('.label'));
  await settle();
  assert.deepStrictEqual(view.posted[view.posted.length - 1], {
    type: 'openTag',
    tagKey: '#project/relay',
  });
  assert.deepStrictEqual(openedTags, ['#project/relay']);
});

test('Enter and Space open a canonical tag from the keyboard', async () => {
  const { view, openedTags, rows } = await openStats();
  view.keydown(rows()[1], 'Enter');
  view.keydown(rows()[1], ' ');
  view.keydown(rows()[1], 'a');
  await settle();
  assert.deepStrictEqual(openedTags, ['#project/relay', '#project/relay']);
});

test('clicking a most-viewed note entry opens its note and counts the view', async () => {
  const { view, preferences, rows } = await openStats();
  const before = preferences.value.sectionAccessCounts[section.id];
  view.click(rows()[2]);
  await settle();
  assert.deepStrictEqual(view.posted[view.posted.length - 1], {
    type: 'openSource',
    filePath: '/notes/relay.md',
    line: 4,
  });
  assert.deepStrictEqual(opened, ['/notes/relay.md']);
  assert.strictEqual(preferences.value.sectionAccessCounts[section.id], before + 1);
});

test('a hidden Stats page skips updates and catches up when shown', async () => {
  const { panel, updates, index } = await openStats();
  panel._setVisible(false);
  const before = panel._toWebview.length;
  index.tags.clear();
  updates.fire(index);
  updates.fire(index);
  assert.strictEqual(panel._toWebview.length, before, 'nothing is drawn while hidden');

  panel._setVisible(true);
  assert.strictEqual(panel._toWebview.length, before + 1, 'showing the page draws it once');
  assert.deepStrictEqual(panel._toWebview[before].data.tagViews, [], 'with the newest data');
});

test('a row the index no longer has opens nothing', async () => {
  const { view, index, preferences, openedTags, rows } = await openStats();
  const before = { ...preferences.value.sectionAccessCounts };
  // The page still shows the rows; the host's index has moved on.
  index.tags.clear();
  index.sections.clear();
  rows().forEach((row) => view.click(row));
  await settle();
  assert.strictEqual(view.posted.length, 3, 'every row still posted');
  assert.deepStrictEqual(openedTags, []);
  assert.deepStrictEqual(opened, []);
  assert.deepStrictEqual(preferences.value.sectionAccessCounts, before);
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
