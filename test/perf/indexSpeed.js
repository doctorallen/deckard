// Times Deckard's index at scale: parsing, a full build, what one save
// costs, the Notes Graph, the parsed-note cache, and a start cold and warm.
//
// Runs against the compiled sources in out/, with the e2e suite's vscode
// stub standing in for VS Code, over a seeded synthetic workspace written to
// a temporary folder: N notes, 600 tags in four namespaces, nested tagged
// headings, links, and dated tasks. The same seed gives the same notes, so
// two runs compare.
//
//   npm run bench:index                   1,000 and 5,000 notes
//   node test/perf/indexSpeed.js 2000     one size, after npm run compile-tests
//
// A step the code under test cannot do yet prints "—". This is not one of
// the test suites: nothing fails, it only reports.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'out');
if (!fs.existsSync(out)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}

const stubPath = path.join(root, 'test', 'e2e', 'vscodeStub.js');
const vscode = require(stubPath);
vscode.install();
extendStub(vscode);

const { pathOf } = require('../harness/modules.js');
// A module the code under test does not have yet comes back empty, so its
// step prints a dash rather than stopping the bench.
const load = (name) => {
  try {
    return require(pathOf(name));
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return {};
    }
    throw error;
  }
};
const { parseMarkdown } = load('parser');
const { buildWorkspaceIndex } = load('indexState');
const { createWorkspaceIndex, WorkspaceIndexer } = load('indexer');
const { WorkspaceScanner } = load('scanner');
const { SearchStore } = load('searchStore');
const { measure, setTimingLog } = load('timing');
// The graph is built and compared in domain/graph; what the page is sent is
// trimmed in ui/state.
const graphState = { ...load('graphBuild'), ...load('graphChanges'), ...load('notesGraphState') };
const codec = load('parsedFileCodec');

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);

// The cache's worker thread does not hold the process open, and while it
// writes nothing else may, so the run keeps itself alive until it is done.
const keepAlive = setInterval(() => undefined, 1000);
(async () => {
  for (const size of sizes.length > 0 ? sizes : [1000, 5000]) {
    await bench(size);
  }
  clearInterval(keepAlive);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Writes a corpus of a size, measures each step over it in turn, and prints
 * the timings as one table. Each step returns its [label, value] rows.
 */
async function bench(size) {
  const workspace = writeCorpus(size);
  console.log(`\n${size.toLocaleString('en-US')} notes, ${(workspace.bytes / 1048576).toFixed(1)} MB of Markdown`);
  const now = Date.UTC(2026, 8, 1);
  const build = benchBuild(workspace.corpus, now);
  const rows = [
    ...build.rows,
    ...benchGraph(build.index),
    ...benchSnapshots(build.index, now),
    ...benchCodec(build.files, workspace.bytes),
  ];

  // A start over the real scanner and cache, cold, then one save at a time.
  const log = captureLog();
  setTimingLog?.(log);
  const cold = await startIndexer(workspace.folder, workspace.storage);
  rows.push(['Start, cold: first display', ms(cold.firstPublish)], ['Start, cold: fresh', ms(cold.ready)]);
  // Saves are timed once the first build's cache is written, as in a session
  // that has settled.
  await cold.store?.whenIdle();
  rows.push(...await benchSaves(cold, workspace, log));
  rows.push(...await benchProseSave(cold, workspace));
  rows.push(...await benchRescans(cold));
  await cold.store?.whenIdle();
  cold.indexer.dispose();

  rows.push(...await benchWarmStart(workspace));
  setTimingLog?.(undefined);
  const width = Math.max(...rows.map(([label]) => label.length));
  rows.forEach(([label, value]) => console.log(`  ${label.padEnd(width)}  ${value}`));
  fs.rmSync(workspace.folder, { recursive: true, force: true });
}

/**
 * Writes a seeded corpus of a size to a new temporary folder: the notes, and
 * a storage folder beside them for the cache.
 */
function writeCorpus(size) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'deckard-bench-'));
  const notes = path.join(folder, 'notes');
  const storage = path.join(folder, 'storage');
  fs.mkdirSync(notes, { recursive: true });
  const corpus = generate(size);
  let bytes = 0;
  corpus.forEach(([name, text]) => {
    fs.writeFileSync(path.join(notes, name), text);
    bytes += Buffer.byteLength(text);
  });
  return { folder, notes, storage, corpus, bytes, size };
}

