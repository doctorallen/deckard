import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SearchStore } from '../core/storage/searchStore';
import { WorkspaceIndexer } from '../core/workspace/indexer';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import { WorkspaceScanner } from '../core/workspace/scanner';
import { FileType } from '../ports/fileSystem';
import type { ResourceUri } from '../ports/uri';
import { createFakeAccess, fakeFolder, joinUri } from './fakeWorkspace';
import { normalizeIndex } from './normalizeIndex';

/** A workspace in memory whose notes a test changes between sessions. */
function createWorkspace() {
  const folder = fakeFolder('/tmp/deckard-warm', 'w');
  const texts = new Map<string, string>([
    ['a.md', '# A #project/atlas\n- [ ] Call #person/dana'],
    ['b.md', '# B #project/atlas #topic/maps\n## Child #topic/detail'],
    ['c.md', '---\ntags: [area/home]\n---\nNo headings.'],
    ['d.md', '# D #topic/maps'],
  ]);
  const times = new Map<string, number>([...texts.keys()].map((name) => [name, 1000]));
  const nameOf = (uri: ResourceUri) => uri.path.split('/').pop() ?? '';
  const counts = { reads: 0 };
  const access = createFakeAccess({
    workspaceFolders: [folder],
    findFiles: async () => [...texts.keys()].map((name) => joinUri(folder.uri, name)),
    readFile: async (uri) => {
      counts.reads += 1;
      return Buffer.from(texts.get(nameOf(uri)) ?? '', 'utf8');
    },
    stat: async (uri) => ({
      type: FileType.File,
      ctime: 1,
      mtime: times.get(nameOf(uri)) ?? 0,
      size: Buffer.byteLength(texts.get(nameOf(uri)) ?? '', 'utf8'),
    }),
  });
  return { texts, times, counts, access };
}

interface Session {
  indexer: WorkspaceIndexer;
  store: SearchStore;
  /** For each publish: whether it was stale, and how many reads came before it. */
  publishes: Array<{ stale: boolean; reads: number }>;
}

function openSession(
  directory: string,
  workspace: ReturnType<typeof createWorkspace>,
  options: { version?: string; readCache?: boolean; excluded?: string } = {},
): Session {
  const scanner = new WorkspaceScanner(workspace.access);
  if (options.excluded) {
    const isNotesFile = scanner.isNotesFile.bind(scanner);
    scanner.isNotesFile = (uri) => !uri.path.endsWith(`/${options.excluded}`) && isNotesFile(uri);
    const findFiles = workspace.access.findFiles;
    workspace.access.findFiles = async (...args) =>
      (await findFiles(...args)).filter((uri) => !uri.path.endsWith(`/${options.excluded}`));
  }
  const store = new SearchStore(directory);
  const indexer = new WorkspaceIndexer(scanner, store, {
    version: options.version ?? '1.0.0',
    readCache: options.readCache ?? true,
  });
  const publishes: Session['publishes'] = [];
  indexer.onDidUpdate(() =>
    publishes.push({ stale: indexer.isStale, reads: workspace.counts.reads }),
  );
  return { indexer, store, publishes };
}

/** The index as a fresh cold build of the same notes would be. */
function assertFresh(indexer: WorkspaceIndexer): void {
  const index = indexer.getSnapshot();
  assert.deepStrictEqual(
    normalizeIndex(index),
    normalizeIndex(buildWorkspaceIndex(new Map(index.files))),
  );
}

suite('Starting from the cache', () => {
  let directory: string;
  setup(() => {
    directory = mkdtempSync(join(tmpdir(), 'deckard-warm-'));
  });
  teardown(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test('shows the cached notes before reading any, then checks them without a second publish', async () => {
    const workspace = createWorkspace();
    const first = openSession(directory, workspace);
    await first.indexer.start();
    assert.deepStrictEqual(first.publishes, [{ stale: false, reads: 4 }], 'a cold start reads every note');
    const cold = normalizeIndex(first.indexer.getSnapshot());
    first.indexer.dispose();

    workspace.counts.reads = 0;
    const second = openSession(directory, workspace);
    const ready = second.indexer.start();
    await second.indexer.published;
    assert.deepStrictEqual(second.publishes, [{ stale: true, reads: 0 }], 'published before any read');
    assert.strictEqual(second.indexer.isStale, true);
    assert.deepStrictEqual(second.indexer.getLastScan(), { found: 4, templates: 0, excluded: 0, read: 4 });
    await ready;
    assert.strictEqual(second.indexer.isStale, false);
    assert.strictEqual(workspace.counts.reads, 0, 'no unchanged note is read');
    assert.strictEqual(second.publishes.length, 1, 'nothing changed, nothing more published');
    assert.deepStrictEqual(normalizeIndex(second.indexer.getSnapshot()), cold);
    second.indexer.dispose();
  });

  test('rereads only what changed while closed, in one more publish', async () => {
    const workspace = createWorkspace();
    const first = openSession(directory, workspace);
    await first.indexer.start();
    first.indexer.dispose();

    workspace.texts.set('a.md', '# A changed #project/atlas #topic/new');
    workspace.times.set('a.md', 2000);
    workspace.texts.delete('b.md');
    workspace.texts.set('e.md', '# E #topic/maps');
    workspace.times.set('e.md', 3000);
    workspace.counts.reads = 0;

    const second = openSession(directory, workspace);
    await second.indexer.start();
    assert.strictEqual(workspace.counts.reads, 2, 'the changed note and the new one');
    assert.deepStrictEqual(second.publishes.map((publish) => publish.stale), [true, false]);
    const index = second.indexer.getSnapshot();
    assert.deepStrictEqual([...index.files.keys()].sort(), ['a.md', 'c.md', 'd.md', 'e.md']);
    assert.ok(index.tags.has('#topic/new'));
    assert.strictEqual(index.tags.has('#topic/detail'), false, 'the deleted note is gone');
    assertFresh(second.indexer);
    second.indexer.dispose();
  });

  test('leaves out a note excluded while closed', async () => {
    const workspace = createWorkspace();
    const first = openSession(directory, workspace);
    await first.indexer.start();
    first.indexer.dispose();

    const second = openSession(directory, workspace, { excluded: 'b.md' });
    const ready = second.indexer.start();
    await second.indexer.published;
    assert.strictEqual(second.indexer.getSnapshot().files.has('b.md'), false, 'not even while stale');
    await ready;
    assert.strictEqual(second.indexer.getSnapshot().files.has('b.md'), false);
    assertFresh(second.indexer);
    second.indexer.dispose();
  });

  test('starts cold after an update to Deckard, and when told not to read the cache', async () => {
    const workspace = createWorkspace();
    const first = openSession(directory, workspace);
    await first.indexer.start();
    first.indexer.dispose();

    workspace.counts.reads = 0;
    const updated = openSession(directory, workspace, { version: '1.1.0' });
    await updated.indexer.start();
    assert.deepStrictEqual(updated.publishes, [{ stale: false, reads: 4 }]);
    updated.indexer.dispose();

    workspace.counts.reads = 0;
    const developing = openSession(directory, workspace, { version: '1.1.0', readCache: false });
    await developing.indexer.start();
    assert.deepStrictEqual(developing.publishes, [{ stale: false, reads: 4 }]);
    developing.indexer.dispose();
  });
});
