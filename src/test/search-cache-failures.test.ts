import * as assert from 'assert';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SearchStore } from '../core/storage/searchStore';
import { parseMarkdown } from '../domain/markdown/parser';
import { createWorkspaceIndex } from '../core/workspace/indexer';
import { IndexService } from '../core/workspace/indexService';
import { WorkspaceScanner } from '../core/workspace/scanner';
import { setTimingLog } from '../shared/timing';
import { createFakeAccess, fakeFolder, joinUri } from './fakeWorkspace';

/** The error SQLite gives when the disk is full. */
function diskFull(): Error {
  return Object.assign(new Error('database or disk is full'), { code: 'ERR_SQLITE_ERROR', errcode: 13 });
}

/** Collects what is written to Deckard's log, until disposed. */
function captureLog(): { lines: string[]; dispose: () => void } {
  const lines: string[] = [];
  const write = (line: string) => lines.push(line);
  const registration = setTimingLog({
    logLevel: 2,
    trace: () => undefined,
    debug: () => undefined,
    info: write,
    error: write,
  });
  return { lines, dispose: () => registration.dispose() };
}

suite('The full-text cache failing to write', () => {
  test('a scan whose cache write fails still shows its notes, and says so in the log', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const note = joinUri(folder.uri, 'a.md');
    const scanner = new WorkspaceScanner(
      createFakeAccess({
        workspaceFolders: [folder],
        findFiles: async () => [note],
        readFile: async () => Buffer.from('# A #tag\n- [ ] task'),
      }),
    );
    const store = new SearchStore(undefined);
    store.replace = () => {
      throw diskFull();
    };
    const log = captureLog();
    const indexer = createWorkspaceIndex({ scanner, searchStore: store, schedule: (run) => run() });
    let updates = 0;
    indexer.onDidUpdate(() => {
      updates += 1;
    });
    try {
      await indexer.start();
      assert.ok(indexer.hasIndexed, 'the scan counts as done');
      assert.ok(updates > 0, 'the views hear of the notes');
      assert.deepStrictEqual([...indexer.getSnapshot().files.keys()], ['a.md']);
      assert.ok(
        log.lines.some((line) => line.includes('database or disk is full')),
        'the log says why the cache was not written',
      );
    } finally {
      log.dispose();
      indexer.dispose();
    }
  });

  test('a save whose cache write fails, or a deletion, still reaches the index', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const kept = joinUri(folder.uri, 'kept.md');
    const gone = joinUri(folder.uri, 'gone.md');
    const scanner = new WorkspaceScanner(
      createFakeAccess({
        workspaceFolders: [folder],
        findFiles: async () => [kept, gone],
        readFile: async () => Buffer.from('# Note\n- [ ] Saved task'),
      }),
    );
    const store = new SearchStore(undefined);
    let publishes = 0;
    const service = new IndexService(scanner, store, {
      publish: () => {
        publishes += 1;
      },
    });
    const log = captureLog();
    try {
      await service.start();
      store.upsert = () => {
        throw diskFull();
      };
      store.remove = () => {
        throw diskFull();
      };
      publishes = 0;
      await service.applyQueued([
        { uri: kept, deleted: false },
        { uri: gone, deleted: true },
      ]);
      assert.deepStrictEqual([...service.getSnapshot().files.keys()], ['kept.md']);
      assert.deepStrictEqual(service.getUnreadable(), [], 'a note read is not called unreadable');
      assert.strictEqual(publishes, 1, 'the views hear of the change');
      assert.ok(log.lines.some((line) => line.includes('database or disk is full')));
    } finally {
      log.dispose();
      service.dispose();
    }
  });
});

suite('Opening a search cache that cannot be used', () => {
  let base = '';
  setup(() => {
    base = mkdtempSync(join(tmpdir(), 'deckard-cache-open-'));
  });
  teardown(() => {
    chmodSync(base, 0o755);
    readdirSafe(base).forEach((name) => chmodSync(join(base, name), 0o755));
    rmSync(base, { recursive: true, force: true });
  });

  test('a damaged cache file is made again, and the log says so', () => {
    writeFileSync(join(base, 'deckard-search.sqlite'), Buffer.alloc(8192, 0x5a));
    const log = captureLog();
    let store: SearchStore | undefined;
    try {
      store = new SearchStore(base);
      store.replace([parseMarkdown('atlas.md', '# Atlas\nStaffing plan.', { updatedAt: 1 })]);
      assert.deepStrictEqual(store.search('staffing').map((match) => match.filePath), ['atlas.md']);
      assert.ok(log.lines.some((line) => line.includes('damaged') && line.includes('not a database')));
    } finally {
      store?.dispose();
      log.dispose();
    }
    const reopened = new SearchStore(base);
    try {
      assert.deepStrictEqual(
        reopened.search('staffing').map((match) => match.filePath),
        ['atlas.md'],
        'the cache made again is a file, kept for the next start',
      );
    } finally {
      reopened.dispose();
    }
  });

  test('a cache another connection holds for a moment is waited for, not given up for memory', async () => {
    const first = new SearchStore(base);
    first.replace([parseMarkdown('atlas.md', '# Atlas\nStaffing plan.', { updatedAt: 1 })]);
    await first.whenIdle();
    first.dispose();
    // Another connection, such as the worker of a session that is closing,
    // holds the cache file's lock for a moment, as closing it does.
    const holder = spawn(
      process.execPath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite');
        const database = new DatabaseSync(process.argv[1]);
        database.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
        process.stdout.write('held');
        setTimeout(() => { database.exec('COMMIT'); database.close(); }, 300);`,
        join(base, 'deckard-search.sqlite'),
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    );
    const exited = new Promise((resolve) => holder.on('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once('data', () => resolve());
      holder.once('error', reject);
    });
    const log = captureLog();
    let store: SearchStore | undefined;
    try {
      store = new SearchStore(base);
      assert.ok(!log.lines.some((line) => line.includes('kept in memory')), log.lines.join('\n'));
      assert.deepStrictEqual(
        store.search('staffing').map((match) => match.filePath),
        ['atlas.md'],
        'the notes the last session cached are there',
      );
    } finally {
      store?.dispose();
      log.dispose();
      await exited;
    }
  });

  test('a cache that cannot be opened is kept in memory, and the log says so', () => {
    // A folder where the cache file should be cannot be opened as one on
    // any system; a read-only folder can be written on Windows, which
    // ignores its mode.
    const folder = join(base, 'blocked');
    mkdirSync(join(folder, 'deckard-search.sqlite'), { recursive: true });
    const log = captureLog();
    let store: SearchStore | undefined;
    try {
      store = new SearchStore(folder);
      store.replace([parseMarkdown('atlas.md', '# Atlas\nStaffing plan.', { updatedAt: 1 })]);
      assert.deepStrictEqual(store.search('staffing').map((match) => match.filePath), ['atlas.md']);
      assert.ok(log.lines.some((line) => line.includes('kept in memory')));
    } finally {
      store?.dispose();
      log.dispose();
    }
  });
});

/** The names in a folder, or none when it is gone. */
function readdirSafe(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}
