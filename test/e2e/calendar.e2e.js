// End-to-end: the sidebar calendar, page and host.
//
// Every day, week, and the month title asks the host to open its note. These
// check that the page draws the month the host sends, that stepping months
// goes through the host, and that a day or week opens the note the index has
// while a missing one is only offered, never created unasked.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview } = require('./webviewRuntime.js');
const { CalendarView } = require('../../out/ui/webview/calendar.js');
const { parseMarkdown } = require('../../out/core/markdown/parser.js');
const { buildWorkspaceIndex } = require('../../out/core/workspace/indexer.js');
const { formatLocalDate, getPeriodicNote } = require('../../out/ui/commands/dailyNote.js');

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

/** Mounts the calendar's page against the real host. */
async function openCalendar() {
  opened.length = 0;
  const index = createIndex();
  const updates = new vscode.EventEmitter();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    onDidUpdate: updates.event,
  };
  const calendar = new CalendarView(indexer);
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
  return { host, view, updates, day, monthButton };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

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
  const week = view
    .findAll('[data-action="open-week"]')
    .find((button) => button.getAttribute('aria-label') === `Week ${thisWeek}, weekly note`);
  assert.ok(week, "the week's note is marked on its label");
  view.click(week);
  await settle();
  assert.deepStrictEqual(opened, [`/notes/${today}.md`, `/notes/${thisWeek}.md`]);
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
