import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { createPreferences } from './preferenceServices';

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
  test('carries task order and view counts from the ids before 1.23 to the ids now', async () => {
    const file = parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Call Ren\n- [ ] Book travel');
    const section = file.sections[0].id;
    const [call, book] = file.tasks.map((task) => task.id);
    const legacy = (id: string) => id.slice(0, id.lastIndexOf('-'));
    const store = createPreferences(new MemoryMemento());
    await store.taskLayout.setTaskOrder([legacy(book), legacy(call), 'task-gone']);
    await store.usage.recordSectionAccess(legacy(section));
    await store.usage.recordSectionAccess(legacy(section));

    await store.maintenance.pruneKeys({ tags: ['#project/atlas'], tasks: [call, book], sections: [section], entities: [] });

    assert.deepStrictEqual(store.reader.value.taskOrder, [book, call], 'the order is kept, the lost id pruned');
    assert.deepStrictEqual(store.reader.value.sectionAccessCounts, { [section]: 2 });
    assert.ok(store.reader.value.sectionAccessTimes?.[section], 'and when it was last opened');
  });

  test('writes nothing when every stored key is still indexed', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);
    await store.usage.recordTagAccess('#project/relay');
    await store.usage.recordSectionAccess('relay-section');
    // The first prune learns which tags the index already has.
    await store.maintenance.pruneKeys({ tags: ['#project/relay'], tasks: [], sections: ['relay-section'], entities: [] });
    const writes = memento.writes;
    let changes = 0;
    store.reader.onDidChange(() => {
      changes += 1;
    });

    // Every index update prunes; one that removes nothing must not make every
    // view refresh a second time.
    await store.maintenance.pruneKeys({ tags: ['#project/relay'], tasks: [], sections: ['relay-section'], entities: [] });

    assert.strictEqual(memento.writes, writes);
    assert.strictEqual(changes, 0);
    assert.deepStrictEqual(store.reader.value.tagAccessCounts, { '#project/relay': 1 });
  });

  test('keeps everything when the index holds nothing at all', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);
    await store.favorites.toggleFavorite('#project/relay');
    await store.usage.recordTagAccess('#project/relay');
    await store.usage.recordSectionAccess('relay-section');
    await store.pins.pinNote({ filePath: 'notes/relay.md', heading: 'Relay' });
    const writes = memento.writes;

    // What a window with no folder open reports, which is the state VS Code
    // is in while a VSIX is installed from the Extensions view. The store is
    // global, so pruning against it used to empty every workspace's
    // favorites, view counts and pins at once.
    await store.maintenance.pruneKeys({ tags: [], tasks: [], sections: [], entities: [], files: [] });

    assert.deepStrictEqual(store.reader.value.favoriteTags, ['#project/relay']);
    assert.deepStrictEqual(store.reader.value.tagAccessCounts, { '#project/relay': 1 });
    assert.deepStrictEqual(store.reader.value.sectionAccessCounts, { 'relay-section': 1 });
    assert.strictEqual(store.reader.value.pinnedNotes?.length, 1);
    assert.strictEqual(memento.writes, writes, 'and it writes nothing');

    // An index that holds something is authoritative again for what Deckard
    // derived: a count for a tag it no longer has goes. What the reader chose
    // stays, whatever the index says.
    await store.maintenance.pruneKeys({ tags: ['#project/other'], tasks: [], sections: ['other-section'], entities: [], files: ['notes/other.md'] });
    assert.deepStrictEqual(store.reader.value.tagAccessCounts, {});
    assert.deepStrictEqual(store.reader.value.favoriteTags, ['#project/relay']);
    assert.strictEqual(store.reader.value.pinnedNotes?.length, 1);
  });

  test('never removes a favorite, a pin, or a saved search on its own', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.favorites.toggleFavorite('#project/relay');
    await store.favorites.toggleFavoriteEntity('#person/ren');
    await store.pins.pinNote({ filePath: 'notes/relay.md', heading: 'Relay' });
    await store.savedSearches.saveSavedFilter('Both', ['#project/relay', '#risk/vendor']);
    await store.savedSearches.saveSavedQueryFilter('Query', 'is:open');

    // Nothing in the index matches any of it.
    await store.maintenance.pruneKeys({ tags: ['#other'], tasks: [], sections: ['other-section'], entities: ['#person/other'], files: ['notes/other.md'] });

    assert.deepStrictEqual(store.reader.value.favoriteTags, ['#project/relay']);
    assert.deepStrictEqual(store.reader.value.favoriteEntities, ['#person/ren']);
    assert.strictEqual(store.reader.value.pinnedNotes?.length, 1);
    assert.strictEqual(store.reader.value.savedFilters.length, 2);
  });

  test('says what points nowhere, and removes only that when asked', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.favorites.toggleFavorite('#project/relay');
    await store.favorites.toggleFavorite('#project/gone');
    await store.favorites.toggleFavoriteEntity('#person/ren');
    await store.pins.pinNote({ filePath: 'notes/relay.md', heading: 'Relay' });
    await store.pins.pinNote({ filePath: 'notes/gone.md' });
    await store.savedSearches.saveSavedFilter('Both', ['#project/relay', '#risk/vendor']);
    await store.savedSearches.saveSavedFilter('Orphaned', ['#project/gone', '#risk/gone']);
    await store.savedSearches.saveSavedQueryFilter('Query', 'tag = #project/gone');

    const stale = store.maintenance.findStale(
      ['#project/relay', '#risk/vendor'],
      ['#person/ren'],
      ['notes/relay.md'],
    );
    assert.deepStrictEqual(stale.favoriteTags, ['#project/gone']);
    assert.deepStrictEqual(stale.favoriteEntities, []);
    assert.deepStrictEqual(stale.pinnedNotes.map((pin) => pin.filePath), ['notes/gone.md']);
    assert.deepStrictEqual(stale.savedFilters.map((filter) => filter.name), ['Orphaned'],
      'a saved query is never stale: it can name a tag that does not exist yet');

    await store.maintenance.removeStale(stale);
    assert.deepStrictEqual(store.reader.value.favoriteTags, ['#project/relay']);
    assert.deepStrictEqual(store.reader.value.pinnedNotes?.map((pin) => pin.filePath), ['notes/relay.md']);
    assert.deepStrictEqual(store.reader.value.savedFilters.map((filter) => filter.name), ['Both', 'Query']);
  });

  test('still removes keys the index no longer has', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);
    await store.usage.recordTagAccess('#project/relay');
    await store.usage.recordTagAccess('#project/gone');
    let changes = 0;
    store.reader.onDidChange(() => {
      changes += 1;
    });

    await store.maintenance.pruneKeys({ tags: ['#project/relay'], tasks: [], sections: [], entities: [] });

    assert.strictEqual(changes, 1);
    assert.deepStrictEqual(store.reader.value.tagAccessCounts, { '#project/relay': 1 });
  });
});

