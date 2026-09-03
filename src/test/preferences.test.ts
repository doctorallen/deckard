import * as assert from 'assert';

import { PreferencesStore } from '../core/storage/preferences';

class MemoryMemento {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

suite('Preferences store', () => {
  test('persists favorites and removes stale content references', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);

    assert.strictEqual(store.value.taskSortMode, 'rank');
    await store.toggleFavorite('case');
    await store.setTagSortMode('custom');
    await store.setTagOverviewSortMode('access');
    await store.setTagAccessOrder(['case', 'missing']);
    await store.recordTagAccess('case');
    await store.recordTagAccess('case');
    await store.recordTagAccess('missing');
    await store.setTaskOrder(['task-1', 'missing-task']);
    await store.setTaskSortMode('created');
    await store.recordSectionAccess('section-1');
    await store.recordSectionAccess('missing-section');
    await store.prune(['case'], ['task-1'], ['section-1']);

    assert.deepStrictEqual(store.value.favoriteTags, ['case']);
    assert.strictEqual(store.value.tagSortMode, 'custom');
    assert.strictEqual(store.value.tagOverviewSortMode, 'access');
    assert.deepStrictEqual(store.value.tagAccessOrder, ['case']);
    assert.deepStrictEqual(store.value.tagAccessCounts, { case: 2 });
    assert.deepStrictEqual(store.value.taskOrder, ['task-1']);
    assert.strictEqual(store.value.taskSortMode, 'created');
    assert.deepStrictEqual(store.value.sectionAccessCounts, { 'section-1': 1 });
    assert.deepStrictEqual(memento.get('deckard.preferences'), store.value);

    store.dispose();
  });

  test('updates tag order and favorite membership together', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);

    await store.setTagAccessOrderAndFavorites(['other', 'case'], ['other']);

    assert.deepStrictEqual(store.value.tagAccessOrder, ['other', 'case']);
    assert.deepStrictEqual(store.value.favoriteTags, ['other']);

    store.dispose();
  });
});
