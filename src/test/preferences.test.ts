import * as assert from 'assert';

import { pinKey, PreferencesStore } from '../core/storage/preferences';

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

class DelayedFirstWriteMemento extends MemoryMemento {
  private writeCount = 0;
  private releaseFirstWriteCallback: (() => void) | undefined;
  private readonly firstWriteGate = new Promise<void>((resolve) => {
    this.releaseFirstWriteCallback = resolve;
  });
  private firstWriteStartedCallback: () => void = () => undefined;
  public readonly firstWriteStarted = new Promise<void>((resolve) => {
    this.firstWriteStartedCallback = resolve;
  });

  public releaseFirstWrite(): void {
    this.releaseFirstWriteCallback?.();
  }

  public override async update(key: string, value: unknown): Promise<void> {
    if (this.writeCount === 0) {
      this.writeCount += 1;
      this.firstWriteStartedCallback();
      await this.firstWriteGate;
    }
    await super.update(key, value);
  }
}

suite('Preferences store', () => {
  test('a task keeps its place when Deckard rewrites its line', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    await store.setTaskOrder(['task-a', 'task-b', 'task-c']);

    // Completing task-b stamps a done date on it, which makes it a new id.
    await store.replaceTaskInOrder('task-b', 'task-b-done');
    assert.deepStrictEqual(store.value.taskOrder, [
      'task-a',
      'task-b-done',
      'task-c',
    ]);

    // Undoing the completion puts the line, and the place, back.
    await store.replaceTaskInOrder('task-b-done', 'task-b');
    assert.deepStrictEqual(store.value.taskOrder, [
      'task-a',
      'task-b',
      'task-c',
    ]);

    // A task the order never held is left alone.
    await store.replaceTaskInOrder('task-z', 'task-z-done');
    assert.deepStrictEqual(store.value.taskOrder, [
      'task-a',
      'task-b',
      'task-c',
    ]);
  });

  test('persists favorites and removes stale content references', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);

    assert.strictEqual(store.value.taskSortMode, 'rank');
    await store.toggleFavorite('case');
    await store.setTagSortMode('custom');
    await store.setTagOverviewSortMode('access');
    await store.setTagOverviewLayout('split');
    await store.setRelatedNotesSortMode('newest');
    await store.setTagAccessOrder(['case', 'missing']);
    await store.recordTagAccess('case');
    await store.recordTagAccess('case');
    await store.recordTagAccess('missing');
    await store.setTaskOrder(['task-1', 'missing-task']);
    await store.setTaskSortMode('created');
    await store.setDashboardColumns('tasks', 3);
    await store.setDashboardColumns('notes', 2);
    await store.setDashboardColumns('tags', 4);
    await store.setDashboardMode('browse');
    await store.setTaskBoardLayout('list');
    await store.setTaskBoardGroup('due');
    await store.setDashboardSearch('tags', 'atlas');
    await store.recordSectionAccess('section-1');
    await store.recordSectionAccess('missing-section');
    await store.prune(['case'], ['task-1'], ['section-1']);

    assert.deepStrictEqual(store.value.favoriteTags, ['case']);
    assert.strictEqual(store.value.tagSortMode, 'custom');
    assert.strictEqual(store.value.tagOverviewSortMode, 'access');
    assert.strictEqual(store.value.tagOverviewLayout, 'split');
    assert.strictEqual(store.value.relatedNotesSortMode, 'newest');
    assert.deepStrictEqual(store.value.tagAccessOrder, ['case']);
    assert.deepStrictEqual(store.value.tagAccessCounts, { case: 2 });
    assert.deepStrictEqual(store.value.taskOrder, ['task-1']);
    assert.strictEqual(store.value.taskSortMode, 'created');
    assert.strictEqual(store.value.dashboardTaskColumns, 3);
    assert.strictEqual(store.value.dashboardNoteColumns, 2);
    assert.strictEqual(store.value.dashboardTagColumns, 4);
    assert.deepStrictEqual(store.value.dashboardViewState, {
      mode: 'browse',
      tagSearchQuery: 'atlas',
    });
    assert.strictEqual(store.value.taskBoardLayout, 'list');
    assert.strictEqual(store.value.taskBoardGroup, 'due');
    assert.deepStrictEqual(store.value.sectionAccessCounts, { 'section-1': 1 });
    assert.deepStrictEqual(memento.get('deckard.preferences'), store.value);

    store.dispose();
  });

  test('keeps the page size a reader chose, and only one it offers', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);

    assert.strictEqual(store.value.searchPageSize, 30, 'thirty to a page by default');

    await store.setSearchPageSize(100);
    assert.strictEqual(store.value.searchPageSize, 100);

    // A reader comes back to the pages they left, so the choice is read from
    // storage rather than started again.
    const reopened = new PreferencesStore(memento);
    assert.strictEqual(reopened.value.searchPageSize, 100);
    store.dispose();
    reopened.dispose();

    // A size Deckard no longer offers, or never did, falls back rather than
    // paging a search by a number nothing can choose again.
    const tampered = new MemoryMemento();
    await tampered.update('deckard.preferences', {
      version: 1,
      searchPageSize: 3141,
    });
    const recovered = new PreferencesStore(tampered);
    assert.strictEqual(recovered.value.searchPageSize, 30);
    recovered.dispose();
  });

  test('opens a Dashboard saved on its old Tasks tab on Home, and shows a board', () => {
    const memento = new MemoryMemento();
    void memento.update('deckard.preferences', {
      version: 1,
      dashboardViewState: {
        mode: 'tasks',
        taskFilter: 'completed',
        selectedTaskTags: ['#work'],
        taskSearchQuery: 'audit',
        noteSearchQuery: 'atlas',
        tagSearchQuery: '',
        taskTagQuery: '',
      },
      dashboardTaskLayout: 'list',
    });
    const store = new PreferencesStore(memento);

    assert.deepStrictEqual(store.value.dashboardViewState, {
      mode: 'home',
      tagSearchQuery: '',
    });
    assert.strictEqual(store.value.taskBoardLayout, 'board');
    assert.strictEqual(store.value.taskBoardGroup, 'status');
    assert.strictEqual(
      'taskBoardTaskFilter' in store.value,
      false,
      'the board searches rather than keeping a filter of its own',
    );
    assert.strictEqual('dashboardTaskLayout' in store.value, false);

    store.dispose();
  });

  test('opens a Dashboard saved on its old Search tab on Home, with the default widgets', () => {
    const memento = new MemoryMemento();
    void memento.update('deckard.preferences', {
      version: 1,
      dashboardViewState: { mode: 'notes', noteSearchQuery: 'atlas', tagSearchQuery: 'proj' },
      dashboardNoteSortMode: 'updated',
    });
    const store = new PreferencesStore(memento);

    assert.deepStrictEqual(store.value.dashboardViewState, {
      mode: 'home',
      tagSearchQuery: 'proj',
    });
    assert.deepStrictEqual(
      store.value.dashboardWidgets.map((widget) => widget.kind),
      ['search', 'tasks', 'agenda', 'favoriteTags', 'savedSearches'],
    );
    assert.strictEqual('dashboardNoteSortMode' in store.value, false);

    store.dispose();
  });

  test('keeps only the Home widgets it can draw', async () => {
    const store = new PreferencesStore(new MemoryMemento());

    await store.setDashboardWidgets([
      { id: 'a', kind: 'tasks', width: 'full', count: 99, query: ' is:open ' },
      { id: 'a', kind: 'agenda', width: 'half' },
      { id: 'b', kind: 'search', width: 'wide' as 'half' },
      { id: 'c', kind: 'search', width: 'half' },
      { id: 'd', kind: 'mystery' as 'stats', width: 'half' },
      { id: 'e', kind: 'savedQuery', width: 'half' },
      { id: 'f', kind: 'savedQuery', width: 'half', filterId: 'saved' },
      { id: 'g', kind: 'stats', width: 'half', count: 3, query: 'x' },
    ]);

    assert.deepStrictEqual(store.value.dashboardWidgets, [
      { id: 'a', kind: 'tasks', width: 'full', count: 20, query: 'is:open' },
      { id: 'b', kind: 'search', width: 'half' },
      { id: 'f', kind: 'savedQuery', width: 'half', count: 5, filterId: 'saved' },
      { id: 'g', kind: 'stats', width: 'half' },
    ]);

    await store.resetDashboardWidgets();
    assert.strictEqual(store.value.dashboardWidgets.length, 5);
    await store.setDashboardWidgets([]);
    assert.deepStrictEqual(store.value.dashboardWidgets, [], 'an empty Home stays empty');

    store.dispose();
  });

  test('follows a renamed tag into a widget\'s search, and drops a removed saved search\'s widget', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    const saved = await store.saveSavedQueryFilter('Open', 'is:open');
    assert.ok(saved);
    await store.setDashboardWidgets([
      { id: 't', kind: 'tasks', width: 'half', query: '#old is:open -#old/child' },
      { id: 's', kind: 'savedQuery', width: 'half', filterId: saved.id },
    ]);

    await store.replaceTagKey('#old', '#new');
    assert.strictEqual(
      store.value.dashboardWidgets[0].query,
      '#new is:open -#old/child',
      'only the whole tag is renamed',
    );

    await store.removeSavedFilter(saved.id);
    assert.deepStrictEqual(
      store.value.dashboardWidgets.map((widget) => widget.id),
      ['t'],
    );

    store.dispose();
  });

  test('keeps each look-back widget\'s days within bounds', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    await store.setDashboardWidgets([
      { id: 's', kind: 'staleTasks', width: 'half', days: 9999 },
      { id: 'n', kind: 'newTags', width: 'half' },
      { id: 'q', kind: 'quickAdd', width: 'full', days: 3, count: 4 },
    ]);
    assert.deepStrictEqual(store.value.dashboardWidgets, [
      { id: 's', kind: 'staleTasks', width: 'half', count: 5, days: 365 },
      { id: 'n', kind: 'newTags', width: 'half', count: 5, days: 14 },
      { id: 'q', kind: 'quickAdd', width: 'full' },
    ]);
    store.dispose();
  });

  test('knows every tag of the first index, and when each later tag was first seen', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    assert.strictEqual(store.value.tagFirstSeen, undefined);

    await store.prune(['#old', '#kept'], [], undefined, undefined, undefined, 100);
    assert.deepStrictEqual(store.value.tagFirstSeen, { '#old': 0, '#kept': 0 });

    await store.prune(['#kept', '#new'], [], undefined, undefined, undefined, 200);
    assert.deepStrictEqual(
      store.value.tagFirstSeen,
      { '#kept': 0, '#new': 200 },
      'a gone tag is forgotten',
    );

    await store.prune(['#kept', '#new'], [], undefined, undefined, undefined, 300);
    assert.strictEqual(store.value.tagFirstSeen?.['#new'], 200, 'a tag is new once');

    // Renamed to a name not yet used, a tag is no newer than it was.
    await store.replaceTagKey('#kept', '#renamed');
    assert.strictEqual(store.value.tagFirstSeen?.['#renamed'], 0);
    store.dispose();
  });

  test('pins notes once, in order, and forgets pinned notes that are gone', async () => {
    const store = new PreferencesStore(new MemoryMemento());
    const paths = (): (string | undefined)[] =>
      (store.value.pinnedNotes ?? []).map((pin) => pin.filePath);
    await store.pinNote({ filePath: 'notes/a.md' });
    await store.pinNote({ filePath: 'notes/b.md' });
    await store.pinNote({ filePath: 'notes/a.md' });
    assert.deepStrictEqual(paths(), ['notes/a.md', 'notes/b.md']);

    // Two entries of one note are two pins, told apart by their headings.
    await store.pinNote({ filePath: 'notes/b.md', heading: 'Decision' });
    assert.strictEqual(store.value.pinnedNotes?.length, 3);

    await store.unpinNote(pinKey({ filePath: 'notes/a.md' }));
    assert.deepStrictEqual(paths(), ['notes/b.md', 'notes/b.md']);
    assert.strictEqual(store.isPinned(pinKey({ filePath: 'notes/a.md' })), false);
    assert.strictEqual(
      store.isPinned(pinKey({ filePath: 'notes/b.md', heading: 'Decision' })),
      true,
    );

    await store.unpinNote(
      pinKey({ filePath: 'notes/b.md', heading: 'Decision' }),
    );
    await store.pinNote({ filePath: 'notes/c.md' });
    await store.prune([], [], undefined, undefined, ['notes/c.md']);
    assert.deepStrictEqual(paths(), ['notes/c.md']);

    await store.prune([], []);
    assert.deepStrictEqual(
      paths(),
      ['notes/c.md'],
      'without the index\'s files, pins are kept',
    );
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

  test('upserts saved multi-tag filters and prunes missing tags', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);

    const first = await store.saveSavedFilter('Project follow-up', [
      '#follow-up',
      '#project/atlas',
      '#follow-up',
    ]);
    const renamed = await store.saveSavedFilter('Atlas work', [
      '#project/atlas',
      '#follow-up',
    ]);
    const invalid = await store.saveSavedFilter('Incomplete', ['#project/atlas']);

    assert.ok(first);
    assert.ok(renamed);
    assert.strictEqual(renamed.id, first.id);
    assert.strictEqual(invalid, undefined);
    assert.deepStrictEqual(store.value.savedFilters, [
      {
        id: first.id,
        name: 'Atlas work',
        tagKeys: ['#follow-up', '#project/atlas'],
      },
    ]);

    await store.prune(['#project/atlas'], [], []);
    assert.deepStrictEqual(store.value.savedFilters, []);
    store.dispose();
  });

  test('normalizes only valid saved filters from persisted version-one state', async () => {
    const memento = new MemoryMemento();
    await memento.update('deckard.preferences', {
      version: 1,
      savedFilters: [
        {
          id: 'valid',
          name: '  Atlas  ',
          tagKeys: ['#zeta', '#atlas', '#zeta'],
        },
        { id: 'one-tag', name: 'Invalid', tagKeys: ['#atlas'] },
        { id: 'blank', name: '   ', tagKeys: ['#atlas', '#zeta'] },
        { id: 'duplicate-set', name: 'Duplicate', tagKeys: ['#atlas', '#zeta'] },
      ],
    });
    const store = new PreferencesStore(memento);

    assert.deepStrictEqual(store.value.savedFilters, [
      {
        id: 'valid',
        name: 'Atlas',
        tagKeys: ['#atlas', '#zeta'],
      },
    ]);
    store.dispose();
  });

  test('persists entity favorites, sort state, and access counts', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);

    await store.toggleFavoriteEntity('#project/neon-relay');
    await store.setEntitySortMode('access');
    await store.setEntityAccessOrder(['#project/neon-relay', '@mara-vale']);
    await store.recordEntityAccess('#project/neon-relay');
    await store.recordEntityAccess('#project/neon-relay');
    await store.prune([], [], [], ['#project/neon-relay']);

    assert.deepStrictEqual(store.value.favoriteEntities, [
      '#project/neon-relay',
    ]);
    assert.strictEqual(store.value.entitySortMode, 'access');
    assert.deepStrictEqual(store.value.entityAccessOrder, [
      '#project/neon-relay',
    ]);
    assert.deepStrictEqual(store.value.entityAccessCounts, {
      '#project/neon-relay': 2,
    });

    store.dispose();
  });

  test('serializes concurrent updates so newer columns are not overwritten', async () => {
    const memento = new DelayedFirstWriteMemento();
    const store = new PreferencesStore(memento);

    const firstUpdate = store.setDashboardColumns('tasks', 3);
    await memento.firstWriteStarted;
    const secondUpdate = store.setDashboardColumns('tags', 4);
    memento.releaseFirstWrite();
    await Promise.all([firstUpdate, secondUpdate]);

    assert.strictEqual(store.value.dashboardTaskColumns, 3);
    assert.strictEqual(store.value.dashboardTagColumns, 4);
    assert.deepStrictEqual(memento.get('deckard.preferences'), store.value);
    store.dispose();
  });

  test('moves favorites, ranking, and saved views to a renamed or merged tag', async () => {
    const memento = new MemoryMemento();
    const store = new PreferencesStore(memento);

    await store.toggleFavorite('#apollo');
    await store.toggleFavorite('#atlas');
    await store.recordTagAccess('#apollo');
    await store.recordTagAccess('#apollo');
    await store.recordTagAccess('#atlas');
    await store.saveSavedFilter('Both', ['#apollo', '#atlas']);
    await store.saveSavedFilter('Apollo follow-up', ['#apollo', '#follow-up']);

    await store.replaceTagKey('#apollo', '#atlas');

    assert.deepStrictEqual(store.value.favoriteTags, ['#atlas']);
    assert.deepStrictEqual(store.value.tagAccessCounts, { '#atlas': 3 });
    // A view left with one tag is no longer a filter, so it is dropped.
    assert.deepStrictEqual(
      store.value.savedFilters.map((filter) => [filter.name, filter.tagKeys]),
      [['Apollo follow-up', ['#atlas', '#follow-up']]],
    );
    store.dispose();
  });
});
