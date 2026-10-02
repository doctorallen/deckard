// End-to-end: what each page's openSource and openTag may open, pinned
// against the hosts before Phase 6 moves them onto one NavigationService.
//
// Four pages decide differently which line of a note openSource may open:
// Home takes a task, an entry's heading, or line 1 of a note whose tags are
// all in its front matter; the Notes Graph takes those and line 1 of a note
// that only links; the Task Board takes a task alone; and Stats takes an
// entry's heading or any line of an indexed note. Home and Stats count a
// visit to the entry opened, the Graph and the Board never do. openTag is
// checked two ways: Stats and Home find the tag as the reader may have
// written it, the Task Board and the Graph only by its exact key.
//
// Each message goes in through the panel's webview, as the page posts it,
// so these hold whatever the hosts become.
const assert = require('assert');
const vscode = require('vscode');
const { createGlobalState } = require('./support.js');

// The stub has no editor, so one is made here that records where it was
// opened and how: the line revealed, and whether it previews or opens beside.
// It is in place before any module is loaded, since a compiled module copies
// the names it imports from \`vscode\` when it is first required.
const opened = [];
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Selection {
  constructor(anchor, active) {
    this.anchor = anchor;
    this.active = active;
  }
}
vscode.Position = Position;
vscode.Selection = Selection;
vscode.TextEditorRevealType = { InCenterIfOutsideViewport: 2 };
vscode.ViewColumn.Beside = -2;
vscode.workspace.openTextDocument = (uri) => Promise.resolve({ uri, lineCount: 40 });
vscode.window.showTextDocument = (document, options) => {
  const editor = {
    document,
    selection: undefined,
    revealRange: () => {
      opened.push({
        filePath: document.uri.fsPath,
        line: editor.selection.active.line + 1,
        preview: options.preview,
        beside: options.viewColumn === vscode.ViewColumn.Beside,
      });
    },
  };
  return Promise.resolve(editor);
};

const modules = require('../harness/modules.js');
const { StatsPanel } = modules.stats;
const { DashboardPanel } = modules.dashboard;
const { TaskBoardPanel } = modules.taskBoard;
const { NotesGraphPanel } = modules.notesGraph;
const { ActiveSearch } = modules.activeSearch;
const { createPreferences } = modules.preferenceServices;
const { ThemePreview } = modules.themePreview;
const { parseMarkdown } = modules.parser;
const { buildWorkspaceIndex } = modules.indexState;

// One note of each shape the rules tell apart, and one path no note has.
const NOTES = {
  // An entry at line 1, a plain line at 2, and a task at 3.
  atlas: ['/notes/atlas.md', '# Atlas #project/relay\nSome words about it.\n- [ ] Call the vendor\n'],
  // No entry; tagged in its front matter only. Line 4 is its text.
  tagged: ['/notes/tagged.md', '---\ntags: [relay]\n---\nOnly front matter tags.\n'],
  // No entry and no tag; one link.
  linking: ['/notes/linking.md', 'See [[atlas]] for more.\n'],
  // No entry, no tag, no link.
  plain: ['/notes/plain.md', 'Nothing to see here.\n'],
};
const MISSING = '/notes/missing.md';

function createIndex() {
  const files = Object.values(NOTES).map(([filePath, text]) => parseMarkdown(filePath, text));
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

/** Lets the host finish handling a message the page posted. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Opens one page against the fixture, and returns how to post to it as the
 * page would, the tags it opened, and the visits it counted.
 */
async function openPage(name) {
  vscode._test.createdPanels.length = 0;
  vscode._test.executedCommands.length = 0;
  const index = createIndex();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getUnreadable: () => [],
    getFilePath: (uri) => uri.fsPath,
    onDidUpdate: new vscode.EventEmitter().event,
  };
  const preferences = createPreferences(createGlobalState());
  const themePreview = new ThemePreview();
  const tags = [];
  const openTag = async (tagKey) => {
    tags.push(tagKey);
  };
  const pages = {
    stats: () => new StatsPanel({ indexer, preferences, extensionUri: vscode.Uri.file('/ext'), onOpenTag: openTag, themePreview }),
    home: () => new DashboardPanel({
      indexer,
      preferences,
      extensionUri: vscode.Uri.file('/ext'),
      navigation: { openTag, openSearch: () => undefined, openTaskBoard: () => undefined },
      writes: modules.taskWrites.createTaskWrites(),
      themePreview,
    }),
    board: () => new TaskBoardPanel({
      indexer,
      preferences,
      extensionUri: vscode.Uri.file('/ext'),
      openTag,
      activeSearch: new ActiveSearch(),
      writes: modules.taskWrites.createTaskWrites(),
      themePreview,
    }),
    graph: () => new NotesGraphPanel({ indexer, extensionUri: vscode.Uri.file('/ext'), onGraphContext: () => undefined, themePreview }),
  };
  const page = pages[name]();
  await page.show();
  const panel = vscode._test.createdPanels[vscode._test.createdPanels.length - 1];
  const post = async (message) => {
    opened.length = 0;
    tags.length = 0;
    vscode._test.executedCommands.length = 0;
    panel._onWebviewMessage(message);
    await settle();
  };
  // The Graph opens a tag's page by command rather than through a callback.
  const openedTags = () => [
    ...tags,
    ...vscode._test.executedCommands
      .filter((call) => call.command === 'deckard.showTagOverview')
      .map((call) => call.args[0]),
  ];
  const visits = () => ({ ...preferences.reader.value.sectionAccessCounts });
  return { page, post, openedTags, visits, index };
}

