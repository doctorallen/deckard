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
  importPreferences,
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

suite('Importing preferences', () => {
  /**
   * Stands in for the reader importing `file`: the open dialog picks it, the
   * modal is answered Replace, and every message is kept in `said`, with
   * the modal's detail in `details`; until `restore` puts VS Code back.
   */
  function importing(file: unknown) {
    const said: string[] = [];
    const details: string[] = [];
    const answer = async (text: string, options?: { detail?: string }) => {
      said.push(text);
      if (options?.detail) {
        details.push(options.detail);
      }
      return text.startsWith('Replace ') ? 'Replace' : undefined;
    };
    const window = vscode.window as unknown as Record<string, unknown>;
    const workspace = vscode.workspace as unknown as Record<string, unknown>;
    const replaced: [Record<string, unknown>, string, unknown][] = [
      [window, 'showOpenDialog', async () => [vscode.Uri.file('/imports/deckard-preferences.json')]],
      [window, 'showWarningMessage', answer],
      [window, 'showInformationMessage', answer],
      [window, 'showErrorMessage', answer],
      [workspace, 'fs', { readFile: async () => Buffer.from(JSON.stringify(file), 'utf8') }],
    ];
    const kept = replaced.map(([owner, key]) => Object.getOwnPropertyDescriptor(owner, key));
    replaced.forEach(([owner, key, value]) =>
      Object.defineProperty(owner, key, { configurable: true, get: () => value }),
    );
    const restore = () =>
      replaced.forEach(([owner, key], at) => {
        const descriptor = kept[at];
        if (descriptor) {
          Object.defineProperty(owner, key, descriptor);
        } else {
          delete owner[key];
        }
      });
    return { said, details, restore };
  }

  test('a file that leaves lists out is described, and imported, as the lists it has', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.pins.pinNote({ filePath: 'notes/relay.md' });
    for (const file of [
      { version: 1, favoriteTags: ['#project/atlas'] },
      { deckard: { kind: 'preferences', version: 1 }, preferences: { favoriteTags: ['#project/atlas'] } },
    ]) {
      assert.strictEqual(describePreferences(readExport(file).preferences), '1 favorite tag');
      const reader = importing(file);
      try {
        await importPreferences(store);
      } finally {
        reader.restore();
      }
      assert.strictEqual(reader.said[0], 'Replace what this workspace remembers with the file /imports/deckard-preferences.json?');
      assert.match(reader.details[0], /^It holds 1 favorite tag\. /);
      assert.deepStrictEqual(store.reader.value.favoriteTags, ['#project/atlas']);
      assert.deepStrictEqual(store.reader.value.pinnedNotes ?? [], [], 'a list the file leaves out is emptied');
      await store.pins.pinNote({ filePath: 'notes/relay.md' });
    }
    store.repository.dispose();
  });
});
