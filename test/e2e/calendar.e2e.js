// End-to-end: the sidebar calendar, page and host.
//
// Every day, week, and the month title asks the host to open its note. These
// check that the page draws the month the host sends, that stepping months
// goes through the host, and that a day or week opens the note the index has
// while a missing one is only offered, never created unasked.
const assert = require('assert');
const vscode = require('vscode');
const { createGlobalState, mountWebview } = require('./support.js');
const modules = require('../harness/modules.js');
const { CalendarView } = modules.calendar;
const { createPreferences } = modules.preferenceServices;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexState;
const { formatLocalDate, getPeriodicNote } = modules.periodicNotes;
const { ThemePreview } = modules.themePreview;

// The stub has no editor, so record what the host tries to open instead.
const opened = [];
vscode.workspace.openTextDocument = (uri) => {
  opened.push(uri.fsPath);
  return Promise.reject(new Error('The e2e stub has no editor.'));
};
vscode.window.showErrorMessage = () => Promise.resolve(undefined);

// Notes are dated from the real today, so the tests hold on any day.
const now = new Date();
const today = formatLocalDate(now);
const thisWeek = getPeriodicNote('week', now).name;

function createIndex() {
  const note = (filePath, content) =>
    parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 2 }, {});
  const files = [
    note(`/notes/${today}.md`, `# ${today}\n- [ ] Call Ren 📅 ${today}`),
    note(`/notes/${thisWeek}.md`, `# ${thisWeek}`),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

/** Lets the host finish handling a message the page posted. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Mounts the calendar's page against the real host, over `preferences`, empty unless given. */
async function openCalendar(preferences = createPreferences(createGlobalState())) {
  opened.length = 0;
  const index = createIndex();
  const updates = new vscode.EventEmitter();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: updates.event,
  };
  const calendar = new CalendarView({
    indexer,
    writes: modules.taskWrites.createTaskWrites(),
    themePreview: new ThemePreview(),
    extensionUri: vscode.Uri.file('/ext'),
    preferences,
  });
  const host = vscode._test.createWebviewView();
  // The page's messages reach the real host, as they do in VS Code.
  host._onWebviewMessage = host._fromWebview;
  calendar.resolveWebviewView(host);
  const view = mountWebview(host.webview.html, host);
  host.posted.forEach((message) => host._deliver(message));
  await settle();
  const day = (date) =>
    view.findAll('[data-action="open-day"]').find((button) => button.getAttribute('data-date') === date);
  const monthButton = (text) =>
    view.findAll('[data-action="show-month"]').find(
      (button) => button.getAttribute('aria-label') === text || button.textContent === text,
    );
  return { calendar, host, view, updates, day, monthButton };
}

// ---------------------------------------------------------------------------

test('draws the month the host sends, with today, its note, and its task', async () => {
  const { day } = await openCalendar();
  const todayButton = day(today);
  assert.ok(todayButton, 'today is drawn');
  assert.strictEqual(todayButton.getAttribute('aria-current'), 'date');
  assert.ok(todayButton.querySelector('.note-dot'), 'its daily note is marked');
  assert.strictEqual(todayButton.querySelector('.due').textContent, '1', 'its open task is counted');
});

test('stepping months goes through the host, and Today comes back', async () => {
  const { view, monthButton } = await openCalendar();
  const title = () => view.find('.calendar-title').textContent;
  const before = title();
  assert.ok(!monthButton('Today'), 'this month needs no Today button');

  view.click(monthButton('Next month'));
  await settle();
  assert.strictEqual(view.posted[view.posted.length - 1].type, 'showMonth');
  assert.notStrictEqual(title(), before, 'the next month is drawn');

  view.click(monthButton('Today'));
  await settle();
  assert.strictEqual(title(), before);
  assert.ok(!monthButton('Today'));
});

