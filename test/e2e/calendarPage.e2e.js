// End-to-end: the calendar page, page and host.
//
// The page draws each day's tasks by name, due, scheduled, and repeating;
// chooses a day for the panel beside it; steps by month or by week; and
// moves a task dragged to another day through the host, which says so when
// it could not.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview } = require('./support.js');
const modules = require('../harness/modules.js');
const { CalendarPanel } = modules.calendarPage;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexer;
const { formatLocalDate } = modules.dailyNote;
const { ActiveCalendar } = modules.activeCalendar;
const { ActiveSearch } = modules.activeSearch;
const { SidebarNotesView } = modules.sidebarNotes;
const { PreferencesStore } = modules.preferences;
const { WorkspaceWriteHistory } = modules.workspaceWrites;

vscode.workspace.openTextDocument = () => Promise.reject(new Error('The e2e stub has no editor.'));
vscode.window.showErrorMessage = () => Promise.resolve(undefined);
vscode.window.showWarningMessage = () => Promise.resolve(undefined);

// Dated from the real today, so the tests hold on any day.
const shift = (days) => {
  const at = new Date();
  return formatLocalDate(new Date(at.getFullYear(), at.getMonth(), at.getDate() + days));
};
const today = shift(0);
const tomorrow = shift(1);

function createIndex() {
  const note = (filePath, content) => parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 2 }, {});
  const files = [
    note(`/notes/${today}.md`, [
      `# ${today}`,
      `- [ ] Call Ren 📅 ${today}`,
      `- [ ] Draft the brief ⏳ ${today}`,
      `- [ ] Water the plants 📅 ${today} 🔁 every day`,
    ].join('\n')),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function openPage() {
  vscode._test.createdPanels.length = 0;
  const index = createIndex();
  const updates = new vscode.EventEmitter();
  const page = new CalendarPanel(
    { ready: Promise.resolve(), getSnapshot: () => index, onDidUpdate: updates.event },
    { fsPath: '/ext' },
    { history: new WorkspaceWriteHistory(), keepRank: () => undefined },
  );
  await page.show();
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  panel._toWebview.forEach((message) => panel._deliver(message));
  await settle();
  const cell = (date) => view.find(`.day-cell[data-drop-date="${date}"]`);
  const chips = (date) => [...cell(date).querySelectorAll('.cal-chip')].map((chip) => [chip.dataset.kind, chip.textContent.replace(/^[↻⏳ ]+/, '')]);
  return { page, panel, view, cell, chips };
}

// ---------------------------------------------------------------------------

test('a day lists its tasks by name, due, then scheduled, then repeats on later days', async () => {
  const { view, chips } = await openPage();
  assert.deepStrictEqual(chips(today), [['due', 'Call Ren'], ['due', 'Water the plants'], ['scheduled', 'Draft the brief']]);
  assert.deepStrictEqual(chips(tomorrow), [['repeat', 'Water the plants']], 'a repeat is drawn on its later dates');
  assert.ok(view.find('.day-panel'), 'the chosen day is beside the month');
  assert.strictEqual(view.find('.cal-chip.kind-repeat').getAttribute('draggable'), null, 'a repeat cannot be dragged');
});

test('a chip opens its task, and a day chooses the panel', async () => {
  const { panel, view, cell } = await openPage();
  const deliver = panel._onWebviewMessage;
  panel._onWebviewMessage = () => undefined;
  try {
    view.click(cell(today).querySelector('.cal-chip'));
    assert.strictEqual(view.posted[view.posted.length - 1].type, 'openTask');
  } finally {
    panel._onWebviewMessage = deliver;
  }
  view.click(cell(tomorrow).querySelector('[data-action="open-day"]'));
  await new Promise((resolve) => setTimeout(resolve, 160));
  await settle();
  assert.match(view.find('.day-panel h2').textContent, /Tomorrow/, 'the panel follows the chosen day');
  assert.ok(view.find('.day-panel [aria-label="Repeats"]'), 'with its repeats');
});

test('the Week layout draws one row, and ] steps a week through the host', async () => {
  const { view } = await openPage();
  view.click(view.find('.calendar-page-actions [data-action="set-calendar-layout"][data-value="week"]'));
  assert.strictEqual(view.findAll('.calendar-grid .day-cell').length, 7);
  assert.ok(view.find('.calendar-page-body.is-week'));
  view.keydown(view.document.body, ']');
  await settle();
  assert.deepStrictEqual(view.posted.filter((message) => message.type === 'selectDay').pop(), { type: 'selectDay', date: shift(7) });
  assert.ok(view.find(`.day-cell[data-drop-date="${shift(7)}"]`), 'the week after is drawn');
  view.keydown(view.document.body, 'm');
  assert.ok(view.findAll('.calendar-grid .day-cell').length >= 28, 'm goes back to the month');
});

test('a task dragged to another day asks the host to move it, and a refusal is said', async () => {
  const { panel, view, cell } = await openPage();
  const chip = cell(today).querySelector('.cal-chip[data-kind="due"]');
  // A repeat is not taken up at all.
  view.fire('dragstart', cell(tomorrow).querySelector('.cal-chip[data-kind="repeat"]'), { dataTransfer: { setData: () => undefined } });
  view.fire('drop', cell(shift(2)), { dataTransfer: {} });
  assert.ok(!view.posted.some((message) => message.type === 'moveTask'), 'a repeat is not moved');
  const dataTransfer = { setData: () => undefined, effectAllowed: '', dropEffect: '' };
  const deliver = panel._onWebviewMessage;
  panel._onWebviewMessage = () => undefined;
  try {
    view.fire('dragstart', chip, { dataTransfer });
    // The harness's classList draws nothing, so what is checked is what is posted.
    view.fire('dragover', cell(tomorrow), { dataTransfer });
    view.fire('drop', cell(tomorrow), { dataTransfer });
    assert.deepStrictEqual(view.posted[view.posted.length - 1], { type: 'moveTask', taskId: chip.dataset.taskId, field: 'due', date: tomorrow });
  } finally {
    panel._onWebviewMessage = deliver;
  }
  // The stub cannot write the note, so the host refuses and says so.
  panel._onWebviewMessage({ type: 'moveTask', taskId: chip.dataset.taskId, field: 'due', date: tomorrow });
  await settle();
  await settle();
  assert.ok(panel._toWebview.some((message) => message.type === 'moveRefused'), 'the host says it was not moved');
});

test('the gear turns repeats off where the setting is written', async () => {
  const { view } = await openPage();
  vscode._test.configurationUpdates.length = 0;
  view.find('.view-options').setAttribute('open', '');
  view.click(view.find('.view-options [data-action="set-show-repeats"][data-value="off"]'));
  await settle();
  assert.deepStrictEqual(vscode._test.configurationUpdates.map((update) => [update.name, update.value]), [['deckard.calendar.showRepeats', false]]);
});

test('with Related Notes open, the chosen day is there and the month takes the width', async () => {
  vscode._test.createdPanels.length = 0;
  const index = createIndex();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: (uri) => uri.fsPath,
    onDidUpdate: new vscode.EventEmitter().event,
  };
  const store = new Map();
  const globalState = { get: (key, fallback) => (store.has(key) ? store.get(key) : fallback), keys: () => [...store.keys()], update: (key, value) => { store.set(key, value); return Promise.resolve(); } };
  const activeCalendar = new ActiveCalendar();
  const sidebar = new SidebarNotesView({
    indexer,
    preferences: new PreferencesStore(globalState),
    activeSearch: new ActiveSearch(),
    onOpenTag: () => undefined,
    extensionVersion: '0.0.0-test',
    activeCalendar,
    history: new WorkspaceWriteHistory(),
  });
  const sidebarHost = vscode._test.createWebviewView();
  sidebarHost._onWebviewMessage = sidebarHost._fromWebview;
  sidebar.resolveWebviewView(sidebarHost);
  const sidebarView = mountWebview(sidebarHost.webview.html, sidebarHost);
  sidebarHost.posted.forEach((message) => sidebarHost._deliver(message));

  const page = new CalendarPanel(indexer, { fsPath: '/ext' }, { history: new WorkspaceWriteHistory(), keepRank: () => undefined }, activeCalendar);
  await page.show();
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const view = mountWebview(panel.webview.html, panel);
  panel._toWebview.forEach((message) => panel._deliver(message));
  await settle();
  try {
    assert.strictEqual(view.findAll('.day-panel').length, 0, 'the page leaves the day to the sidebar');
    assert.ok(view.find('.calendar-page-body.day-in-sidebar'));
    assert.match(sidebarView.find('.day-panel h2').textContent, /Today/, 'which shows the chosen day');
    assert.ok(sidebarView.find('.day-panel [aria-label="Due"]'));

    // What is done there is the page's to do.
    const opened = [];
    const handle = page.handleDayMessage.bind(page);
    page.handleDayMessage = async (message) => { opened.push(message); };
    sidebarView.click(sidebarView.find('.day-panel .task-row .task-title'));
    await settle();
    assert.deepStrictEqual(opened.map((message) => message.type), ['openTask']);
    page.handleDayMessage = handle;

    // A new day chosen on the page follows into the sidebar.
    view.click(view.find(`.day-cell[data-drop-date="${tomorrow}"] [data-action="open-day"]`));
    await new Promise((resolve) => setTimeout(resolve, 160));
    await settle();
    assert.match(sidebarView.find('.day-panel h2').textContent, /Tomorrow/);

    // With the sidebar closed, the page takes its panel back.
    sidebarHost._setVisible(false);
    await settle();
    assert.ok(view.find('.day-panel'), 'the page draws the day again');
    assert.strictEqual(view.findAll('.calendar-page-body.day-in-sidebar').length, 0);
  } finally {
    page.dispose();
    sidebar.dispose();
  }
});

