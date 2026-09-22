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
    // The first prune learns which tags the index already has.
    await store.prune(['#project/relay'], [], ['relay-section'], []);
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

  test('keeps everything when the index holds nothing at all', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);
    await store.toggleFavorite('#project/relay');
    await store.recordTagAccess('#project/relay');
    await store.recordSectionAccess('relay-section');
    await store.pinNote({ filePath: 'notes/relay.md', heading: 'Relay' });
    const writes = memento.writes;

    // What a window with no folder open reports, which is the state VS Code
    // is in while a VSIX is installed from the Extensions view. The store is
    // global, so pruning against it used to empty every workspace's
    // favourites, view counts and pins at once.
    await store.prune([], [], [], [], []);

    assert.deepStrictEqual(store.value.favoriteTags, ['#project/relay']);
    assert.deepStrictEqual(store.value.tagAccessCounts, { '#project/relay': 1 });
    assert.deepStrictEqual(store.value.sectionAccessCounts, { 'relay-section': 1 });
    assert.strictEqual(store.value.pinnedNotes?.length, 1);
    assert.strictEqual(memento.writes, writes, 'and it writes nothing');

    // An index that holds something is authoritative again, and a key it does
    // not have is still removed.
    await store.prune(['#project/other'], [], ['other-section'], [], ['notes/other.md']);
    assert.deepStrictEqual(store.value.favoriteTags, []);
    assert.deepStrictEqual(store.value.tagAccessCounts, {});
    assert.strictEqual(store.value.pinnedNotes?.length, 0);
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

/**
 * Favourites, pins and view counts name what is in a workspace, so they are
 * kept with it. They were machine-wide until 1.19, which is how opening an
 * unrelated repository could delete them.
 */
suite('Workspace-scoped preferences', () => {
  const legacyGlobalStore = async (): Promise<MemoryMemento> => {
    const global = new MemoryMemento();
    const store = new PreferencesStore(global);
    await store.toggleFavorite('#project/relay');
    await store.recordTagAccess('#project/relay');
    await store.pinNote({ filePath: 'notes/relay.md', heading: 'Relay' });
    await store.setTagSortMode('count');
    return global;
  };

  test('hands what was machine-wide to the first workspace opened', async () => {
    const global = await legacyGlobalStore();
    const workspace = new MemoryMemento();

    const store = new PreferencesStore(global, workspace);
    await store.initialize();

    assert.deepStrictEqual(store.value.favoriteTags, ['#project/relay']);
    assert.strictEqual(store.value.pinnedNotes?.length, 1);
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
    const first = new PreferencesStore(global, new MemoryMemento());
    await first.initialize();

    // Any repository with a Markdown file in it. This used to delete the
    // notes workspace's favourites, because its index did not hold them.
    const other = new PreferencesStore(global, new MemoryMemento());
    await other.initialize();
    await other.prune(['#something/else'], [], ['other-section'], [], ['README.md']);

    assert.deepStrictEqual(other.value.favoriteTags, []);
    assert.strictEqual(other.value.pinnedNotes?.length, 0);
  });

  test('keeps one workspace out of another, and shares how Deckard looks', async () => {
    const global = new MemoryMemento();
    const notesState = new MemoryMemento();
    const otherState = new MemoryMemento();

    const notes = new PreferencesStore(global, notesState);
    await notes.initialize();
    await notes.toggleFavorite('#project/relay');
    await notes.setTagSortMode('count');

    const other = new PreferencesStore(global, otherState);
    await other.initialize();
    await other.toggleFavorite('#something/else');

    assert.deepStrictEqual(
      new PreferencesStore(global, notesState).value.favoriteTags,
      ['#project/relay'],
      'the other workspace did not touch these',
    );
    assert.deepStrictEqual(
      new PreferencesStore(global, otherState).value.favoriteTags,
      ['#something/else'],
    );
    // Presentation is the same everywhere, and nothing prunes it.
    assert.strictEqual(
      new PreferencesStore(global, otherState).value.tagSortMode,
      'count',
    );
  });

  test('reads and writes the machine-wide blob alone when no folder is open', async () => {
    const global = await legacyGlobalStore();

    const bare = new PreferencesStore(global);
    assert.deepStrictEqual(bare.value.favoriteTags, ['#project/relay']);
    // An empty index prunes nothing, so a bare window cannot empty the store
    // it is sharing with every workspace.
    await bare.prune([], [], [], [], []);

    assert.deepStrictEqual(
      new PreferencesStore(global).value.favoriteTags,
      ['#project/relay'],
    );
    assert.strictEqual(
      global.get<boolean>('deckard.preferences.workspaceScoped'),
      undefined,
      'and it does not spend the one handover on a window with no workspace',
    );
  });
});