/**
 * Favorites, pins and view counts name what is in a workspace, so they are
 * kept with it. They were machine-wide until 1.19, which is how opening an
 * unrelated repository could delete them.
 */
suite('Workspace-scoped preferences', () => {
  const legacyGlobalStore = async (): Promise<MemoryMemento> => {
    const global = new MemoryMemento();
    const store = createPreferences(global);
    await store.favorites.toggleFavorite('#project/relay');
    await store.usage.recordTagAccess('#project/relay');
    await store.pins.pinNote({ filePath: 'notes/relay.md', heading: 'Relay' });
    await store.display.setTagSortMode('count');
    return global;
  };

  test('hands what was machine-wide to the first workspace opened', async () => {
    const global = await legacyGlobalStore();
    const workspace = new MemoryMemento();

    const store = createPreferences(global, workspace);
    await store.repository.initialize();

    assert.deepStrictEqual(store.reader.value.favoriteTags, ['#project/relay']);
    assert.strictEqual(store.reader.value.pinnedNotes?.length, 1);
    assert.deepStrictEqual(
      workspace.get<{ favoriteTags: string[] }>('deckard.preferences')?.favoriteTags,
      ['#project/relay'],
      'and the workspace owns it now',
    );
    // An older Deckard reads the machine-wide blob, and it also seeds a
    // workspace whose own storage VS Code has cleaned up.
    assert.deepStrictEqual(
      global.get<{ favoriteTags: string[] }>('deckard.preferences')?.favoriteTags,
      ['#project/relay'],
    );
  });

  test('does not hand the same content to a second workspace', async () => {
    const global = await legacyGlobalStore();
    const first = createPreferences(global, new MemoryMemento());
    await first.repository.initialize();

    // Any repository with a Markdown file in it. This used to delete the
    // notes workspace's favorites, because its index did not hold them.
    const other = createPreferences(global, new MemoryMemento());
    await other.repository.initialize();
    await other.maintenance.pruneKeys({ tags: ['#something/else'], tasks: [], sections: ['other-section'], entities: [], files: ['README.md'] });

    assert.deepStrictEqual(other.reader.value.favoriteTags, []);
    assert.strictEqual(other.reader.value.pinnedNotes?.length, 0);
  });

  test('keeps one workspace out of another, and shares how Deckard looks', async () => {
    const global = new MemoryMemento();
    const notesState = new MemoryMemento();
    const otherState = new MemoryMemento();

    const notes = createPreferences(global, notesState);
    await notes.repository.initialize();
    await notes.favorites.toggleFavorite('#project/relay');
    await notes.display.setTagSortMode('count');

    const other = createPreferences(global, otherState);
    await other.repository.initialize();
    await other.favorites.toggleFavorite('#something/else');

    assert.deepStrictEqual(
      createPreferences(global, notesState).reader.value.favoriteTags,
      ['#project/relay'],
      'the other workspace did not touch these',
    );
    assert.deepStrictEqual(
      createPreferences(global, otherState).reader.value.favoriteTags,
      ['#something/else'],
    );
    // Presentation is the same everywhere, and nothing prunes it.
    assert.strictEqual(
      createPreferences(global, otherState).reader.value.tagSortMode,
      'count',
    );
  });

  test('reads and writes the machine-wide blob alone when no folder is open', async () => {
    const global = await legacyGlobalStore();

    const bare = createPreferences(global);
    assert.deepStrictEqual(bare.reader.value.favoriteTags, ['#project/relay']);
    // An empty index prunes nothing, so a bare window cannot empty the store
    // it is sharing with every workspace.
    await bare.maintenance.pruneKeys({ tags: [], tasks: [], sections: [], entities: [], files: [] });

    assert.deepStrictEqual(
      createPreferences(global).reader.value.favoriteTags,
      ['#project/relay'],
    );
    assert.strictEqual(
      global.get<boolean>('deckard.preferences.workspaceScoped'),
      undefined,
      'and it does not spend the one handover on a window with no workspace',
    );
  });
});
