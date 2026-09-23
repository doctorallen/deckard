import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import {
  dateFromName,
  nameFromDate,
  PreferenceSnapshots,
  SNAPSHOTS_KEPT,
} from '../core/storage/preferenceSnapshots';
import { PreferencesStore } from '../core/storage/preferences';
import {
  createExport,
  describePreferences,
  readExport,
} from '../ui/commands/preferenceBackups';

class MemoryMemento {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

suite('Preference backups', () => {
  let storage: vscode.Uri;

  setup(async () => {
    storage = vscode.Uri.file(
      path.join(os.tmpdir(), `deckard-snapshots-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    );
    await vscode.workspace.fs.createDirectory(storage);
  });

  teardown(async () => {
    await vscode.workspace.fs.delete(storage, { recursive: true, useTrash: false });
  });

  test('a snapshot name sorts by time and reads back as the time it was', () => {
    const at = new Date('2026-09-22T19:43:14.277Z');
    assert.strictEqual(nameFromDate(at), '2026-09-22T19-43-14-277Z');
    assert.strictEqual(dateFromName('2026-09-22T19-43-14-277Z.json').getTime(), at.getTime());
    assert.ok(Number.isNaN(dateFromName('notes.json').getTime()), 'a stray file is not a copy');
  });

  test('writes a copy of the store into workspace storage, newest first', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    const snapshots = new PreferenceSnapshots(storage, store);
    await store.toggleFavorite('#project/relay');
    await snapshots.writeNow();
    await store.pinNote({ filePath: 'notes/relay.md' });
    await snapshots.writeNow();

    const all = await snapshots.list();
    assert.strictEqual(all.length, 2);
    assert.ok(all[0].at.getTime() >= all[1].at.getTime(), 'newest first');
    const newest = readExport(await snapshots.read(all[0])).preferences;
    assert.deepStrictEqual(newest.favoriteTags, ['#project/relay']);
    assert.strictEqual(newest.pinnedNotes?.length, 1);
    snapshots.dispose();
    store.dispose();
  });

  test('keeps only the last few, and lets the oldest go', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    const snapshots = new PreferenceSnapshots(storage, store);
    for (let i = 0; i < SNAPSHOTS_KEPT + 5; i += 1) {
      await store.recordTagAccess('#project/relay', 1_000_000 + i);
      await snapshots.writeNow();
    }
    const all = await snapshots.list();
    assert.strictEqual(all.length, SNAPSHOTS_KEPT);
    snapshots.dispose();
    store.dispose();
  });

  test('writes nothing, and lists nothing, when there is no workspace storage', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    const snapshots = new PreferenceSnapshots(undefined, store);
    await store.toggleFavorite('#project/relay');
    await snapshots.writeNow();
    assert.deepStrictEqual(await snapshots.list(), []);
    snapshots.dispose();
    store.dispose();
  });

  test('an export wraps the store and reads back; a bare copy reads back too; junk is refused', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    await store.toggleFavorite('#project/relay');
    await store.saveSavedQueryFilter('Open', 'is:open');

    const exported = createExport(store.value, new Date('2026-09-22T10:00:00Z'));
    const back = readExport(JSON.parse(JSON.stringify(exported)));
    assert.deepStrictEqual(back.preferences.favoriteTags, ['#project/relay']);
    assert.strictEqual(back.exportedAt?.toISOString(), '2026-09-22T10:00:00.000Z');

    const bare = readExport(JSON.parse(JSON.stringify(store.value)));
    assert.deepStrictEqual(bare.preferences.favoriteTags, ['#project/relay']);
    assert.strictEqual(bare.exportedAt, undefined);

    for (const junk of [null, 'text', 42, [], {}, { deckard: { kind: 'other' } }, { version: 2 }]) {
      assert.throws(() => readExport(junk), /not a Deckard preferences file|does not hold preferences/);
    }
    assert.strictEqual(describePreferences(store.value), '1 favorite tag, 1 saved search');
    store.dispose();
  });

  test('importing replaces what the store holds, normalized, and tells the views', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    await store.toggleFavorite('#project/old');
    let told = 0;
    store.onDidChange(() => {
      told += 1;
    });

    await store.importPreferences({
      ...store.value,
      favoriteTags: ['#project/new'],
      // A hand-edited file: an unknown sort mode falls back rather than sticking.
      tagSortMode: 'sideways' as never,
    });

    assert.deepStrictEqual(store.value.favoriteTags, ['#project/new']);
    assert.strictEqual(store.value.tagSortMode, 'alphabetical');
    assert.strictEqual(told, 1);
    store.dispose();
  });
});
