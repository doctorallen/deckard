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
import { createPreferences } from './preferenceServices';
import { createVscodeWorkspace } from '../platform/vscodeWorkspace';
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
    assert.strictEqual(dateFromName('2026-09-22T19-43-14-277Z-2.json').getTime(), at.getTime(), 'a second copy of the millisecond');
  });

  test('writes a copy of the store into workspace storage, newest first', async () => {
    const store = createPreferences(new MemoryMemento());
    const snapshots = new PreferenceSnapshots(storage, store.reader, createVscodeWorkspace());
    await store.favorites.toggleFavorite('#project/relay');
    await snapshots.writeNow();
    await store.pins.pinNote({ filePath: 'notes/relay.md' });
    await snapshots.writeNow();

    const all = await snapshots.list();
    assert.strictEqual(all.length, 2);
    assert.ok(all[0].at.getTime() >= all[1].at.getTime(), 'newest first');
    const newest = readExport(await snapshots.read(all[0])).preferences;
    assert.deepStrictEqual(newest.favoriteTags, ['#project/relay']);
    assert.strictEqual(newest.pinnedNotes?.length, 1);
    snapshots.dispose();
    store.repository.dispose();
  });

  test('keeps only the last few, and lets the oldest go', async () => {
    const store = createPreferences(new MemoryMemento());
    const snapshots = new PreferenceSnapshots(storage, store.reader, createVscodeWorkspace());
    for (let i = 0; i < SNAPSHOTS_KEPT + 5; i += 1) {
      await store.usage.recordTagAccess('#project/relay', 1_000_000 + i);
      await snapshots.writeNow();
    }
    const all = await snapshots.list();
    assert.strictEqual(all.length, SNAPSHOTS_KEPT);
    snapshots.dispose();
    store.repository.dispose();
  });

  test('writes nothing, and lists nothing, when there is no workspace storage', async () => {
    const store = createPreferences(new MemoryMemento());
    const snapshots = new PreferenceSnapshots(undefined, store.reader, createVscodeWorkspace());
    await store.favorites.toggleFavorite('#project/relay');
    await snapshots.writeNow();
    assert.deepStrictEqual(await snapshots.list(), []);
    snapshots.dispose();
    store.repository.dispose();
  });

  test('an export wraps the store and reads back; a bare copy reads back too; junk is refused', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.favorites.toggleFavorite('#project/relay');
    await store.savedSearches.saveSavedQueryFilter('Open', 'is:open');

    const exported = createExport(store.reader.value, new Date('2026-09-22T10:00:00Z'));
    const back = readExport(JSON.parse(JSON.stringify(exported)));
    assert.deepStrictEqual(back.preferences.favoriteTags, ['#project/relay']);
    assert.strictEqual(back.exportedAt?.toISOString(), '2026-09-22T10:00:00.000Z');

    const bare = readExport(JSON.parse(JSON.stringify(store.reader.value)));
    assert.deepStrictEqual(bare.preferences.favoriteTags, ['#project/relay']);
    assert.strictEqual(bare.exportedAt, undefined);

    for (const junk of [null, 'text', 42, [], {}, { deckard: { kind: 'other' } }, { version: 2 }]) {
      assert.throws(() => readExport(junk), /not a Deckard preferences file|does not hold preferences/);
    }
    assert.strictEqual(describePreferences(store.reader.value), '1 favorite tag, 1 saved search');
    store.repository.dispose();
  });

  test('importing replaces what the store holds, normalized, and tells the views', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.favorites.toggleFavorite('#project/old');
    let told = 0;
    store.reader.onDidChange(() => {
      told += 1;
    });

    await store.maintenance.importPreferences({
      ...store.reader.value,
      favoriteTags: ['#project/new'],
      // A hand-edited file: an unknown sort mode falls back rather than sticking.
      tagSortMode: 'sideways' as never,
    });

    assert.deepStrictEqual(store.reader.value.favoriteTags, ['#project/new']);
    assert.strictEqual(store.reader.value.tagSortMode, 'alphabetical');
    assert.strictEqual(told, 1);
    store.repository.dispose();
  });
});
