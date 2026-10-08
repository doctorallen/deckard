import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { normalizeDashboardWidgets } from '../core/storage/preferencesSchema';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import { createQueryContext } from '../domain/query/queryContext';
import { DashboardWidgetConfig, PersistedPreferences, WorkspaceIndex } from '../domain/model';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 8, 16, 12).getTime();

const preferences: PersistedPreferences = {
  version: 1,
  favoriteTags: ['#project/atlas'],
  favoriteEntities: [],
  tagSortMode: 'alphabetical',
  entitySortMode: 'alphabetical',
  tagAccessOrder: [],
  tagAccessCounts: { '#risk/vendor': 3, '#project/atlas': 1 },
  tagAccessTimes: { '#risk/vendor': now - DAY, '#project/atlas': now - 90 * DAY },
  entityAccessOrder: [],
  entityAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank',
  dashboardTaskColumns: 1,
  dashboardNoteColumns: 1,
  dashboardTagColumns: 2,
  dashboardViewState: { mode: 'home', tagSearchQuery: '' },
  taskBoardLayout: 'board',
  taskBoardGroup: 'status',
  renderMode: 'markdown',
  searchPreview: 'lines',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  searchPageSize: 30,
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [
    { id: 'vendor', name: 'Vendor work', tagKeys: [], query: '#risk/vendor' },
  ],
  recentQueries: ['is:open', '#risk/vendor', 'ledger'],
  dashboardWidgets: [],
};

