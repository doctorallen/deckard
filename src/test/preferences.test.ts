import * as assert from 'assert';

import { createPreferences } from './preferenceServices';
import { DEFAULT_DASHBOARD_WIDGETS, isDefaultHomeLayout, normalizeDashboardWidgets, pinKey } from '../core/storage/preferencesSchema';

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
  test('a saved search\'s widget is added to Home once', async () => {
    const store = createPreferences(new MemoryMemento());
    const saved = await store.savedSearches.saveSavedQueryFilter('Open work', 'is:open');
    assert.ok(saved);
    assert.strictEqual(await store.homeWidgets.addSavedSearchWidget(saved.id), 'added');
    const widget = store.reader.value.dashboardWidgets[store.reader.value.dashboardWidgets.length - 1];
    assert.deepStrictEqual({ kind: widget.kind, width: widget.width, count: widget.count, filterId: widget.filterId }, { kind: 'savedQuery', width: 'half', count: 5, filterId: saved.id });
    assert.strictEqual(await store.homeWidgets.addSavedSearchWidget(saved.id), 'present');
    assert.strictEqual(await store.homeWidgets.addSavedSearchWidget('nope'), 'missing');
  });

  test('remembers whether daily notes are hidden from Related Notes', async () => {
    const store = createPreferences(new MemoryMemento());
    assert.strictEqual(store.reader.value.hideDailyNotes, undefined);
    await store.display.setHideDailyNotes(true);
    assert.strictEqual(store.reader.value.hideDailyNotes, true);
    await store.display.setHideDailyNotes(false);
    assert.strictEqual(store.reader.value.hideDailyNotes, undefined);
  });

  test('remembers how many lines Related Notes previews, 1 unless told otherwise', async () => {
    const store = createPreferences(new MemoryMemento());
    assert.strictEqual(store.reader.value.relatedNotesPreviewLines ?? 1, 1);
    await store.display.setRelatedNotesPreviewLines(2);
    assert.strictEqual(store.reader.value.relatedNotesPreviewLines, 2);
    await store.display.setRelatedNotesPreviewLines(0);
    assert.strictEqual(store.reader.value.relatedNotesPreviewLines, 0);
    await store.display.setRelatedNotesPreviewLines(1);
    assert.strictEqual(store.reader.value.relatedNotesPreviewLines, undefined);
  });

  test('keeps what Find learned, at most 200, and forgets a choice whose note is gone', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.usage.recordFindChoice('  Vendor   Contract ', 'note:["a.md","Next",0]', 5);
    await store.usage.recordFindChoice('vendor contract', 'note:["a.md","Next",0]', 9);
    await store.usage.recordFindChoice('atlas', 'tag:#project/atlas', 7);
    await store.usage.recordFindChoice('gone', 'note:["gone.md","",0]', 8);
    assert.deepStrictEqual(store.reader.value.findChoices?.[0], { input: 'vendor contract', key: 'note:["a.md","Next",0]', count: 2, at: 9 });
    await store.maintenance.pruneKeys({ tags: ['#project/atlas'], tasks: [], sections: [], entities: [], files: ['a.md'] });
    assert.deepStrictEqual(store.reader.value.findChoices?.map((choice) => choice.input), ['vendor contract', 'atlas']);
    for (let n = 0; n < 250; n += 1) {
      await store.usage.recordFindChoice(`word ${n}`, 'tag:#project/atlas', 100 + n);
    }
    assert.strictEqual(store.reader.value.findChoices?.length, 200);
    await store.savedSearches.removeRecentQuery('nothing');
  });

  test('search pages start rendered, and Source sticks once it is chosen', async () => {
    assert.strictEqual(createPreferences(new MemoryMemento()).reader.value.renderMode, 'html', 'a new install is rendered');

    // Every saved blob held Source, chosen or not, so one not chosen since
    // is switched once.
    const given = new MemoryMemento();
    await given.update('deckard.preferences', { renderMode: 'markdown' });
    assert.strictEqual(createPreferences(given).reader.value.renderMode, 'html');

    const chosen = new MemoryMemento();
    await chosen.update('deckard.preferences', { renderMode: 'markdown', renderModeChosen: true });
    assert.strictEqual(createPreferences(chosen).reader.value.renderMode, 'markdown');

    const store = createPreferences(new MemoryMemento());
    await store.display.setRenderMode('markdown');
    assert.strictEqual(store.reader.value.renderMode, 'markdown');
    assert.strictEqual(store.reader.value.renderModeChosen, true);
  });

  test('a task keeps its place when Deckard rewrites its line', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.taskLayout.setTaskOrder(['task-a', 'task-b', 'task-c']);

    // Completing task-b stamps a done date on it, which makes it a new id.
    await store.taskLayout.replaceTaskInOrder('task-b', 'task-b-done');
    assert.deepStrictEqual(store.reader.value.taskOrder, [
      'task-a',
      'task-b-done',
      'task-c',
    ]);

    // Undoing the completion puts the line, and the place, back.
    await store.taskLayout.replaceTaskInOrder('task-b-done', 'task-b');
    assert.deepStrictEqual(store.reader.value.taskOrder, [
      'task-a',
      'task-b',
      'task-c',
    ]);

    // A task the order never held is left alone.
    await store.taskLayout.replaceTaskInOrder('task-z', 'task-z-done');
    assert.deepStrictEqual(store.reader.value.taskOrder, [
      'task-a',
      'task-b',
      'task-c',
    ]);
  });

  test('persists favorites and removes stale content references', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);

    assert.strictEqual(store.reader.value.taskSortMode, 'rank');
    await store.favorites.toggleFavorite('case');
    await store.display.setTagSortMode('custom');
    await store.display.setTagOverviewSortMode('access');
    await store.display.setTagOverviewLayout('split');
    await store.display.setRelatedNotesSortMode('newest');
    await store.favorites.setTagAccessOrder(['case', 'missing']);
    await store.usage.recordTagAccess('case');
    await store.usage.recordTagAccess('case');
    await store.usage.recordTagAccess('missing');
    await store.taskLayout.setTaskOrder(['task-1', 'missing-task']);
    await store.taskLayout.setTaskSortMode('created');
    await store.display.setDashboardColumns('tasks', 3);
    await store.display.setDashboardColumns('notes', 2);
    await store.display.setDashboardColumns('tags', 4);
    await store.homeWidgets.setDashboardMode('browse');
    await store.taskLayout.setTaskBoardLayout('list');
    await store.taskLayout.setTaskBoardGroup('due');
    await store.homeWidgets.setDashboardSearch('tags', 'atlas');
    await store.usage.recordSectionAccess('section-1');
    await store.usage.recordSectionAccess('missing-section');
    await store.maintenance.pruneKeys({ tags: ['case'], tasks: ['task-1'], sections: ['section-1'] });

    assert.deepStrictEqual(store.reader.value.favoriteTags, ['case']);
    assert.strictEqual(store.reader.value.tagSortMode, 'custom');
    assert.strictEqual(store.reader.value.tagOverviewSortMode, 'access');
    assert.strictEqual(store.reader.value.tagOverviewLayout, 'split');
    assert.strictEqual(store.reader.value.relatedNotesSortMode, 'newest');
    assert.deepStrictEqual(store.reader.value.tagAccessOrder, ['case']);
    assert.deepStrictEqual(store.reader.value.tagAccessCounts, { case: 2 });
    assert.deepStrictEqual(store.reader.value.taskOrder, ['task-1']);
    assert.strictEqual(store.reader.value.taskSortMode, 'created');
    assert.strictEqual(store.reader.value.dashboardTaskColumns, 3);
    assert.strictEqual(store.reader.value.dashboardNoteColumns, 2);
    assert.strictEqual(store.reader.value.dashboardTagColumns, 4);
    assert.deepStrictEqual(store.reader.value.dashboardViewState, {
      mode: 'browse',
      tagSearchQuery: 'atlas',
    });
    assert.strictEqual(store.reader.value.taskBoardLayout, 'list');
    assert.strictEqual(store.reader.value.taskBoardGroup, 'due');
    // Every grouping the board offers survives being read back.
    await store.taskLayout.setTaskBoardGroup('assignee');
    assert.strictEqual(store.reader.value.taskBoardGroup, 'assignee');
    assert.strictEqual(
      createPreferences(memento).reader.value.taskBoardGroup,
      'assignee',
      'a grouping is kept, not quietly turned back into status',
    );
    assert.deepStrictEqual(store.reader.value.sectionAccessCounts, { 'section-1': 1 });
    assert.deepStrictEqual(memento.get('deckard.preferences'), store.reader.value);

    store.repository.dispose();
  });

  test('keeps the page size a reader chose, and only one it offers', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);

    assert.strictEqual(store.reader.value.searchPageSize, 30, 'thirty to a page by default');

    await store.display.setSearchPageSize(100);
    assert.strictEqual(store.reader.value.searchPageSize, 100);

    // A reader comes back to the pages they left, so the choice is read from
    // storage rather than started again.
    const reopened = createPreferences(memento);
    assert.strictEqual(reopened.reader.value.searchPageSize, 100);
    store.repository.dispose();
    reopened.repository.dispose();

    // A size Deckard no longer offers, or never did, falls back rather than
    // paging a search by a number nothing can choose again.
    const tampered = new MemoryMemento();
    await tampered.update('deckard.preferences', {
      version: 1,
      searchPageSize: 3141,
    });
    const recovered = createPreferences(tampered);
    assert.strictEqual(recovered.reader.value.searchPageSize, 30);
    recovered.repository.dispose();
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
    const store = createPreferences(memento);

    assert.deepStrictEqual(store.reader.value.dashboardViewState, {
      mode: 'home',
      tagSearchQuery: '',
    });
    assert.strictEqual(store.reader.value.taskBoardLayout, 'board');
    assert.strictEqual(store.reader.value.taskBoardGroup, 'status');
    assert.strictEqual(
      'taskBoardTaskFilter' in store.reader.value,
      false,
      'the board searches rather than keeping a filter of its own',
    );
    assert.strictEqual('dashboardTaskLayout' in store.reader.value, false);

    store.repository.dispose();
  });

  test('opens a Dashboard saved on its old Search tab on Home, with the default widgets', () => {
    const memento = new MemoryMemento();
    void memento.update('deckard.preferences', {
      version: 1,
      dashboardViewState: { mode: 'notes', noteSearchQuery: 'atlas', tagSearchQuery: 'proj' },
      dashboardNoteSortMode: 'updated',
    });
    const store = createPreferences(memento);

    assert.deepStrictEqual(store.reader.value.dashboardViewState, {
      mode: 'home',
      tagSearchQuery: 'proj',
    });
    assert.deepStrictEqual(
      store.reader.value.dashboardWidgets.map((widget) => widget.kind),
      ['tryNext', 'search', 'agenda', 'recentNotes', 'favoriteTags', 'savedSearches'],
    );
    assert.strictEqual('dashboardNoteSortMode' in store.reader.value, false);

    store.repository.dispose();
  });

  test('keeps only the Home widgets it can draw', async () => {
    const store = createPreferences(new MemoryMemento());

    await store.homeWidgets.setDashboardWidgets([
      { id: 'a', kind: 'tasks', width: 'full', count: 99, query: ' is:open ' },
      { id: 'a', kind: 'agenda', width: 'half' },
      { id: 'b', kind: 'search', width: 'wide' as 'half' },
      { id: 'c', kind: 'search', width: 'half' },
      { id: 'd', kind: 'mystery' as 'search', width: 'half' },
      { id: 'e', kind: 'savedQuery', width: 'half' },
      { id: 'f', kind: 'savedQuery', width: 'half', filterId: 'saved' },
      { id: 'g', kind: 'pinnedNotes', width: 'half', count: 3, query: 'x' },
    ]);

    assert.deepStrictEqual(store.reader.value.dashboardWidgets, [
      { id: 'a', kind: 'tasks', width: 'full', count: 20, query: 'is:open' },
      { id: 'b', kind: 'search', width: 'half' },
      { id: 'f', kind: 'savedQuery', width: 'half', count: 5, filterId: 'saved' },
      { id: 'g', kind: 'pinnedNotes', width: 'half', count: 3 },
    ]);

    await store.homeWidgets.resetDashboardWidgets();
    assert.strictEqual(store.reader.value.dashboardWidgets.length, 6);
    await store.homeWidgets.setDashboardWidgets([]);
    assert.deepStrictEqual(store.reader.value.dashboardWidgets, [], 'an empty Home stays empty');

    store.repository.dispose();
  });

  test('follows a renamed tag into a widget\'s search, and drops a removed saved search\'s widget', async () => {
    const store = createPreferences(new MemoryMemento());
    const saved = await store.savedSearches.saveSavedQueryFilter('Open', 'is:open');
    assert.ok(saved);
    await store.homeWidgets.setDashboardWidgets([
      { id: 't', kind: 'tasks', width: 'half', query: '#old is:open -#old/child' },
      { id: 's', kind: 'savedQuery', width: 'half', filterId: saved.id },
    ]);

    await store.tagRenames.replaceTagKey('#old', '#new');
    assert.strictEqual(
      store.reader.value.dashboardWidgets[0].query,
      '#new is:open -#old/child',
      'only the whole tag is renamed',
    );

    await store.savedSearches.removeSavedFilter(saved.id);
    assert.deepStrictEqual(
      store.reader.value.dashboardWidgets.map((widget) => widget.id),
      ['t'],
    );

    store.repository.dispose();
  });

  test('keeps each look-back widget\'s days within bounds', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.homeWidgets.setDashboardWidgets([
      { id: 'q', kind: 'quietPeople', width: 'half', days: 9999 },
      { id: 'p', kind: 'progress', width: 'full', days: 3, count: 4 },
    ]);
    assert.deepStrictEqual(store.reader.value.dashboardWidgets, [
      { id: 'q', kind: 'quietPeople', width: 'half', count: 5, days: 365 },
      { id: 'p', kind: 'progress', width: 'full', count: 4 },
    ]);
    store.repository.dispose();
  });

  test('keeps a tasks widget\'s own sort, and only a sort there is', async () => {
    const store = createPreferences(new MemoryMemento());
    await store.homeWidgets.setDashboardWidgets([
      { id: 'a', kind: 'tasks', width: 'half', sort: 'updatedOldest' },
      { id: 'b', kind: 'tasks', width: 'half', sort: 'sideways' as 'rank' },
      { id: 'c', kind: 'agenda', width: 'half', sort: 'created' },
    ]);
    assert.deepStrictEqual(store.reader.value.dashboardWidgets, [
      { id: 'a', kind: 'tasks', width: 'half', count: 5, query: 'is:open', sort: 'updatedOldest' },
      { id: 'b', kind: 'tasks', width: 'half', count: 5, query: 'is:open' },
      { id: 'c', kind: 'agenda', width: 'half', count: 5 },
    ]);
    store.repository.dispose();
  });

  test('reads a stored Stale tasks widget as the Tasks widget that took its place, and drops the kinds Home no longer offers', () => {
    // Widgets stored before Home's catalog went from 21 kinds to 14.
    const stored: unknown[] = [
      { id: 'staleTasks', kind: 'staleTasks', width: 'half', count: 10, days: 14 },
      { id: 'w', kind: 'stats', width: 'full' },
      { id: 'r', kind: 'relatedNotes', width: 'half', count: 5 },
      { id: 'q', kind: 'quickAdd', width: 'full' },
      { id: 'p', kind: 'tagPairs', width: 'half', count: 5 },
      { id: 'u', kind: 'unhubbedTags', width: 'half', count: 5 },
      { id: 'n', kind: 'newTags', width: 'half', count: 5, days: 14 },
      { id: 'old', kind: 'staleTasks', width: 'full' },
      { id: 'a', kind: 'agenda', width: 'half', count: 5 },
    ];
    assert.deepStrictEqual(normalizeDashboardWidgets(stored), [
      { id: 'staleTasks', kind: 'tasks', width: 'half', count: 10, query: 'is:open AND updated < 14d', sort: 'updatedOldest' },
      // A Tasks widget may repeat, so a second Stale tasks is kept too, at
      // the days it looked back by default.
      { id: 'old', kind: 'tasks', width: 'full', count: 5, query: 'is:open AND updated < 30d', sort: 'updatedOldest' },
      { id: 'a', kind: 'agenda', width: 'half', count: 5 },
    ]);
  });

  test('knows every tag of the first index, and when each later tag was first seen', async () => {
    const store = createPreferences(new MemoryMemento());
    assert.strictEqual(store.reader.value.tagFirstSeen, undefined);

    await store.maintenance.pruneKeys({ tags: ['#old', '#kept'], tasks: [] }, 100);
    assert.deepStrictEqual(store.reader.value.tagFirstSeen, { '#old': 0, '#kept': 0 });

    await store.maintenance.pruneKeys({ tags: ['#kept', '#new'], tasks: [] }, 200);
    assert.deepStrictEqual(
      store.reader.value.tagFirstSeen,
      { '#kept': 0, '#new': 200 },
      'a gone tag is forgotten',
    );

    await store.maintenance.pruneKeys({ tags: ['#kept', '#new'], tasks: [] }, 300);
    assert.strictEqual(store.reader.value.tagFirstSeen?.['#new'], 200, 'a tag is new once');

    // Renamed to a name not yet used, a tag is no newer than it was.
    await store.tagRenames.replaceTagKey('#kept', '#renamed');
    assert.strictEqual(store.reader.value.tagFirstSeen?.['#renamed'], 0);
    store.repository.dispose();
  });

  test('pins notes once, in order, and only lets go of a pin when asked', async () => {
    const store = createPreferences(new MemoryMemento());
    const paths = (): (string | undefined)[] =>
      (store.reader.value.pinnedNotes ?? []).map((pin) => pin.filePath);
    await store.pins.pinNote({ filePath: 'notes/a.md' });
    await store.pins.pinNote({ filePath: 'notes/b.md' });
    await store.pins.pinNote({ filePath: 'notes/a.md' });
    assert.deepStrictEqual(paths(), ['notes/a.md', 'notes/b.md']);

    // Two entries of one note are two pins, told apart by their headings.
    await store.pins.pinNote({ filePath: 'notes/b.md', heading: 'Decision' });
    assert.strictEqual(store.reader.value.pinnedNotes?.length, 3);

    await store.pins.unpinNote(pinKey({ filePath: 'notes/a.md' }));
    assert.deepStrictEqual(paths(), ['notes/b.md', 'notes/b.md']);
    assert.strictEqual(store.pins.isPinned(pinKey({ filePath: 'notes/a.md' })), false);
    assert.strictEqual(
      store.pins.isPinned(pinKey({ filePath: 'notes/b.md', heading: 'Decision' })),
      true,
    );

    await store.pins.unpinNote(
      pinKey({ filePath: 'notes/b.md', heading: 'Decision' }),
    );
    await store.pins.pinNote({ filePath: 'notes/c.md' });
    // A pin is a choice. The index no longer having its note is reported,
    // never acted on: Deckard says so and the reader decides.
    await store.maintenance.pruneKeys({ tags: [], tasks: [], files: ['notes/c.md'] });
    assert.deepStrictEqual(paths(), ['notes/b.md', 'notes/c.md']);
    const stale = store.maintenance.findStale([], [], ['notes/c.md']);
    assert.deepStrictEqual(stale.pinnedNotes.map((pin) => pin.filePath), ['notes/b.md']);
    await store.maintenance.removeStale(stale);
    assert.deepStrictEqual(paths(), ['notes/c.md']);
    store.repository.dispose();
  });

  test('updates tag order and favorite membership together', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);

    await store.favorites.setTagAccessOrderAndFavorites(['other', 'case'], ['other']);

    assert.deepStrictEqual(store.reader.value.tagAccessOrder, ['other', 'case']);
    assert.deepStrictEqual(store.reader.value.favoriteTags, ['other']);

    store.repository.dispose();
  });

  test('upserts saved multi-tag filters and reports one whose tags are gone', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);

    const first = await store.savedSearches.saveSavedFilter('Project follow-up', [
      '#follow-up',
      '#project/atlas',
      '#follow-up',
    ]);
    const renamed = await store.savedSearches.saveSavedFilter('Atlas work', [
      '#project/atlas',
      '#follow-up',
    ]);
    const invalid = await store.savedSearches.saveSavedFilter('Incomplete', ['#project/atlas']);

    assert.ok(first);
    assert.ok(renamed);
    assert.strictEqual(renamed.id, first.id);
    assert.strictEqual(invalid, undefined);
    assert.deepStrictEqual(store.reader.value.savedFilters, [
      {
        id: first.id,
        name: 'Atlas work',
        tagKeys: ['#follow-up', '#project/atlas'],
      },
    ]);

    // Losing one of its two tags leaves the search unable to find anything,
    // but it is still the reader's, so pruning reports it rather than removing it.
    await store.maintenance.pruneKeys({ tags: ['#project/atlas'], tasks: [], sections: [] });
    assert.strictEqual(store.reader.value.savedFilters.length, 1);
    const stale = store.maintenance.findStale(['#project/atlas'], [], []);
    assert.deepStrictEqual(stale.savedFilters.map((filter) => filter.id), [first.id]);
    await store.maintenance.removeStale(stale);
    assert.deepStrictEqual(store.reader.value.savedFilters, []);
    store.repository.dispose();
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
    const store = createPreferences(memento);

    assert.deepStrictEqual(store.reader.value.savedFilters, [
      {
        id: 'valid',
        name: 'Atlas',
        tagKeys: ['#atlas', '#zeta'],
      },
    ]);
    store.repository.dispose();
  });

  test('persists entity favorites, sort state, and access counts', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);

    await store.favorites.toggleFavoriteEntity('#project/neon-relay');
    await store.display.setEntitySortMode('access');
    await store.favorites.setEntityAccessOrder(['#project/neon-relay', '@mara-vale']);
    await store.usage.recordEntityAccess('#project/neon-relay');
    await store.usage.recordEntityAccess('#project/neon-relay');
    await store.maintenance.pruneKeys({ tags: [], tasks: [], sections: [], entities: ['#project/neon-relay'] });

    assert.deepStrictEqual(store.reader.value.favoriteEntities, [
      '#project/neon-relay',
    ]);
    assert.strictEqual(store.reader.value.entitySortMode, 'access');
    assert.deepStrictEqual(store.reader.value.entityAccessOrder, [
      '#project/neon-relay',
    ]);
    assert.deepStrictEqual(store.reader.value.entityAccessCounts, {
      '#project/neon-relay': 2,
    });

    store.repository.dispose();
  });

  test('serializes concurrent updates so newer columns are not overwritten', async () => {
    const memento = new DelayedFirstWriteMemento();
    const store = createPreferences(memento);

    const firstUpdate = store.display.setDashboardColumns('tasks', 3);
    await memento.firstWriteStarted;
    const secondUpdate = store.display.setDashboardColumns('tags', 4);
    memento.releaseFirstWrite();
    await Promise.all([firstUpdate, secondUpdate]);

    assert.strictEqual(store.reader.value.dashboardTaskColumns, 3);
    assert.strictEqual(store.reader.value.dashboardTagColumns, 4);
    assert.deepStrictEqual(memento.get('deckard.preferences'), store.reader.value);
    store.repository.dispose();
  });

  test('two windows open at once keep each other\'s machine-wide choices', async () => {
    const machine = new MemoryMemento();
    const first = createPreferences(machine, new MemoryMemento());
    const second = createPreferences(machine, new MemoryMemento());
    await first.repository.initialize();
    await second.repository.initialize();

    await first.display.setTagSortMode('count');
    // The second window, which read the machine-wide blob before that
    // choice, records a visit to a tag.
    await second.usage.recordTagAccess('#project/atlas');
    await second.favorites.toggleFavorite('#project/atlas');

    const later = createPreferences(machine, new MemoryMemento());
    assert.strictEqual(later.reader.value.tagSortMode, 'count', 'the first window\'s sort mode is kept');
    assert.strictEqual(second.reader.value.tagSortMode, 'alphabetical', 'the second window shows what it read');
    const copy = machine.get<{ favoriteTags: string[]; tagAccessOrder: string[] }>('deckard.preferences');
    assert.deepStrictEqual(copy?.favoriteTags, ['#project/atlas'], 'the whole copy is the last workspace\'s');
    assert.deepStrictEqual(copy?.tagAccessOrder, second.reader.value.tagAccessOrder);

    // A machine-wide choice a window makes is still written, even when the
    // window held that value already and another window changed it since.
    await second.display.setTagSortMode('alphabetical');
    assert.strictEqual(createPreferences(machine, new MemoryMemento()).reader.value.tagSortMode, 'alphabetical');
    for (const store of [first, second, later]) {
      store.repository.dispose();
    }
  });

  test('a window with no folder open keeps another\'s choices too', async () => {
    const machine = new MemoryMemento();
    const first = createPreferences(machine);
    const second = createPreferences(machine);
    await first.display.setTagSortMode('count');
    await second.favorites.toggleFavorite('#project/atlas');
    const later = createPreferences(machine);
    assert.strictEqual(later.reader.value.tagSortMode, 'count');
    assert.deepStrictEqual(later.reader.value.favoriteTags, ['#project/atlas']);
    for (const store of [first, second, later]) {
      store.repository.dispose();
    }
  });

  test('knows whether Home still holds the widgets it started with', () => {
    assert.strictEqual(isDefaultHomeLayout(DEFAULT_DASHBOARD_WIDGETS), true);
    assert.strictEqual(
      isDefaultHomeLayout(DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget }))),
      true,
      'a copy with the same settings is the same layout',
    );
    // Try next leads and is left alone; the search box is the widget moved.
    const [tryNext, search, ...rest] = DEFAULT_DASHBOARD_WIDGETS;
    assert.strictEqual(isDefaultHomeLayout([tryNext, ...rest]), false, 'a widget removed');
    assert.strictEqual(
      isDefaultHomeLayout([tryNext, ...rest, search]),
      false,
      'a widget moved',
    );
    assert.strictEqual(
      isDefaultHomeLayout([
        tryNext,
        search,
        { ...rest[0], width: 'full' },
        ...rest.slice(1),
      ]),
      false,
      'a widget sized',
    );
    assert.strictEqual(
      isDefaultHomeLayout([
        tryNext,
        search,
        { ...rest[0], count: 10 },
        ...rest.slice(1),
      ]),
      false,
      'a widget set to show more',
    );
  });

  test('moves favorites, ranking, and saved views to a renamed or merged tag', async () => {
    const memento = new MemoryMemento();
    const store = createPreferences(memento);

    await store.favorites.toggleFavorite('#apollo');
    await store.favorites.toggleFavorite('#atlas');
    await store.usage.recordTagAccess('#apollo');
    await store.usage.recordTagAccess('#apollo');
    await store.usage.recordTagAccess('#atlas');
    await store.savedSearches.saveSavedFilter('Both', ['#apollo', '#atlas']);
    await store.savedSearches.saveSavedFilter('Apollo follow-up', ['#apollo', '#follow-up']);

    await store.tagRenames.replaceTagKey('#apollo', '#atlas');

    assert.deepStrictEqual(store.reader.value.favoriteTags, ['#atlas']);
    assert.deepStrictEqual(store.reader.value.tagAccessCounts, { '#atlas': 3 });
    // A view left with one tag is no longer a filter, so it is dropped.
    assert.deepStrictEqual(
      store.reader.value.savedFilters.map((filter) => [filter.name, filter.tagKeys]),
      [['Apollo follow-up', ['#atlas', '#follow-up']]],
    );
    store.repository.dispose();
  });
});