/** Parse and build, with nothing else in the way; returns the parsed notes and the index too. */
function benchBuild(corpus, now) {
  const files = new Map();
  const rows = [['Parse every note', ms(time(() => corpus.forEach(([name, text], i) =>
    files.set(`notes/${name}`, parseMarkdown(`notes/${name}`, text, {
      createdAt: now - i * 1e6,
      updatedAt: now - i * 1e5,
    })),
  )))]];
  const builds = [0, 1, 2].map(() => time(() => buildWorkspaceIndex(new Map(files))));
  rows.push(['Full index build (median of 3)', ms(median(builds))]);
  return { rows, files, index: buildWorkspaceIndex(new Map(files)) };
}

/** The Notes Graph: its build, and the size of the message that carries it. */
function benchGraph(index) {
  let graph;
  const rows = [['Notes Graph build', ms(time(() => { graph = graphState.createNotesGraphSnapshot(index); }))]];
  rows.push(['Notes Graph message, whole', mb(JSON.stringify(graph).length)]);
  if (!graphState.toWire) {
    return [...rows, ['Notes Graph message, lighter edges', '—'], ['Notes Graph message, tasks hidden', '—']];
  }
  return [
    ...rows,
    ['Notes Graph message, lighter edges', mb(JSON.stringify(graphState.toWire(graph, { notes: true, tasks: true })).length)],
    ['Notes Graph message, tasks hidden', mb(JSON.stringify(graphState.toWire(graph, { notes: true, tasks: false })).length)],
  ];
}

/** Each page's first snapshot, timed by the line its host or controller writes. */
function benchSnapshots(index, now) {
  return [
    // The Stats page's snapshot, timed by the line its host writes, which
    // decides whether the page's HTML carries it (docs/implementation/
    // 20-webviews.md, Q3: under 50 ms, it is embedded).
    ['Stats snapshot (median of 5)', ms(timeStatsSnapshot(index, now))],
    // Both calendars' snapshots, timed by the Calendar line their controller
    // writes, for the same rule: the sidebar's month, and the page's month
    // with its day panel.
    ['Calendar snapshot, sidebar (median of 5)', ms(timeCalendarSnapshot(index, now, {}))],
    ['Calendar snapshot, page (median of 5)', ms(timeCalendarSnapshot(index, now, { layout: 'page', dayPanel: true }))],
    ['Task Board snapshot (median of 5)', ms(timeTaskBoardSnapshot(index, now))],
    // The Notes Graph's whole-workspace snapshot, timed by the Notes Graph
    // line its controller writes, for the same rule.
    ['Notes Graph snapshot (median of 5)', ms(timeGraphSnapshot(index))],
    // A search page's snapshot, on the page a tag opens and on a search of
    // every note, timed by the line its host writes ("Search page").
    ['Search page snapshot, one tag (median of 5)', ms(timeSearchPageSnapshot(index, now, '#project/t0'))],
    ['Search page snapshot, every note (median of 5)', ms(timeSearchPageSnapshot(index, now, ''))],
    // Home's snapshot with the widgets it starts with, timed by the line its
    // host writes ("Dashboard"), for the same rule.
    ['Dashboard snapshot, Home (median of 5)', ms(timeDashboardSnapshot(index, now))],
    // Related Notes' snapshot for a note, timed by the line its host writes
    // ("Related Notes"): the note's related entries ranked over the whole
    // workspace, and what links to it.
    ['Related Notes snapshot (median of 5)', ms(timeRelatedNotesSnapshot(index, now, 'notes/n0.md'))],
  ];
}

