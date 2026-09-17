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
    await store.setTaskBoardTaskFilter('completed');
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
    assert.strictEqual(store.value.taskBoardTaskFilter, 'completed');
    assert.strictEqual(store.value.taskBoardLayout, 'list');
    assert.strictEqual(store.value.taskBoardGroup, 'due');
    assert.deepStrictEqual(store.value.sectionAccessCounts, { 'section-1': 1 });
    assert.deepStrictEqual(memento.get('deckard.preferences'), store.value);

    store.dispose();
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
    assert.strictEqual(store.value.taskBoardTaskFilter, 'active');
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
