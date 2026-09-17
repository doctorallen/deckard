// End-to-end: the Related Notes sidebar's result list, page and host.
//
// A long list is drawn 50 results at a time, so it costs one screen of cards
// until the reader asks for more.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview } = require('./webviewRuntime.js');
const { SidebarNotesView } = require('../../out/ui/webview/sidebarNotes.js');
const { ActiveSearch } = require('../../out/ui/webview/activeSearch.js');
const { PreferencesStore } = require('../../out/core/storage/preferences.js');
const { parseMarkdown } = require('../../out/core/markdown/parser.js');
const { buildWorkspaceIndex } = require('../../out/core/workspace/indexer.js');

/** `count` notes, each a heading tagged #project/atlas. */
function createIndex(count) {
  const files = Array.from({ length: count }, (_, number) => {
    const filePath = `notes/note-${String(number).padStart(3, '0')}.md`;
    return parseMarkdown(
      filePath,
      `# Note ${number} #project/atlas\nBody ${number}.`,
      { createdAt: 1, updatedAt: 2 },
      {},
    );
  });
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
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
 * Opens the sidebar beside the first note, which every other note shares a
 * tag with, and mounts the sidebar's own page against the real host.
 */
async function openSidebar(noteCount) {
  const index = createIndex(noteCount);
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: (uri) => uri.fsPath,
    onDidUpdate: new vscode.EventEmitter().event,
  };
  vscode.window.activeTextEditor = {
    document: { uri: vscode.Uri.file('notes/note-000.md'), languageId: 'markdown' },
    selection: { active: { line: 0 } },
  };
  const preferences = new PreferencesStore(createGlobalState());
  const sidebarView = new SidebarNotesView(
    indexer,
    preferences,
    new ActiveSearch(),
    () => undefined,
    '0.0.0-test',
  );
  const host = vscode._test.createWebviewView();
  // The page's messages reach the real host, as they do in VS Code.
  host._onWebviewMessage = host._fromWebview;
  sidebarView.resolveWebviewView(host);
  const view = mountWebview(host.webview.html, host);
  host.posted.forEach((message) => host._deliver(message));
  const cards = () => view.find('.note-list').children.length;
  const showMore = () => view.find('[data-action="show-more-notes"]');
  const close = () => {
    sidebarView.dispose();
    vscode.window.activeTextEditor = undefined;
  };
  return { view, cards, showMore, close };
}

/** A note with two tagged headings, and a note sharing each heading's tag. */
function createEditorIndex() {
  const note = (filePath, content) =>
    parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 2 }, {});
  const files = [
    note('notes/current.md', '# One #project/alpha\nFirst.\n\n# Two #project/beta\nSecond.'),
    note('notes/alpha.md', '# Alpha notes #project/alpha'),
    note('notes/beta.md', '# Beta notes #project/beta'),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

const settle = (milliseconds = 200) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Opens the sidebar beside an editor on notes/current.md, with the cursor on
 * its first heading, and returns a way to move the cursor the way typing and
 * arrow keys do.
 */
async function openForEditor() {
  const index = createEditorIndex();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: (uri) => uri.fsPath,
    onDidUpdate: new vscode.EventEmitter().event,
  };
  const editor = {
    document: { uri: vscode.Uri.file('notes/current.md'), languageId: 'markdown' },
    selection: { active: { line: 0 } },
  };
  vscode.window.activeTextEditor = editor;
  const sidebarView = new SidebarNotesView(
    indexer,
    new PreferencesStore(createGlobalState()),
    new ActiveSearch(),
    () => undefined,
    '0.0.0-test',
  );
  const host = vscode._test.createWebviewView();
  sidebarView.resolveWebviewView(host);
  await settle();
  const states = () =>
    host.posted.filter((message) => message.type === 'state').map((message) => message.data);
  const moveCursor = (line) => {
    editor.selection = { active: { line } };
    vscode._test.emitters.selection.fire({ textEditor: editor });
  };
  const close = () => {
    sidebarView.dispose();
    vscode.window.activeTextEditor = undefined;
  };
  return { host, states, moveCursor, close };
}

const relatedPaths = (state) => state.notes.map((note) => note.filePath);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

test('a long list shows 50 results and a Show more button', async () => {
  // One note is open, so 120 others are related to it.
  const { view, cards, showMore, close } = await openSidebar(121);
  try {
    assert.strictEqual(cards(), 50);
    assert.strictEqual(showMore().textContent, 'Show 50 more of 70');

    view.click(showMore());
    assert.strictEqual(cards(), 100);
    assert.strictEqual(showMore().textContent, 'Show 20 more');

    view.click(showMore());
    assert.strictEqual(cards(), 120);
    assert.ok(!showMore(), 'every result is shown, so the button is gone');
  } finally {
    close();
  }
});

test('a short list shows every result and no button', async () => {
  const { cards, showMore, close } = await openSidebar(6);
  try {
    assert.strictEqual(cards(), 5);
    assert.ok(!showMore());
  } finally {
    close();
  }
});

test('the note\'s tags are rows with a rail and a count', async () => {
  const { view, close } = await openSidebar(6);
  try {
    const rows = view.findAll('.active-tag-list .active-tag-open');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].getAttribute('data-action'), 'open-tag');
    assert.ok(rows[0].querySelector('.tag-weight-rail'), 'with its weight');
    assert.strictEqual(rows[0].querySelector('.refine-count').textContent, '6', 'and the six notes carrying it');
    assert.ok(rows[0].getAttribute('title').includes('6 notes · 0 tasks'));
  } finally {
    close();
  }
});

test('moving the cursor within one entry does not rank again', async () => {
  const { states, moveCursor, close } = await openForEditor();
  try {
    const before = states().length;
    assert.deepStrictEqual(relatedPaths(states()[before - 1]), ['notes/alpha.md']);

    // Typing and arrow keys inside the first heading.
    moveCursor(1);
    moveCursor(2);
    moveCursor(0);
    await settle();
    assert.strictEqual(states().length, before, 'the same entry is not ranked again');

    // Into the second heading, with a burst of moves.
    moveCursor(3);
    moveCursor(4);
    await settle();
    assert.strictEqual(states().length, before + 1, 'a new entry is ranked once');
    assert.deepStrictEqual(relatedPaths(states()[before]), ['notes/beta.md']);
  } finally {
    close();
  }
});

test('a hidden sidebar ranks again only when it is shown', async () => {
  const { host, states, moveCursor, close } = await openForEditor();
  try {
    host._setVisible(false);
    const before = states().length;
    moveCursor(3);
    await settle();
    assert.strictEqual(states().length, before, 'nothing is ranked while hidden');

    host._setVisible(true);
    assert.strictEqual(states().length, before + 1, 'showing it ranks once');
    assert.deepStrictEqual(relatedPaths(states()[before]), ['notes/beta.md']);
  } finally {
    close();
  }
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