/** The parsed-note cache's codec: encoding, decoding, and the size against the Markdown. */
function benchCodec(files, bytes) {
  if (!codec.encodeParsedFile) {
    return [['Encode every parsed note', '—'], ['Decode every parsed note', '—'], ['Cache size against the Markdown', '—']];
  }
  let encoded;
  const rows = [['Encode every parsed note', ms(time(() => { encoded = [...files.values()].map(codec.encodeParsedFile); }))]];
  rows.push(['Decode every parsed note', ms(time(() => encoded.map(codec.decodeParsedFile)))]);
  const encodedBytes = encoded.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  rows.push(['Cache size against the Markdown', `${(encodedBytes / bytes).toFixed(1)}×`]);
  return rows;
}

/** Five saves, each adding a tag to a heading, timed whole and by the index update alone. */
async function benchSaves(cold, { corpus, notes, size }, log) {
  const saves = [];
  const updates = [];
  for (let i = 0; i < 5; i += 1) {
    const name = corpus[(i * 7919) % size][0];
    const file = path.join(notes, name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^# (.*)$/m, `# $1 #topic/t${(i * 4 + 1) % 600}`));
    log.lines.length = 0;
    saves.push(await save(cold, file));
    updates.push(readTiming(log.lines, ['Update index', 'Build index']));
  }
  return [
    ['Save: read, index, publish (median of 5)', ms(median(saves))],
    ['Save: index update alone (median of 5)', ms(median(updates.filter((value) => value !== undefined)))],
  ];
}

/** A save that changes words inside a line, which the graph does not draw. */
async function benchProseSave(cold, { corpus, notes, size }) {
  if (!graphState.graphInputsChanged) {
    return [['Notes Graph check after a prose-only save', '—']];
  }
  const before = cold.indexer.getSnapshot();
  const name = corpus[3 % size][0];
  const file = path.join(notes, name);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('lorem ipsum', 'lorem ipsum ipsum'));
  await save(cold, file);
  const after = cold.indexer.getSnapshot();
  let changed;
  return [['Notes Graph check after a prose-only save', ms(time(() => { changed = graphState.graphInputsChanged(before, after); })) + (changed ? ' (redraws)' : ' (skipped)')]];
}

/** A rescan, as a change to an exclude setting makes, and Reindex Workspace. */
async function benchRescans(cold) {
  let started = performance.now();
  await cold.indexer.refresh();
  const rows = [['Rescan, nothing changed', ms(performance.now() - started)]];
  started = performance.now();
  await cold.indexer.refresh({ reuse: 'none' });
  rows.push(['Reindex Workspace, every note reread', ms(performance.now() - started)]);
  return rows;
}

/** The same workspace again, as the next session opens it. */
async function benchWarmStart({ folder, storage }) {
  const warm = await startIndexer(folder, storage);
  const rows = [
    ['Start, warm: first display', ms(warm.firstPublish)],
    ['Start, warm: fresh', ms(warm.ready)],
    ['Start, warm: publishes', String(warm.publishes())],
  ];
  await warm.store?.whenIdle();
  warm.indexer.dispose();
  return rows;
}

/**
 * Starts an indexer over a folder's notes with the real scanner and the
 * cache in `storage`, and times its first publish and the moment it is
 * fresh.
 */
