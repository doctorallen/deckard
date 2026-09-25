import * as assert from 'assert';

import { pinKey, PreferencesStore } from '../core/storage/preferences';

/**
 * A property, not an example: over any sequence of the store's operations,
 * a favorite, a pin, or a saved search is removed only by the call that
 * names it. Every other mutator, and every prune against any index — full,
 * partial, empty, or one that mentions none of them — leaves them alone.
 *
 * Deckard once had a prune that deleted all of them whenever an index did
 * not mention them, and 650 example tests passed for many releases with it
 * in. An example checks the cases someone thought of; this walks the ones
 * nobody did. The seed is in the failure message, so a walk that fails is
 * a walk that can be run again.
 */

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

/** mulberry32: small, seedable, and good enough to walk a state space. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a reader chose, as the walk expects the store to hold it. */
interface Chosen {
  tags: Set<string>;
  entities: Set<string>;
  pins: Set<string>;
  filters: Set<string>;
}

const TAGS = ['#project/atlas', '#project/relay', '#risk/vendor', '#topic/mesh', '#team/wardens', '#follow-up'];
const ENTITIES = ['#person/ren', '#person/dax', '#org/lantern'];
const FILES = ['notes/a.md', 'notes/b.md', 'notes/c.md', 'notes/d.md'];
const SORT_MODES = ['alphabetical', 'count', 'access', 'custom'] as const;

function chosenIn(store: PreferencesStore): Chosen {
  const value = store.value;
  return {
    tags: new Set(value.favoriteTags),
    entities: new Set(value.favoriteEntities),
    pins: new Set((value.pinnedNotes ?? []).map(pinKey)),
    filters: new Set(value.savedFilters.map((filter) => filter.id)),
  };
}

function assertChosen(store: PreferencesStore, expected: Chosen, where: string): void {
  const actual = chosenIn(store);
  for (const kind of ['tags', 'entities', 'pins', 'filters'] as const) {
    assert.deepStrictEqual(
      [...actual[kind]].sort(),
      [...expected[kind]].sort(),
      `${where}: ${kind} the reader chose changed without being asked`,
    );
  }
}

/**
 * One step that is not a removal. It may add a chosen item, in which case
 * the model learns it; it may prune against any index at all; it may do any
 * of the things Deckard does to derived state. It never calls a removal.
 */
async function step(
  store: PreferencesStore,
  model: Chosen,
  next: () => number,
): Promise<string> {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const some = <T,>(items: readonly T[]): T[] => items.filter(() => next() < 0.5);
  const action = Math.floor(next() * 12);
  switch (action) {
    case 0: {
      const tag = pick(TAGS);
      if (!model.tags.has(tag)) {
        await store.toggleFavorite(tag);
        model.tags.add(tag);
        return `favorite ${tag}`;
      }
      return 'skip';
    }
    case 1: {
      const entity = pick(ENTITIES);
      if (!model.entities.has(entity)) {
        await store.toggleFavoriteEntity(entity);
        model.entities.add(entity);
        return `favorite ${entity}`;
      }
      return 'skip';
    }
    case 2: {
      if (model.pins.size >= 5) {return 'skip';}
      const pin = next() < 0.5
        ? { filePath: pick(FILES) }
        : { filePath: pick(FILES), heading: pick(['Plan', 'Decision', 'Notes']) };
      if (model.pins.has(pinKey(pin))) {return 'skip';}
      await store.pinNote(pin);
      model.pins.add(pinKey(pin));
      return `pin ${pinKey(pin)}`;
    }
    case 3: {
      const [a, b] = [pick(TAGS), pick(TAGS)];
      if (a === b) {return 'skip';}
      const saved = await store.saveSavedFilter(`Search ${Math.floor(next() * 1000)}`, [a, b]);
      if (saved) {model.filters.add(saved.id);}
      return `save tag-set search ${a} ${b}`;
    }
    case 4: {
      const saved = await store.saveSavedQueryFilter(`Query ${Math.floor(next() * 1000)}`, `tag = ${pick(TAGS)}`);
      if (saved) {model.filters.add(saved.id);}
      return 'save query search';
    }
    case 5:
      await store.recordTagAccess(pick(TAGS), 1_000_000 + Math.floor(next() * 1000));
      return 'record tag access';
    case 6:
      await store.recordEntityAccess(pick(ENTITIES));
      return 'record entity access';
    case 7:
      await store.recordSectionAccess(pick(['s1', 's2', 's3']), 1_000_000);
      return 'record section access';
    case 8:
      await store.setTaskOrder(some(['t1', 't2', 't3', 't4']));
      return 'set task order';
    case 9:
      await store.setTagSortMode(pick(SORT_MODES));
      return 'set sort mode';
    case 10:
      await store.setTagAccessOrder(some(TAGS));
      return 'set tag access order';
    default: {
      // Any index at all: full, partial, empty, or one with none of the
      // reader's tags in it. This is the case that once deleted everything.
      const tags = next() < 0.2 ? [] : some(TAGS);
      const entities = next() < 0.2 ? [] : some(ENTITIES);
      const files = next() < 0.2 ? [] : some(FILES);
      await store.prune(tags, some(['t1', 't2']), some(['s1', 's2']), entities, files, 2_000_000);
      return `prune against ${tags.length} tags, ${files.length} files`;
    }
  }
}

