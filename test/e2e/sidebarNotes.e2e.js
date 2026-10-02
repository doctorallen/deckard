// End-to-end: the Related Notes sidebar's result list, page and host.
//
// A long list is drawn 50 results at a time, so it costs one screen of cards
// until the reader asks for more.
const assert = require('assert');
const vscode = require('vscode');
const { mountWebview, createGlobalState } = require('./support.js');
const modules = require('../harness/modules.js');
const { SidebarNotesView } = modules.sidebarNotes;
const { ActiveSearch } = modules.activeSearch;
const { createPreferences } = modules.preferenceServices;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexer;
const { WorkspaceWriteHistory } = modules.workspaceWrites;
const { ThemePreview } = modules.themePreview;

/** `count` notes, each a heading tagged #project/atlas. */
function createIndex(count, { dated = false } = {}) {
  const files = Array.from({ length: count }, (_, number) => {
    const filePath = `notes/note-${String(number).padStart(3, '0')}.md`;
    return parseMarkdown(
      filePath,
      `# Note ${number} #project/atlas\nBody ${number}.`,
      // Dated, each note is newer than the one before it.
      dated ? { createdAt: 1 + number, updatedAt: 2 + number } : { createdAt: 1, updatedAt: 2 },
      {},
    );
  });
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

/**
 * Opens the sidebar beside the first note, which every other note shares a
 * tag with, and mounts the sidebar's own page against the real host.
 */
async function openSidebar(noteCount, options) {
  const index = createIndex(noteCount, options);
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
  const preferences = createPreferences(createGlobalState());
  const sidebarView = new SidebarNotesView({
    indexer,
    extensionUri: { fsPath: '/ext' },
    preferences,
    activeSearch: new ActiveSearch(),
    onOpenTag: () => undefined,
    extensionVersion: '0.0.0-test',
    history: new WorkspaceWriteHistory(),
    themePreview: new ThemePreview(),
  });
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
  const sidebarView = new SidebarNotesView({
    indexer,
    extensionUri: { fsPath: '/ext' },
    preferences: createPreferences(createGlobalState()),
    activeSearch: new ActiveSearch(),
    onOpenTag: () => undefined,
    extensionVersion: '0.0.0-test',
    history: new WorkspaceWriteHistory(),
    themePreview: new ThemePreview(),
  });
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

test('changing Sort re-orders the list at once', async () => {
  const { view, close } = await openSidebar(6, { dated: true });
  try {
    const first = () => view.find('.note-list [data-file-path]').getAttribute('data-file-path');
    view.change(view.find('[data-action="set-related-notes-sort"]'), 'newest');
    await settle();
    assert.strictEqual(first(), 'notes/note-005.md', 'the newest note leads');
    assert.strictEqual(
      view.find('.related-notes-sort option[value="newest"]').selected,
      true,
      'and the select says so',
    );
    view.change(view.find('[data-action="set-related-notes-sort"]'), 'oldest');
    await settle();
    assert.strictEqual(first(), 'notes/note-001.md', 'the oldest leads');
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
    assert.ok(rows[0].getAttribute('data-tip').includes('6 notes · 0 tasks'));
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

/** A note that three others link to, two lines from one of them. */
async function openLinked() {
  const note = (filePath, content, updatedAt) =>
    parseMarkdown(filePath, content, { createdAt: 1, updatedAt }, {});
  const files = [
    note('notes/atlas.md', '# Atlas #project/atlas\nThe plan.', 1),
    note('notes/standup.md', '# Standup\n## Risks\n[[atlas]] depends on sign-off.\nThe vendor is late.\n## Decisions\nWe moved [[atlas]] to Q4.', 30),
    note('notes/old.md', '# Old\nSee [[atlas]].', 10),
  ];
  const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: (uri) => uri.fsPath,
    onDidUpdate: new vscode.EventEmitter().event,
  };
  vscode.window.activeTextEditor = {
    document: { uri: vscode.Uri.file('notes/atlas.md'), languageId: 'markdown' },
    selection: { active: { line: 0 } },
  };
  const sidebarView = new SidebarNotesView({
    indexer,
    extensionUri: { fsPath: '/ext' },
    preferences: createPreferences(createGlobalState()),
    activeSearch: new ActiveSearch(),
    onOpenTag: () => undefined,
    extensionVersion: '0.0.0-test',
    history: new WorkspaceWriteHistory(),
    themePreview: new ThemePreview(),
  });
  const host = vscode._test.createWebviewView();
  host._onWebviewMessage = host._fromWebview;
  sidebarView.resolveWebviewView(host);
  const view = mountWebview(host.webview.html, host);
  host.posted.forEach((message) => host._deliver(message));
  const close = () => {
    sidebarView.dispose();
    vscode.window.activeTextEditor = undefined;
  };
  return { view, host, close };
}

test('Linked from groups its lines by note, newest first, and unfolds a line onto its section', async () => {
  const { view, host, close } = await openLinked();
  try {
    await settle();
    assert.strictEqual(view.find('[data-links-group="linked"] .links-count').textContent, '2', 'two notes');
    const heads = view.findAll('.link-group-open').map((button) => button.textContent);
    assert.deepStrictEqual(heads, ['standup', 'old']);
    assert.ok(view.find('.link-group-meta').textContent.includes('2 links'));
    assert.strictEqual(view.findAll('.link-group')[0].querySelectorAll('.link-row').length, 2);

    const expander = () => view.find('[data-action="toggle-link-section"]');
    assert.strictEqual(expander().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(expander().getAttribute('aria-label'), 'Show the rest of this section');
    view.click(expander());
    assert.strictEqual(expander().getAttribute('aria-expanded'), 'true');
    assert.ok(view.find('.link-section').textContent.includes('The vendor is late.'));

    // A redraw keeps the line unfolded.
    view.change(view.find('[data-action="set-related-notes-sort"]'), 'newest');
    await settle();
    assert.strictEqual(expander().getAttribute('aria-expanded'), 'true');

    const search = view.find('[data-action="open-links-search"]');
    assert.strictEqual(search.textContent, 'Open as search');
    vscode._test.executedCommands.length = 0;
    view.click(search);
    await settle();
    const ran = vscode._test.executedCommands.find((entry) => entry.command === 'deckard.search');
    assert.deepStrictEqual(ran && ran.args, ['link = [[atlas]]']);
    assert.ok(host);
  } finally {
    close();
  }
});

test('the gear sets Preview: None takes the excerpts away, and 2 lines brings them back', async () => {
  const { view, close } = await openSidebar(4);
  try {
    await settle();
    assert.strictEqual(view.findAll('.note-excerpt').length, 3, 'one line of each result by default');
    assert.strictEqual(view.find('.note-excerpt').textContent, 'Body 1.');
    view.click(view.find('[data-action="set-preview-lines"][data-value="0"]'));
    await settle();
    assert.strictEqual(view.findAll('.note-excerpt').length, 0);
    view.click(view.find('[data-action="set-preview-lines"][data-value="2"]'));
    await settle();
    assert.strictEqual(view.findAll('.note-excerpt').length, 3);
    assert.strictEqual(view.document.getElementById('app').dataset.previewLines, '2');
  } finally {
    close();
  }
});

test('a note with no tags lists entries worded like it, through the real host', async () => {
  const note = (filePath, content) => parseMarkdown(filePath, content, { createdAt: 1, updatedAt: 2 }, {});
  const files = [
    note('notes/today.md', '# Thursday\nThe northern route audit found Northwind late on deliveries again.'),
    note('notes/audit.md', '# Northwind audit #risk/vendor\nNorthwind deliveries on the northern route are late.'),
    note('notes/garden.md', '# Garden #hobby/garden\nTomatoes and beans.'),
  ];
  const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const indexer = { ready: Promise.resolve(), getSnapshot: () => index, getFilePath: (uri) => uri.fsPath, onDidUpdate: new vscode.EventEmitter().event };
  vscode.window.activeTextEditor = { document: { uri: vscode.Uri.file('notes/today.md'), languageId: 'markdown' }, selection: { active: { line: 0 } } };
  const sidebarView = new SidebarNotesView({
    indexer,
    extensionUri: { fsPath: '/ext' },
    preferences: createPreferences(createGlobalState()),
    activeSearch: new ActiveSearch(),
    onOpenTag: () => undefined,
    extensionVersion: '0.0.0-test',
    history: new WorkspaceWriteHistory(),
    themePreview: new ThemePreview(),
  });
  const host = vscode._test.createWebviewView();
  host._onWebviewMessage = host._fromWebview;
  sidebarView.resolveWebviewView(host);
  const view = mountWebview(host.webview.html, host);
  host.posted.forEach((message) => host._deliver(message));
  try {
    await settle();
    assert.ok(view.findAll('.section-label').some((label) => label.textContent === 'Similar wording (no tags yet)'));
    assert.deepStrictEqual(view.findAll('.similar-wording .note').map((card) => card.getAttribute('data-file-path')), ['notes/audit.md']);
    assert.deepStrictEqual(view.findAll('.suggested-tag [data-tag-key]').map((tag) => tag.getAttribute('data-tag-key')), ['#risk/vendor']);
  } finally {
    sidebarView.dispose();
    vscode.window.activeTextEditor = undefined;
  }
});

test('Hide daily notes leaves a daily note out of Linked from, and says so', async () => {
  const note = (filePath, content, updatedAt) =>
    parseMarkdown(filePath, content, { createdAt: 1, updatedAt }, {});
  const files = [
    note('notes/atlas.md', '# Atlas #project/atlas\nThe plan.', 1),
    note('notes/2026-09-24.md', '# Thursday #project/atlas\nSee [[atlas]].', 20),
    note('notes/budget.md', '# Budget #project/atlas\nSee [[atlas]].', 10),
  ];
  const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
  const indexer = { ready: Promise.resolve(), getSnapshot: () => index, getFilePath: (uri) => uri.fsPath, onDidUpdate: new vscode.EventEmitter().event };
  vscode.window.activeTextEditor = { document: { uri: vscode.Uri.file('notes/atlas.md'), languageId: 'markdown' }, selection: { active: { line: 0 } } };
  const preferences = createPreferences(createGlobalState());
  const sidebarView = new SidebarNotesView({
    indexer,
    extensionUri: { fsPath: '/ext' },
    preferences,
    activeSearch: new ActiveSearch(),
    onOpenTag: () => undefined,
    extensionVersion: '0.0.0-test',
    history: new WorkspaceWriteHistory(),
    themePreview: new ThemePreview(),
  });
  const host = vscode._test.createWebviewView();
  host._onWebviewMessage = host._fromWebview;
  sidebarView.resolveWebviewView(host);
  const view = mountWebview(host.webview.html, host);
  host.posted.forEach((message) => host._deliver(message));
  try {
    await settle();
    // The gear's Daily notes row: Show or Hide.
    const choice = (value) => view.find(`[data-action="set-hide-daily"][data-value="${value}"]`);
    assert.strictEqual(choice('hide').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(view.findAll('.link-group').length, 2);
    view.click(choice('hide'));
    await settle();
    assert.strictEqual(preferences.reader.value.hideDailyNotes, true);
    assert.strictEqual(choice('hide').getAttribute('aria-pressed'), 'true');
    assert.deepStrictEqual(view.findAll('.link-group-open').map((button) => button.textContent), ['budget']);
    assert.deepStrictEqual(view.findAll('.note-list [data-file-path]').map((card) => card.getAttribute('data-file-path')), ['notes/budget.md']);
    assert.ok(view.find('.links-hiding').textContent.startsWith('Hiding 1 daily note.'));
    view.click(view.find('[data-action="show-daily-notes"]'));
    await settle();
    assert.strictEqual(preferences.reader.value.hideDailyNotes, undefined);
    assert.strictEqual(view.findAll('.link-group').length, 2);
  } finally {
    sidebarView.dispose();
    vscode.window.activeTextEditor = undefined;
  }
});