async function startIndexer(folder, storage) {
  const workspaceFolder = { uri: vscode.Uri.file(folder), name: 'bench', index: 0 };
  // The workspace's ports; the settings are the stub's, which leaves every
  // one at its default.
  const access = {
    workspaceFolders: [workspaceFolder],
    findFiles: async () => listMarkdown(path.join(folder, 'notes')).map((file) => vscode.Uri.file(file)),
    asRelativePath: (uri, includeWorkspaceFolder) => vscode.workspace.asRelativePath(uri, includeWorkspaceFolder),
    getConfiguration: (...args) => vscode.workspace.getConfiguration(...args),
    joinPath: (base, ...segments) => vscode.Uri.joinPath(base, ...segments),
    readFile: (uri) => fs.promises.readFile(uri.fsPath),
    stat: async (uri) => {
      const stat = await fs.promises.stat(uri.fsPath);
      return { type: 1, ctime: Math.round(stat.ctimeMs), mtime: Math.round(stat.mtimeMs), size: stat.size };
    },
  };
  const store = SearchStore ? await openStore(storage) : undefined;
  const scanner = new WorkspaceScanner(access);
  // A save reaches the index as the editor reports one, and the index reads
  // a save of Deckard's own back at once. An older checkout's indexer took
  // it straight into the change queue it held.
  const saves = new vscode.EventEmitter();
  const indexer = createWorkspaceIndex
    ? createWorkspaceIndex({
      scanner,
      searchStore: store,
      readCache: true,
      version: 'bench',
      events: createEvents(saves),
      ownWrites: { take: () => true },
    })
    : new WorkspaceIndexer(scanner, store, { readCache: true, version: 'bench' });
  const saveNote = createWorkspaceIndex
    ? (uri) => saves.fire({ uri })
    : (uri) => indexer.watcher.queueUpsert(uri, undefined, true);
  let publishes = 0;
  let firstPublish;
  const started = performance.now();
  indexer.onDidUpdate(() => {
    publishes += 1;
    firstPublish ??= performance.now() - started;
  });
  await indexer.start();
  const ready = performance.now() - started;
  return { indexer, saveNote, store, firstPublish: firstPublish ?? ready, ready, publishes: () => publishes };
}

/** The workspace's events, of which only saves ever fire. */
function createEvents(saves) {
  const never = () => ({ dispose: () => undefined });
  return {
    onDidChangeConfiguration: never,
    onDidChangeWorkspaceFolders: never,
    onDidSaveTextDocument: saves.event,
    createFileSystemWatcher: () => ({
      onDidCreate: never,
      onDidChange: never,
      onDidDelete: never,
      dispose: () => undefined,
    }),
  };
}