/** The id of the entry that starts at a line of a note. */
function entryAt(index, filePath, line) {
  return [...index.sections.values()].find((section) => section.filePath === filePath && section.startLine === line)?.id;
}

// Where an openSource lands on each page: the line it opens, or nothing; and
// whether the entry there counts a visit.
const [atlas, tagged, linking, plain] = [NOTES.atlas[0], NOTES.tagged[0], NOTES.linking[0], NOTES.plain[0]];
const SOURCES = [
  { name: 'an entry\'s heading', filePath: atlas, line: 1, home: 'visit', graph: 'open', board: 'none', stats: 'visit' },
  { name: 'a plain line of a note with entries', filePath: atlas, line: 2, home: 'none', graph: 'none', board: 'none', stats: 'open' },
  { name: 'a task', filePath: atlas, line: 3, home: 'open', graph: 'open', board: 'open', stats: 'open' },
  { name: 'line 1 of a note tagged in front matter only', filePath: tagged, line: 1, home: 'open', graph: 'open', board: 'none', stats: 'open' },
  { name: 'a later line of that note', filePath: tagged, line: 4, home: 'none', graph: 'none', board: 'none', stats: 'open' },
  { name: 'line 1 of a note that only links', filePath: linking, line: 1, home: 'none', graph: 'open', board: 'none', stats: 'open' },
  { name: 'line 1 of a note with no entry, tag, or link', filePath: plain, line: 1, home: 'none', graph: 'none', board: 'none', stats: 'open' },
  { name: 'a note the index does not have', filePath: MISSING, line: 1, home: 'none', graph: 'none', board: 'none', stats: 'none' },
];

for (const name of ['home', 'graph', 'board', 'stats']) {
  test(`${name}: openSource opens only the lines its rule accepts, and counts only an entry's visit`, async () => {
    const { page, post, visits, index } = await openPage(name);
    try {
      for (const source of SOURCES) {
        const before = visits();
        await post({ type: 'openSource', filePath: source.filePath, line: source.line });
        const expected = source[name] === 'none'
          ? []
          : [{ filePath: source.filePath, line: source.line, preview: true, beside: false }];
        assert.deepStrictEqual(opened, expected, `${source.name} on ${name}`);
        const entry = entryAt(index, source.filePath, source.line);
        const after = visits();
        if (source[name] === 'visit') {
          assert.strictEqual(after[entry], (before[entry] ?? 0) + 1, `${source.name} on ${name} counts a visit`);
        } else {
          assert.deepStrictEqual(after, before, `${source.name} on ${name} counts no visit`);
        }
      }
    } finally {
      page.dispose();
    }
  });

  test(`${name}: openSource opens beside the page, and keeps the tab, when asked`, async () => {
    const { page, post } = await openPage(name);
    try {
      // A task's line is the one line every page opens.
      await post({ type: 'openSource', filePath: atlas, line: 3, beside: true, pin: true });
      assert.deepStrictEqual(opened, [{ filePath: atlas, line: 3, preview: false, beside: true }]);
      await post({ type: 'openSource', filePath: atlas, line: 3, beside: false, pin: false });
      assert.deepStrictEqual(opened, [{ filePath: atlas, line: 3, preview: true, beside: false }]);
    } finally {
      page.dispose();
    }
  });
}

// The tag a page is asked for, as the reader may have written it, and what
// a page that finds it as written and one that needs the exact key open.
const TAGS = [
  { name: 'the exact key', tagKey: '#project/relay', lenient: '#project/relay', exact: '#project/relay' },
  { name: 'the key without its marker', tagKey: 'project/relay', lenient: '#project/relay', exact: undefined },
  { name: 'the key in other capitals', tagKey: '#Project/Relay', lenient: '#project/relay', exact: undefined },
  { name: 'the key with spaces around it', tagKey: ' #project/relay ', lenient: '#project/relay', exact: undefined },
  { name: 'a front-matter tag without its marker', tagKey: 'relay', lenient: '#relay', exact: undefined },
  { name: 'a tag the index does not have', tagKey: '#gone', lenient: undefined, exact: undefined },
];
const TAG_RULES = { stats: 'lenient', home: 'lenient', board: 'exact', graph: 'exact' };

for (const [name, rule] of Object.entries(TAG_RULES)) {
  test(`${name}: openTag opens a tag found ${rule === 'exact' ? 'only by its exact key' : 'as the reader wrote it'}`, async () => {
    const { page, post, openedTags } = await openPage(name);
    try {
      for (const tag of TAGS) {
        await post({ type: 'openTag', tagKey: tag.tagKey });
        assert.deepStrictEqual(openedTags(), tag[rule] ? [tag[rule]] : [], `${tag.name} on ${name}`);
      }
    } finally {
      page.dispose();
    }
  });
}
