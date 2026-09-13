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

/** Opens the Dashboard and mounts its webview, wired to the real host. */
async function openDashboard(taskLayout = 'list') {
  vscode._test.createdPanels.length = 0;
  const index = createIndex();
  const updates = new vscode.EventEmitter();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: updates.event,
  };
  const preferences = new PreferencesStore(createGlobalState());
  await preferences.setDashboardTaskLayout(taskLayout);
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