/** Opens the cache, waiting out a worker the last session is still closing. */
async function openStore(storage) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return createStore(storage);
    } catch (error) {
      if (attempt >= 50 || !/locked/.test(String(error && error.message))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/**
 * The store over the folder at `storage`, which takes it as a path; an
 * older checkout's took a Uri, and says so by refusing the path.
 */
function createStore(storage) {
  try {
    return new SearchStore(storage);
  } catch (error) {
    if (error && error.code === 'ERR_INVALID_ARG_TYPE') {
      return new SearchStore(vscode.Uri.file(storage));
    }
    throw error;
  }
}

/** Saves a note as Deckard's own save reports it, and waits for the publish. */
async function save(session, file) {
  const started = performance.now();
  const published = new Promise((resolve) => {
    const subscription = session.indexer.onDidUpdate(() => {
      subscription.dispose();
      resolve();
    });
  });
  session.saveNote(vscode.Uri.file(file));
  await published;
  return performance.now() - started;
}

/**
 * The median of five builds of the Stats page's snapshot over `index`, each
 * read from the `Stats` line `measure` writes, as the page's host times it.
 * An older checkout without the state builder prints a dash.
 */
function timeStatsSnapshot(index, now) {
  const { createDeckardStatsSnapshot } = load('statsState');
  const { createPreferences } = load('preferenceServices');
  if (!createDeckardStatsSnapshot || !createPreferences || !measure) {
    return NaN;
  }
  const values = new Map();
  const preferences = createPreferences({
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key, value) => void values.set(key, value),
  }).reader.value;
  const log = captureLog();
  setTimingLog(log);
  const timings = [0, 1, 2, 3, 4].map(() => {
    log.lines.length = 0;
    measure('Stats', () => createDeckardStatsSnapshot(index, preferences, [], now));
    return readTiming(log.lines, ['Stats']);
  });
  setTimingLog(undefined);
  return median(timings.filter((value) => value !== undefined));
}

/**
 * The median of five builds of a calendar's snapshot over `index`, for the
 * month `now` is in, each read from the `Calendar` line `measure` writes, as
 * the calendars' controller times it. `options` are the page's, or none for
 * the sidebar's. An older checkout without the state builder prints a dash.
 */
function timeCalendarSnapshot(index, now, options) {
  const { createCalendar } = load('calendarState');
  const { createQueryContext } = load('queryContext');
  if (!createCalendar || !createQueryContext || !measure) {
    return NaN;
  }
  const month = new Date(now).toISOString().slice(0, 7);
  const log = captureLog();
  setTimingLog(log);
  const timings = [0, 1, 2, 3, 4].map(() => {
    log.lines.length = 0;
    measure('Calendar', () => createCalendar(index, month, createQueryContext(now), { showRepeats: true, showWeekends: true, ...options }));
    return readTiming(log.lines, ['Calendar']);
  });
  setTimingLog(undefined);
  return median(timings.filter((value) => value !== undefined));
}

/**
 * The Task Board's snapshot, on the search it opens with, `is:open`, drawn as
 * a board, timed by the line its host writes ("Task board"), which decides
 * whether the page's HTML carries it (docs/implementation/20-webviews.md,
 * Q3: under 50 ms, it is embedded).
 */
function timeTaskBoardSnapshot(index, now) {
  const { createTaskBoard } = load('taskBoardState');
  const { createQueryContext } = load('queryContext');
  const { createPreferences } = load('preferenceServices');
  if (!createTaskBoard || !createQueryContext || !createPreferences || !measure) {
    return NaN;
  }
  const values = new Map();
  const preferences = createPreferences({
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key, value) => void values.set(key, value),
  }).reader.value;
  // The host's options when nothing is configured: deckard.board.statuses,
  // its namespace, and the emoji task format.
  const options = { queryContext: createQueryContext(now), format: 'emoji', limits: {} };
  const log = captureLog();
  setTimingLog(log);
  const timings = [0, 1, 2, 3, 4].map(() => {
    log.lines.length = 0;
    measure('Task board', () => createTaskBoard({ index, preferences, search: { query: 'is:open' }, options, tagTitleDisplayMode: 'inline' }));
    return readTiming(log.lines, ['Task board']);
  });
  setTimingLog(undefined);
  return median(timings.filter((value) => value !== undefined));
}

/**
 * The median of five builds of the Notes Graph's whole-workspace snapshot
 * over `index`, each read from the `Notes Graph` line `measure` writes, as
 * the graph's controller times it. An older checkout without the state
 * builder prints a dash.
 */
function timeGraphSnapshot(index) {
  if (!graphState.createNotesGraphSnapshot || !measure) {
    return NaN;
  }
  const log = captureLog();
  setTimingLog(log);
  const timings = [0, 1, 2, 3, 4].map(() => {
    log.lines.length = 0;
    measure('Notes Graph', () => graphState.createNotesGraphSnapshot(index), (graph) => `${graph.nodes.length} nodes`);
    return readTiming(log.lines, ['Notes Graph']);
  });
  setTimingLog(undefined);
  return median(timings.filter((value) => value !== undefined));
}

/**
 * A search page's snapshot for `query`, as its host builds it with nothing
 * configured, timed by the line the host writes ("Search page"), which
 * decides whether the page's HTML carries it (docs/implementation/
 * 20-webviews.md, Q3: under 50 ms, it is embedded).
 */
