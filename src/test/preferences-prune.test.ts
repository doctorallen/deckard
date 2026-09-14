import * as assert from 'assert';

import { PreferencesStore } from '../core/storage/preferences';

class MemoryMemento {
  private readonly values = new Map<string, unknown>();
  public writes = 0;

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.writes += 1;
    this.values.set(key, value);
  }
}

suite('Preference pruning', () => {
  test('writes nothing when every stored key is still indexed', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);
    await store.recordTagAccess('#project/relay');
    await store.recordSectionAccess('relay-section');
    const writes = memento.writes;
    let changes = 0;
    store.onDidChange(() => {
      changes += 1;
    });

    // Every index update prunes; one that removes nothing must not make every
    // view refresh a second time.
    await store.prune(['#project/relay'], [], ['relay-section'], []);

    assert.strictEqual(memento.writes, writes);
    assert.strictEqual(changes, 0);
    assert.deepStrictEqual(store.value.tagAccessCounts, { '#project/relay': 1 });
  });

  test('still removes keys the index no longer has', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);
    await store.recordTagAccess('#project/relay');
    await store.recordTagAccess('#project/gone');
    let changes = 0;
    store.onDidChange(() => {
      changes += 1;
    });

    await store.prune(['#project/relay'], [], [], []);

    assert.strictEqual(changes, 1);
    assert.deepStrictEqual(store.value.tagAccessCounts, { '#project/relay': 1 });
  });
});