function createIndex(): WorkspaceIndex {
  const files = [
    parseMarkdown(
      'notes/atlas.md',
      [
        '# Atlas #project/atlas',
        '- [ ] Retire the ledger 📅 2026-09-10',
        '- [ ] Draft the plan 📅 2026-09-16',
        '- [x] Book the room',
      ].join('\n'),
    ),
    parseMarkdown(
      'notes/vendor.md',
      '# Vendor risk #risk/vendor\n- [ ] Call the vendor',
    ),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

function widgets(configs: DashboardWidgetConfig[], index = createIndex()) {
  return createDashboardWidgets(
    index,
    { ...preferences, dashboardWidgets: configs },
    { queryContext: createQueryContext(now) },
  );
}

suite('Dashboard Home widgets', () => {
  test('lists the tasks a widget searches for, as many as it shows', () => {
    const [tasks] = widgets([
      { id: 't', kind: 'tasks', width: 'half', count: 1, query: 'is:open' },
    ]);
    assert.strictEqual(tasks.title, 'Tasks');
    assert.strictEqual(tasks.total, 3);
    assert.strictEqual(tasks.tasks?.length, 1);

    const [broken] = widgets([
      { id: 't', kind: 'tasks', width: 'half', query: '(is:open' },
    ]);
    assert.ok(broken.error, 'a search that does not parse says why');
    assert.deepStrictEqual(broken.tasks, []);
  });

  test('Gone quiet offers only namespaces Home keeps as the one to watch', () => {
    const files = [parseMarkdown('notes/q.md', '# Plan #2026/q1\n# Ren #person/ren\n# Atlas #project/atlas\n')];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const [quiet] = widgets([{ id: 'q', kind: 'quietPeople', width: 'half', count: 5 }], index);
    assert.deepStrictEqual(quiet.namespaces, ['person', 'project']);
    for (const namespace of quiet.namespaces ?? []) {
      const [kept] = normalizeDashboardWidgets([{ id: 'q', kind: 'quietPeople', width: 'half', namespace }]);
      assert.strictEqual(kept.namespace ?? 'person', namespace);
    }
  });

  test('Progress lists a namespace’s tags with tasks, unfinished and overdue first, each with its bar', () => {
    const files = [
      parseMarkdown('notes/atlas.md', '# Atlas #project/atlas\n- [ ] Retire the ledger 📅 2026-09-10\n- [x] Book the room'),
      parseMarkdown('notes/borealis.md', '# Borealis #project/borealis\n- [ ] Ship it 📅 2026-09-20'),
      parseMarkdown('notes/done.md', '# Cirrus #project/cirrus\n- [x] Wrap up'),
      parseMarkdown('notes/quiet.md', '# Delta #project/delta\nNo tasks yet.'),
      parseMarkdown('notes/area.md', '# Home #area/home\n- [ ] Fix the gate'),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const [progress] = widgets([{ id: 'p', kind: 'progress', width: 'half', count: 5 }], index);
    assert.strictEqual(progress.title, 'Progress');
    assert.deepStrictEqual(progress.tags?.map((tag) => tag.key), ['#project/atlas', '#project/borealis', '#project/cirrus']);
    assert.deepStrictEqual(progress.tags?.[0].progress, { done: 1, total: 2 });
    assert.strictEqual(progress.tags?.[0].detail, '1/2 done (50%) · 1 overdue');
    assert.strictEqual(progress.tags?.[1].detail, '0/1 done (0%) · next due in 4 days');
    assert.strictEqual(progress.tags?.[2].detail, '1/1 done (100%) · all done');
    assert.deepStrictEqual(progress.namespaces, ['area', 'project']);

    const [area] = widgets([{ id: 'p', kind: 'progress', width: 'half', count: 5, namespace: 'area' }], index);
    assert.deepStrictEqual(area.tags?.map((tag) => tag.key), ['#area/home']);
    const [kept] = normalizeDashboardWidgets([{ id: 'p', kind: 'progress', width: 'half', namespace: 'project' }]);
    assert.strictEqual(kept.namespace, undefined, 'its default is kept as no namespace');
    const [chosen] = normalizeDashboardWidgets([{ id: 'p', kind: 'progress', width: 'half', namespace: ' Area ' }]);
    assert.strictEqual(chosen.namespace, 'area');
  });

  test('the agenda leaves what needs a new date to a line under its list', () => {
    const files = [
      parseMarkdown(
        'notes/old.md',
        '- [ ] Chase the contractor 📅 2026-09-10\n- [ ] Renew the lease 📅 2026-07-01',
      ),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    const [agenda] = widgets([{ id: 'a', kind: 'agenda', width: 'half', count: 5 }], index);
    assert.deepStrictEqual(agenda.agenda?.map((group) => group.id), ['overdue']);
    assert.strictEqual(agenda.needsNewDate, 1);
    assert.strictEqual(agenda.needsNewDateQuery, 'is:needs-date');
    assert.strictEqual(agenda.total, 1);
    assert.strictEqual(agenda.doneToday, undefined);
    const doneIndex = buildWorkspaceIndex(
      new Map(
        [parseMarkdown('notes/done.md', '- [x] Filed it ✅ 2026-09-16\n- [ ] Next 📅 2026-09-16')].map(
          (file) => [file.filePath, file],
        ),
      ),
    );
    const [done] = widgets([{ id: 'a', kind: 'agenda', width: 'half', count: 5 }], doneIndex);
    assert.strictEqual(done.doneToday, 1);
    assert.deepStrictEqual(done.agenda?.map((group) => group.id), ['today'], 'not a group of the list');
  });

  test('groups the agenda, and names favorite and frequent tags', () => {
    const [agenda, favorites, frequent] = widgets([
      { id: 'a', kind: 'agenda', width: 'half', count: 5 },
      { id: 'f', kind: 'favoriteTags', width: 'half', count: 5 },
      { id: 'r', kind: 'topTags', width: 'half', count: 5 },
    ]);
    assert.deepStrictEqual(
      agenda.agenda?.map((group) => [group.id, group.count]),
      // The widget is the same list as the Tasks view, undated tasks last.
      [['overdue', 1], ['today', 1], ['nodate', 1]],
    );
    assert.deepStrictEqual(favorites.tags?.map((tag) => tag.key), ['#project/atlas']);
    assert.match(favorites.tags?.[0].detail ?? '', /1 note · 3 tasks/);
    assert.deepStrictEqual(
      frequent.tags?.map((tag) => tag.key),
      ['#risk/vendor', '#project/atlas'],
      'opened often and lately comes first',
    );
  });

  test('shows saved searches, their results, and recent searches', () => {
    const [saved, results, missing, recent] = widgets([
      { id: 's', kind: 'savedSearches', width: 'half' },
      { id: 'v', kind: 'savedQuery', width: 'half', count: 5, filterId: 'vendor' },
      { id: 'm', kind: 'savedQuery', width: 'half', count: 5, filterId: 'gone' },
      { id: 'q', kind: 'recentSearches', width: 'half', count: 2 },
    ]);
    assert.deepStrictEqual(saved.savedFilters?.map((filter) => filter.name), ['Vendor work']);
    assert.strictEqual(results.title, 'Vendor work');
    assert.strictEqual(results.savedQuery, '#risk/vendor');
    assert.deepStrictEqual(results.notes?.map((note) => note.title), ['Vendor risk']);
    assert.strictEqual(results.total, 1, 'one open task');
    assert.strictEqual(missing.missing, true);
    assert.deepStrictEqual(recent.queries, ['is:open', '#risk/vendor']);
    assert.strictEqual(recent.total, 3);
  });

  test('gives the search widget its box', () => {
    const [search] = widgets([{ id: 's', kind: 'search', width: 'full' }]);
    assert.strictEqual(search.searchState?.text, '');
    assert.deepStrictEqual(
      search.searchState?.suggestions.recent.map((item) => item.value),
      ['is:open', '#risk/vendor', 'ledger'],
    );
  });

  test('shows today\'s note and its open tasks', () => {
    const index = createWorkIndex();
    const [today] = widgets([{ id: 'd', kind: 'todayNote', width: 'half', count: 5 }], index);
    assert.deepStrictEqual(today.today, {
      date: '2026-09-16',
      filePath: 'notes/2026-09-16.md',
      openTaskCount: 1,
    });
    assert.deepStrictEqual(today.tasks?.map((entry) => entry.task.lineNumber), [2]);

    const [noNote] = createDashboardWidgets(
      index,
      { ...preferences, dashboardWidgets: [{ id: 'd', kind: 'todayNote', width: 'half' }] },
      { queryContext: createQueryContext(now + DAY) },
    );
    assert.deepStrictEqual(noNote.today, { date: '2026-09-17', openTaskCount: 0 });
  });

  test('a stored Stale tasks widget lists what it listed, least recently updated first', () => {
    // Stale tasks dated a task by its note; a task's updated date is its
    // note's, so the search it became finds the same tasks.
    const files = [
      parseMarkdown('notes/a.md', '# A\n- [ ] Forty days', { createdAt: now - 99 * DAY, updatedAt: now - 40 * DAY }),
      parseMarkdown('notes/b.md', '# B\n- [ ] Hundred days\n- [x] Done long ago', { createdAt: now - 199 * DAY, updatedAt: now - 100 * DAY }),
      parseMarkdown('notes/c.md', '# C\n- [ ] Five days', { createdAt: now - 9 * DAY, updatedAt: now - 5 * DAY }),
      parseMarkdown(
        'notes/d.md',
        '---\nupdated: 2026-08-01\n---\n# D\n- [ ] Dated by its front matter',
        { createdAt: now - 9 * DAY, updatedAt: now - 1 * DAY },
      ),
    ];
    const index = buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
    for (const task of index.tasks.values()) {
      assert.strictEqual(task.updatedAt, index.files.get(task.filePath)?.updatedAt, task.title);
    }
    const [stale] = widgets(normalizeDashboardWidgets([{ id: 'stale', kind: 'staleTasks', width: 'half', count: 5, days: 30 }]), index);
    assert.strictEqual(stale.kind, 'tasks');
    assert.strictEqual(stale.title, 'Tasks');
    assert.deepStrictEqual(
      stale.tasks?.map((entry) => entry.task.title),
      ['Hundred days', 'Dated by its front matter', 'Forty days'],
      'open tasks in notes unchanged for 30 days, oldest first, though the board ranks by hand',
    );
  });

  test('lists pinned notes', () => {
    const index = createWorkIndex();
    const [pinned] = createDashboardWidgets(
      index,
      {
        ...preferences,
        pinnedNotes: [
          { filePath: 'notes/hub.md' },
          { filePath: 'notes/gone.md' },
        ],
        dashboardWidgets: [{ id: 'p', kind: 'pinnedNotes', width: 'half', count: 5 }],
      },
      { queryContext: createQueryContext(now) },
    );
    assert.deepStrictEqual(pinned.notes, [
      {
        filePath: 'notes/hub.md',
        line: 1,
        title: 'Atlas hub',
        detail: 'hub.md · notes',
        pinKey: '["notes/hub.md","",0]',
      },
    ]);
    assert.strictEqual(pinned.total, 1, 'a pinned note that is gone is left out');
  });
});

/**
 * Today's daily note, a note left alone for 60 days, a hub for Atlas, and a
 * tag written once.
 */
function createWorkIndex(): WorkspaceIndex {
  const files = [
    parseMarkdown(
      'notes/2026-09-16.md',
      '# 2026-09-16\n- [ ] Plan the day #project/atlas #risk/vendor\n- [x] Water the plants',
      { createdAt: now, updatedAt: now },
    ),
    parseMarkdown(
      'notes/old.md',
      '# Old notes #project/atlas #risk/vendor\n- [ ] Forgotten task',
      { createdAt: now - 90 * DAY, updatedAt: now - 60 * DAY },
    ),
    parseMarkdown(
      'notes/vendor.md',
      '# Vendor #risk/vendor\n- [ ] Call the vendor\n\n# Harbor #team/harbor',
      { createdAt: now - 3 * DAY, updatedAt: now - 2 * DAY },
    ),
    parseMarkdown(
      'notes/hub.md',
      '---\ndescribes: "#project/atlas"\n---\n# Atlas hub',
      { createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY },
    ),
  ];
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}