test("selecting today opens its daily note, and the week opens the week's note", async () => {
  const { view, day } = await openCalendar();
  view.click(day(today));
  await settle();
  // The week beside a row is a mark rather than a number; the row it belongs
  // to is the one holding today.
  const week = view
    .findAll('[data-action="open-week"]')
    .find((button) => button.classList.contains('has-note'));
  assert.ok(week, "the week that has a note is marked");
  view.click(week);
  await settle();
  assert.deepStrictEqual(opened, [`/notes/${today}.md`, `/notes/${thisWeek}.md`]);
});

test('every day is drawn the same, so a marked day does not move its date', async () => {
  const { view, day } = await openCalendar();
  const marked = day(today);
  const plain = view
    .findAll('[data-action="open-day"]')
    .find((button) => !button.querySelector('.note-dot'));
  assert.ok(plain, 'some day has no note');
  assert.strictEqual(
    marked.querySelectorAll('span').length,
    plain.querySelectorAll('span').length,
    'the same rows are drawn whether or not there is anything to mark',
  );
  assert.ok(
    marked.querySelector('.day-number'),
    'and the date has a place of its own',
  );
  assert.ok(
    view.findAll('[data-action="open-week"]').length > 0,
    'the week beside each row still opens its note',
  );
});

test('a day without a note is only offered, not created unasked', async () => {
  const { view } = await openCalendar();
  const empty = view
    .findAll('[data-action="open-day"]')
    .find((button) => !button.querySelector('.note-dot'));
  const asked = vscode._test.shown.info.length;
  view.click(empty);
  await settle();
  assert.strictEqual(vscode._test.shown.info.length, asked + 1, 'the host asks first');
  assert.deepStrictEqual(opened, [], 'and opens nothing when the offer is declined');
});

test('a hidden calendar skips updates and catches up when shown', async () => {
  const { host, updates } = await openCalendar();
  host._setVisible(false);
  const before = host.posted.length;
  updates.fire();
  updates.fire();
  assert.strictEqual(host.posted.length, before, 'nothing is drawn while hidden');

  host._setVisible(true);
  assert.strictEqual(host.posted.length, before + 1, 'showing it draws once');
});

test('with weeks starting on Monday, the header and every row start on Monday', async () => {
  await vscode.workspace.getConfiguration('deckard').update('calendar.weekStart', 'monday');
  try {
    const { view } = await openCalendar();
    const header = view.findAll('.weekday').map((cell) => cell.textContent).filter(Boolean);
    assert.deepStrictEqual(header, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const weeks = view.findAll('[data-action="open-week"]');
    assert.ok(weeks.length > 0);
    weeks.forEach((button) => {
      const [year, month, date] = button.getAttribute('data-date').split('-').map(Number);
      assert.strictEqual(new Date(year, month - 1, date).getDay(), 1, 'the week opens from its Monday');
    });
    view.click(weeks[0]);
    await settle();
    const posted = view.posted[view.posted.length - 1];
    assert.strictEqual(posted.type, 'openWeek');
    assert.strictEqual(posted.date, weeks[0].getAttribute('data-date'));
  } finally {
    await vscode.workspace.getConfiguration('deckard').update('calendar.weekStart', undefined);
  }
});

test('draws no day panel, and leaves the weekends out when the calendar page\'s gear does', async () => {
  const preferences = createPreferences(createGlobalState());
  const { host, view } = await openCalendar(preferences);
  assert.strictEqual(view.findAll('.day-panel').length, 0, 'the month alone');
  assert.strictEqual(view.findAll('[aria-selected]').length, 0, 'no day is chosen');
  const days = () => view.findAll('.calendar-grid .day').length;
  const all = days();

  const html = host.webview.html;
  await preferences.display.setViewChoice('calendarWeekends', false);
  await settle();
  assert.strictEqual(host.webview.html, html, 'no reload');
  assert.ok(view.find('.calendar-grid').classList.contains('no-weekends'));
  assert.strictEqual(days(), (all / 7) * 5, 'five days a week');
});