suite('Preference invariants', () => {
  test('nothing the reader chose is removed by anything but a removal', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const next = random(seed);
      const store = new PreferencesStore(new MemoryMemento());
      const model: Chosen = { tags: new Set(), entities: new Set(), pins: new Set(), filters: new Set() };
      const trail: string[] = [];
      for (let i = 0; i < 60; i += 1) {
        trail.push(await step(store, model, next));
        assertChosen(store, model, `seed ${seed}, step ${i} (${trail.slice(-3).join(' → ')})`);
      }
      store.dispose();
    }
  });

  test('a removal removes exactly what it names, and nothing else', async () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const next = random(seed * 7919);
      const store = new PreferencesStore(new MemoryMemento());
      const model: Chosen = { tags: new Set(), entities: new Set(), pins: new Set(), filters: new Set() };
      for (let i = 0; i < 40; i += 1) {await step(store, model, next);}

      // Each kind of removal, one item at a time, against the model.
      for (const tag of [...model.tags]) {
        await store.toggleFavorite(tag);
        model.tags.delete(tag);
        assertChosen(store, model, `seed ${seed}, after unfavoriting ${tag}`);
      }
      for (const pin of [...model.pins]) {
        await store.unpinNote(pin);
        model.pins.delete(pin);
        assertChosen(store, model, `seed ${seed}, after unpinning`);
      }
      for (const id of [...model.filters]) {
        await store.removeSavedFilter(id);
        model.filters.delete(id);
        assertChosen(store, model, `seed ${seed}, after removing a search`);
      }
      store.dispose();
    }
  });

  test('tidying removes only what points nowhere, and everything it said it would', async () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const next = random(seed * 104729);
      const store = new PreferencesStore(new MemoryMemento());
      const model: Chosen = { tags: new Set(), entities: new Set(), pins: new Set(), filters: new Set() };
      for (let i = 0; i < 40; i += 1) {await step(store, model, next);}

      const keepTags = TAGS.filter(() => next() < 0.5);
      const keepEntities = ENTITIES.filter(() => next() < 0.5);
      const keepFiles = FILES.filter(() => next() < 0.5);
      const stale = store.findStale(keepTags, keepEntities, keepFiles);
      await store.removeStale(stale);

      const after = chosenIn(store);
      for (const tag of after.tags) {assert.ok(keepTags.includes(tag), `seed ${seed}: kept a favorite the index lacks: ${tag}`);}
      for (const entity of after.entities) {assert.ok(keepEntities.includes(entity), `seed ${seed}: kept an entity the index lacks`);}
      for (const pin of store.value.pinnedNotes ?? []) {assert.ok(keepFiles.includes(pin.filePath), `seed ${seed}: kept a pin whose note is gone`);}
      for (const tag of stale.favoriteTags) {assert.ok(!after.tags.has(tag), `seed ${seed}: said it would remove ${tag} and did not`);}
      // What was not stale is exactly what is left.
      const expectedTags = [...model.tags].filter((tag) => keepTags.includes(tag)).sort();
      assert.deepStrictEqual([...after.tags].sort(), expectedTags, `seed ${seed}: tidy touched a favorite it should not have`);
      store.dispose();
    }
  });

  test('operations in one workspace never reach another', async () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const next = random(seed * 31337);
      const global = new MemoryMemento();
      const a = new PreferencesStore(global, new MemoryMemento());
      const b = new PreferencesStore(global, new MemoryMemento());
      await a.initialize();
      await b.initialize();
      const modelA: Chosen = { tags: new Set(), entities: new Set(), pins: new Set(), filters: new Set() };
      const modelB: Chosen = { tags: new Set(), entities: new Set(), pins: new Set(), filters: new Set() };
      for (let i = 0; i < 50; i += 1) {
        if (next() < 0.5) {await step(a, modelA, next);}
        else {await step(b, modelB, next);}
        assertChosen(a, modelA, `seed ${seed}, step ${i}, workspace A`);
        assertChosen(b, modelB, `seed ${seed}, step ${i}, workspace B`);
      }
      a.dispose();
      b.dispose();
    }
  });
});
