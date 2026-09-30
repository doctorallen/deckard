import * as assert from 'assert';

import { PreferencesStore } from '../core/storage/preferences';
import type { PruneIndex } from '../core/storage/preferencesMaintenance';

class MemoryStore {
  private readonly values = new Map<string, unknown>();
  public writes = 0;

  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.writes += 1;
    this.values.set(key, value);
  }
}

/** An index snapshot holding the given keys, each mapped to nothing in particular. */
function indexOf(keys: { [K in keyof PruneIndex]?: string[] }): PruneIndex {
  const map = (list: string[] = []) => new Map(list.map((key) => [key, {}]));
  return {
    tags: map(keys.tags),
    tasks: map(keys.tasks),
    sections: map(keys.sections),
    entities: map(keys.entities),
    files: map(keys.files),
  };
}

/** A store with a little of everything pruning looks at. */
async function seeded(memory = new MemoryStore()): Promise<PreferencesStore> {
  const store = new PreferencesStore(memory);
  await store.recordTagAccess('#kept', 10);
  await store.recordTagAccess('#gone', 20);
  await store.recordEntityAccess('#person/ren');
  await store.recordSectionAccess('section-a1-b2', 30);
  await store.setTaskOrder(['task-c3-d4', 'task-gone-e5']);
  await store.recordFindChoice('kept', 'note:["a.md","A",0]', 40);
  await store.recordFindChoice('gone', 'note:["gone.md","G",0]', 50);
  await store.toggleFavorite('#gone');
  return store;
}

suite('Preferences maintenance', () => {
  test('prune(index) prunes as the five key lists of the same snapshot do', async () => {
    const index = indexOf({ tags: ['#kept'], tasks: ['task-c3-d4'], sections: [], entities: [], files: ['a.md'] });
    const byIndex = await seeded();
    const byKeys = await seeded();
    await byIndex.maintenance.prune(index, 60);
    await byKeys.prune(index.tags.keys(), index.tasks.keys(), index.sections.keys(), index.entities.keys(), index.files.keys(), 60);
    assert.deepStrictEqual(byIndex.value, byKeys.value);
    assert.deepStrictEqual(byIndex.value.tagAccessCounts, { '#kept': 1 });
    assert.deepStrictEqual(byIndex.value.taskOrder, ['task-c3-d4']);
    assert.deepStrictEqual(byIndex.value.sectionAccessCounts, {});
    assert.deepStrictEqual(byIndex.value.entityAccessCounts, {});
    assert.deepStrictEqual(byIndex.value.findChoices?.map((choice) => choice.input), ['kept']);
    assert.deepStrictEqual(byIndex.value.favoriteTags, ['#gone'], 'a favorite is a choice, not derived');
  });

  test('an index holding nothing prunes nothing and writes nothing', async () => {
    const memory = new MemoryStore();
    const store = await seeded(memory);
    const writes = memory.writes;
    const before = store.value;
    await store.maintenance.prune(indexOf({}));
    assert.strictEqual(memory.writes, writes);
    assert.deepStrictEqual(store.value, before);
  });

  test('keys left out of pruneKeys are not checked, and what is under them stays', async () => {
    const store = await seeded();
    await store.maintenance.pruneKeys({ tags: ['#kept'], tasks: [] }, 60);
    assert.deepStrictEqual(store.value.sectionAccessCounts, { 'section-a1-b2': 1 });
    assert.deepStrictEqual(store.value.entityAccessCounts, { '#person/ren': 1 });
    assert.strictEqual(store.value.findChoices?.length, 2, 'a note choice stays when files are not checked');
    assert.deepStrictEqual(store.value.taskOrder, []);
  });
});
