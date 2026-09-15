import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  PreferencesStore,
  RECENT_QUERY_LIMIT,
} from '../core/storage/preferences';
import { frecencyScore } from '../ui/state/frecency';

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as
      | T
      | undefined;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

suite('What search remembers', () => {
  test('keeps recent searches newest first, without duplicates', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    await store.recordRecentQuery('#project/atlas is:open');
    await store.recordRecentQuery('vendor');
    await store.recordRecentQuery('  #project/atlas is:open  ');
    await store.recordRecentQuery('   ');

    assert.deepStrictEqual(store.value.recentQueries, [
      '#project/atlas is:open',
      'vendor',
    ]);
  });

  test('keeps only the most recent searches', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    for (let index = 0; index < RECENT_QUERY_LIMIT + 5; index += 1) {
      await store.recordRecentQuery(`query ${index}`);
    }

    assert.strictEqual(store.value.recentQueries?.length, RECENT_QUERY_LIMIT);
    assert.strictEqual(store.value.recentQueries?.[0], `query ${RECENT_QUERY_LIMIT + 4}`);
  });

  test('records when a tag or entry was last opened, and forgets deleted ones', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    await store.recordTagAccess('#project/atlas', 1000);
    await store.recordTagAccess('#project/gone', 2000);
    await store.recordSectionAccess('section-1', 3000);

    assert.deepStrictEqual(store.value.tagAccessTimes, {
      '#project/atlas': 1000,
      '#project/gone': 2000,
    });
    assert.deepStrictEqual(store.value.sectionAccessTimes, { 'section-1': 3000 });

    await store.prune(['#project/atlas'], [], ['section-1'], []);
    assert.deepStrictEqual(store.value.tagAccessTimes, { '#project/atlas': 1000 });
  });

  test('moves a renamed tag’s last-opened time to its new name', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    await store.recordTagAccess('#project/apollo', 5000);
    await store.replaceTagKey('#project/apollo', '#project/atlas');

    assert.deepStrictEqual(store.value.tagAccessTimes, { '#project/atlas': 5000 });
  });

  test('ranks something opened recently above something opened often long ago', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    const yesterday = frecencyScore(1, now - day, now);
    const habitLastMonth = frecencyScore(20, now - 60 * day, now);
    const habitThisWeek = frecencyScore(20, now - 2 * day, now);

    assert.ok(yesterday > habitLastMonth);
    assert.ok(habitThisWeek > yesterday);
    assert.strictEqual(frecencyScore(0, undefined, now), 0);
  });
});
