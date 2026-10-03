import * as assert from 'assert';
// The fake file system's paths are a URI's, with forward slashes on every
// system, so the expected ones are built the same way.
import { posix as path } from 'path';

import { createPreferences } from './preferenceServices';
import { PreferenceSnapshots, SNAPSHOTS_KEPT } from '../core/storage/preferenceSnapshots';
import { FakeFileSystem, fileUri } from './fakeWorkspace';

/** A key-value store in memory, as a Memento is one. */
class MemoryStore {
  private readonly values = new Map<string, unknown>();

  /** The value under `key`, or `fallback`. */
  public get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  /** Keeps `value` under `key`. */
  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

suite('Preference snapshots through the file-system port', () => {
  const storage = fileUri('/storage/workspace');
  const folder = path.join(storage.fsPath, 'preference-snapshots');

  test('writes each copy as pretty JSON named by its time, in preference-snapshots under the storage folder', async () => {
    const files = new FakeFileSystem();
    const store = createPreferences(new MemoryStore());
    const snapshots = new PreferenceSnapshots(storage, store.reader, files);
    await store.favorites.toggleFavorite('#project/relay');
    await snapshots.writeNow();

    const written = [...files.files.keys()];
    assert.strictEqual(written.length, 1);
    assert.strictEqual(path.dirname(written[0]), folder);
    assert.match(path.basename(written[0]), /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
    assert.strictEqual(
      Buffer.from(files.files.get(written[0]) ?? []).toString('utf8'),
      JSON.stringify(store.reader.value, null, 2),
    );
    const [listed] = await snapshots.list();
    assert.strictEqual(listed.uri.fsPath, written[0]);
    assert.deepStrictEqual(await snapshots.read(listed), JSON.parse(JSON.stringify(store.reader.value)));
    snapshots.dispose();
    store.repository.dispose();
  });

  test('lists only its own copies, newest first, and keeps the last few', async () => {
    const files = new FakeFileSystem();
    const store = createPreferences(new MemoryStore());
    const snapshots = new PreferenceSnapshots(storage, store.reader, files);
    await files.createDirectory(fileUri(folder));
    await files.writeFile(fileUri(path.join(folder, 'notes.json')), Buffer.from('{}'));
    await files.createDirectory(fileUri(path.join(folder, '2026-01-01T00-00-00-000Z.json')));
    for (let i = 0; i < SNAPSHOTS_KEPT + 3; i += 1) {
      await store.usage.recordTagAccess('#project/relay', 1_000_000 + i);
      await snapshots.writeNow();
      // A copy is named by the millisecond, and memory is faster than that.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const all = await snapshots.list();
    assert.strictEqual(all.length, SNAPSHOTS_KEPT, 'a stray file and a folder are not copies');
    assert.ok(all.every((snapshot, index) => index === 0 || all[index - 1].at >= snapshot.at), 'newest first');
    assert.ok(files.files.has(path.join(folder, 'notes.json')), 'a stray file is left alone');
    snapshots.dispose();
    store.repository.dispose();
  });

  test('keeps two copies written in one millisecond, the later listed first', async () => {
    const files = new FakeFileSystem();
    const store = createPreferences(new MemoryStore());
    const at = new Date('2026-09-22T19:43:14.277Z');
    const snapshots = new PreferenceSnapshots(storage, store.reader, files, () => at);
    await store.favorites.toggleFavorite('#project/relay');
    await snapshots.writeNow();
    await store.favorites.toggleFavorite('#project/atlas');
    await snapshots.writeNow();
    await store.favorites.toggleFavorite('#project/mesh');
    await snapshots.writeNow();

    assert.deepStrictEqual(
      [...files.files.keys()].map((file) => path.basename(file)).sort(),
      ['2026-09-22T19-43-14-277Z-1.json', '2026-09-22T19-43-14-277Z-2.json', '2026-09-22T19-43-14-277Z.json'],
    );
    const listed = await snapshots.list();
    assert.deepStrictEqual(
      await Promise.all(listed.map(async (snapshot) => ((await snapshots.read(snapshot)) as { favoriteTags: string[] }).favoriteTags)),
      [['#project/relay', '#project/atlas', '#project/mesh'], ['#project/relay', '#project/atlas'], ['#project/relay']],
      'each copy kept, newest first',
    );
    assert.ok(listed.every((snapshot) => snapshot.at.getTime() === at.getTime()));
    snapshots.dispose();
    store.repository.dispose();
  });

  test('writes and lists nothing without a storage folder', async () => {
    const files = new FakeFileSystem();
    const store = createPreferences(new MemoryStore());
    const snapshots = new PreferenceSnapshots(undefined, store.reader, files);
    await store.favorites.toggleFavorite('#project/relay');
    await snapshots.writeNow();
    assert.deepStrictEqual(await snapshots.list(), []);
    assert.strictEqual(files.files.size + files.folders.size, 0);
    snapshots.dispose();
    store.repository.dispose();
  });
});