function timeSearchPageSnapshot(index, now, query) {
  const { createSearchPageSnapshot } = load('searchPageState');
  const { createQueryContext } = load('queryContext');
  const { createPreferences } = load('preferenceServices');
  if (!createSearchPageSnapshot || !createQueryContext || !createPreferences || !measure) {
    return NaN;
  }
  const values = new Map();
  const preferences = createPreferences({
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key, value) => void values.set(key, value),
  }).reader.value;
  // The host's options when nothing is configured.
  const options = {
    queryContext: createQueryContext(now),
    originQuery: query,
    tagTitleDisplayMode: 'inline',
    notePage: 1,
    taskPage: 1,
    previewWords: [],
    includeHubLinks: true,
    enableHeadingTagRelationships: true,
  };
  const log = captureLog();
  setTimingLog(log);
  const timings = [0, 1, 2, 3, 4].map(() => {
    log.lines.length = 0;
    measure('Search page', () => createSearchPageSnapshot(index, preferences, query, options));
    return readTiming(log.lines, ['Search page']);
  });
  setTimingLog(undefined);
  return median(timings.filter((value) => value !== undefined));
}

/**
 * Home's snapshot, as its host builds it with nothing configured: the tags,
 * the tiles, and the widgets Home starts with, timed by the line the host
 * writes ("Dashboard"), which decides whether the page's HTML carries it
 * (docs/implementation/20-webviews.md, Q3: under 50 ms, it is embedded).
 * The host's line also times the post, which a bench has no page to make,
 * so this is the least that line can say.
 */
function timeDashboardSnapshot(index, now) {
  const { createDashboardSnapshot } = load('dashboardState');
  const { createDashboardWidgets } = load('dashboardWidgets');
  const { createQueryContext } = load('queryContext');
  const { createPreferences } = load('preferenceServices');
  if (!createDashboardSnapshot || !createDashboardWidgets || !createQueryContext || !createPreferences || !measure) {
    return NaN;
  }
  const values = new Map();
  const preferences = createPreferences({
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    keys: () => [...values.keys()],
    update: async (key, value) => void values.set(key, value),
  }).reader.value;
  const log = captureLog();
  setTimingLog(log);
  const timings = [0, 1, 2, 3, 4].map(() => {
    log.lines.length = 0;
    measure('Dashboard', () => {
      // One moment for the whole page, as the host reads it once.
      const queryContext = createQueryContext(now);
      return {
        ...createDashboardSnapshot({ index, preferences, tagTitleDisplayMode: 'inline', agendaQuery: '', queryContext }),
        widgets: createDashboardWidgets(index, preferences, { queryContext, upcomingDays: 7, agendaQuery: '', tagTitleDisplayMode: 'inline' }),
      };
    });
    return readTiming(log.lines, ['Dashboard']);
  });
  setTimingLog(undefined);
  return median(timings.filter((value) => value !== undefined));
}

/**
 * Related Notes' snapshot for the note at `filePath`, as its host builds it
 * for the note in the editor with nothing configured: the ranking, and what
 * links to the note. Timed by the line the host writes ("Related Notes"),
 * which decides whether the view's HTML carries it (docs/implementation/
 * 20-webviews.md, Q3: under 50 ms, it is embedded).
 */
function timeRelatedNotesSnapshot(index, now, filePath) {
  const { createSidebarSnapshot } = load('relatedNotesRanking');
  const { collectNoteLinks } = load('noteLinks');
  const file = index.files.get(filePath);
  if (!createSidebarSnapshot || !collectNoteLinks || !file || !measure) {
    return NaN;
  }
  const options = {
    now,
    enableKeywordLinks: true,
    relatedNotesSortMode: 'tags',
    sectionAccessCounts: {},
    tagTitleDisplayMode: 'inline',
    rankingOptions: { associationMinimumSupport: 1, recencyHalfLifeDays: 0, hidePeriodicNotes: false, excludedTagNamespaces: ['status'] },
  };
  const log = captureLog();
  setTimingLog(log);
  const timings = [0, 1, 2, 3, 4].map(() => {
    log.lines.length = 0;
    measure('Related Notes', () => ({
      ...createSidebarSnapshot(index, filePath, file, options),
      links: collectNoteLinks(index, file, { now, hideDailyNotes: false }),
    }), (snapshot) => `${snapshot.notes.length} results`);
    return readTiming(log.lines, ['Related Notes']);
  });
  setTimingLog(undefined);
  return median(timings.filter((value) => value !== undefined));
}

