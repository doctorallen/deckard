import * as assert from 'assert';

import { SearchStore } from '../core/storage/searchStore';
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
