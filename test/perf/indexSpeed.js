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
const Module = require('node:module');
const { performance } = require('node:perf_hooks');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'out');
if (!fs.existsSync(out)) {
  console.error('Run "npm run compile-tests" first: out/ is missing.');
  process.exit(1);
}

const stubPath = path.join(root, 'test', 'e2e', 'vscodeStub.js');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? stubPath : resolve.call(this, request, ...rest);
};
const vscode = require(stubPath);
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
const { buildWorkspaceIndex, createWorkspaceIndex, WorkspaceIndexer } = load('indexer');
const { WorkspaceScanner } = load('scanner');
const { SearchStore } = load('searchStore');
const { setTimingLog } = load('timing');
const graphState = load('notesGraphState');
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

async function bench(size) {
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
  const rows = [];
  const row = (label, value) => rows.push([label, value]);
  console.log(`\n${size.toLocaleString('en-US')} notes, ${(bytes / 1048576).toFixed(1)} MB of Markdown`);

  // Parse and build, with nothing else in the way.
  const now = Date.UTC(2026, 8, 1);
  const files = new Map();
  row('Parse every note', ms(time(() => corpus.forEach(([name, text], i) =>
    files.set(`notes/${name}`, parseMarkdown(`notes/${name}`, text, {
      createdAt: now - i * 1e6,
      updatedAt: now - i * 1e5,
    })),
  ))));
  const builds = [0, 1, 2].map(() => time(() => buildWorkspaceIndex(new Map(files))));
  row('Full index build (median of 3)', ms(median(builds)));
  const index = buildWorkspaceIndex(new Map(files));

  // The Notes Graph.
  let graph;
  row('Notes Graph build', ms(time(() => { graph = graphState.createNotesGraphSnapshot(index); })));
  row('Notes Graph message, whole', mb(JSON.stringify(graph).length));
  if (graphState.toWire) {
    row('Notes Graph message, lighter edges', mb(JSON.stringify(graphState.toWire(graph, { notes: true, tasks: true })).length));
    row('Notes Graph message, tasks hidden', mb(JSON.stringify(graphState.toWire(graph, { notes: true, tasks: false })).length));
  } else {
    row('Notes Graph message, lighter edges', '—');
    row('Notes Graph message, tasks hidden', '—');
  }

  // The parsed-note cache's codec.
  if (codec.encodeParsedFile) {
    let encoded;
    row('Encode every parsed note', ms(time(() => { encoded = [...files.values()].map(codec.encodeParsedFile); })));
    row('Decode every parsed note', ms(time(() => encoded.map(codec.decodeParsedFile))));
    const encodedBytes = encoded.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    row('Cache size against the Markdown', `${(encodedBytes / bytes).toFixed(1)}×`);
  } else {
    row('Encode every parsed note', '—');
    row('Decode every parsed note', '—');
    row('Cache size against the Markdown', '—');
  }

  // A start over the real scanner and cache, cold, then one save at a time.
  const log = captureLog();
  setTimingLog?.(log);
  const cold = await startIndexer(folder, storage);
  row('Start, cold: first display', ms(cold.firstPublish));
  row('Start, cold: fresh', ms(cold.ready));
  // Saves are timed once the first build's cache is written, as in a session
  // that has settled.
  await cold.store?.whenIdle();

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
  row('Save: read, index, publish (median of 5)', ms(median(saves)));
  row('Save: index update alone (median of 5)', ms(median(updates.filter((value) => value !== undefined))));

  // A save that changes words inside a line, which the graph does not draw.
  if (graphState.graphInputsChanged) {
    const before = cold.indexer.getSnapshot();
    const name = corpus[3 % size][0];
    const file = path.join(notes, name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('lorem ipsum', 'lorem ipsum ipsum'));
    await save(cold, file);
    const after = cold.indexer.getSnapshot();
    let changed;
    row('Notes Graph check after a prose-only save', ms(time(() => { changed = graphState.graphInputsChanged(before, after); })) + (changed ? ' (redraws)' : ' (skipped)'));
  } else {
    row('Notes Graph check after a prose-only save', '—');
  }
  // A rescan, as a change to an exclude setting makes, and Reindex Workspace.
  let started = performance.now();
  await cold.indexer.refresh();
  row('Rescan, nothing changed', ms(performance.now() - started));
  started = performance.now();
  await cold.indexer.refresh({ reuse: 'none' });
  row('Reindex Workspace, every note reread', ms(performance.now() - started));
  await cold.store?.whenIdle();
  cold.indexer.dispose();

  // The same workspace again, as the next session opens it.
  const warm = await startIndexer(folder, storage);
  row('Start, warm: first display', ms(warm.firstPublish));
  row('Start, warm: fresh', ms(warm.ready));
  row('Start, warm: publishes', String(warm.publishes()));
  await warm.store?.whenIdle();
  warm.indexer.dispose();
  setTimingLog?.(undefined);

  const width = Math.max(...rows.map(([label]) => label.length));
  rows.forEach(([label, value]) => console.log(`  ${label.padEnd(width)}  ${value}`));
  fs.rmSync(folder, { recursive: true, force: true });
}

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

function listMarkdown(folder) {
  return fs.readdirSync(folder).filter((name) => name.endsWith('.md')).sort().map((name) => path.join(folder, name));
}

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

function time(run) {
  const started = performance.now();
  run();
  return performance.now() - started;
}

function median(values) {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function ms(value) {
  return Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : '—';
}

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