/** The seeded workspace: N notes, 600 tags, nested tagged headings, links, tasks. */
function generate(size) {
  const tags = Array.from({ length: 600 }, (_, i) => ['#project/', '#topic/', '#area/', '@'][i % 4] + 't' + i);
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (values) => values[Math.floor(random() * values.length)];
  const corpus = [];
  for (let i = 0; i < size; i += 1) {
    const lines = [];
    if (random() < 0.2) {
      lines.push('---', `tags: [${pick(tags).replace(/^#/, '')}]`, `aliases: [Alias ${i}]`, '---');
    }
    lines.push(`# Note ${i} ${pick(tags)} ${pick(tags)}`);
    lines.push(`Some body text about [[Note ${Math.floor(random() * size)}]] and ideas ${pick(tags)}`);
    for (let h = 0; h < 3; h += 1) {
      lines.push(`## Heading ${h} ${pick(tags)}`);
      lines.push('Paragraph words lorem ipsum dolor sit amet consectetur '.repeat(4));
      if (random() < 0.3) {
        lines.push(`### Detail ${h} ${pick(tags)}`, `More about [[Note ${Math.floor(random() * size)}]].`);
      }
      const due = random() < 0.3 ? ` 📅 2026-09-${String(10 + Math.floor(random() * 20)).padStart(2, '0')}` : '';
      lines.push(`- [ ] Task ${i}.${h} ${pick(tags)}${due}`);
      lines.push(`- [x] Done ${i}.${h}`);
    }
    corpus.push([`n${i}.md`, lines.join('\n') + '\n']);
  }
  return corpus;
}

/** The Markdown files in a folder, by path, in name order. */
function listMarkdown(folder) {
  return fs.readdirSync(folder).filter((name) => name.endsWith('.md')).sort().map((name) => path.join(folder, name));
}

/** A timing log that keeps every line it is given, for readTiming. */
function captureLog() {
  const lines = [];
  const push = (line) => lines.push(line);
  return { logLevel: 2, lines, trace: () => undefined, debug: push, info: push, error: push };
}

/** The milliseconds a timing line reports for the first of `operations` found. */
function readTiming(lines, operations) {
  for (const operation of operations) {
    const line = lines.find((entry) => entry.replace(/^Slow: /, '').startsWith(`${operation}:`));
    if (line) {
      return Number(/: ([\d.]+) ms/.exec(line)[1]);
    }
  }
  return undefined;
}

/** How many milliseconds a function takes to run. */
function time(run) {
  const started = performance.now();
  run();
  return performance.now() - started;
}

/** The middle value, the upper of the two for an even count, or NaN for none. */
function median(values) {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Milliseconds as the table prints them, or a dash for a step that could not run. */
function ms(value) {
  return Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : '—';
}

/** A length in bytes as megabytes. */
function mb(length) {
  return `${(length / 1048576).toFixed(1)} MB`;
}

/**
 * File URIs, and what the indexer read from VS Code before it had ports,
 * beyond what the e2e stub has. The indexer now reads none of it, but an
 * older checkout does, and the bench compares against one.
 */
function extendStub(api) {
  const event = () => new api.EventEmitter().event;
  api.Uri.file = (value) => ({
    scheme: 'file',
    fsPath: value,
    path: value,
    toString: () => `file://${value}`,
  });
  api.Uri.joinPath = (base, ...parts) => api.Uri.file(path.join(base.fsPath, ...parts));
  api.RelativePattern = class {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  };
  api.ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
  api.ExtensionMode = { Production: 1, Development: 2, Test: 3 };
  api.window.withProgress = (_options, task) => task({ report: () => undefined });
  api.workspace.onDidChangeWorkspaceFolders = event();
  api.workspace.createFileSystemWatcher = () => ({
    onDidCreate: event(),
    onDidChange: event(),
    onDidDelete: event(),
    dispose: () => undefined,
  });
}
