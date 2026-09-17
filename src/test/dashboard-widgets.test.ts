import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  DashboardWidgetConfig,
  PersistedPreferences,
  WorkspaceIndex,
} from '../core/types';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';

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
  taskBoardTaskFilter: 'active',
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
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
    { now, upcomingDays: 7, tagTitleDisplayMode: 'inline' },
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

  test('groups the agenda, and names favorite and frequent tags', () => {
    const [agenda, favorites, frequent] = widgets([
      { id: 'a', kind: 'agenda', width: 'half', count: 5 },
      { id: 'f', kind: 'favoriteTags', width: 'half', count: 5 },
      { id: 'r', kind: 'topTags', width: 'half', count: 5 },
    ]);
    assert.deepStrictEqual(
      agenda.agenda?.map((group) => [group.id, group.count]),
      [['overdue', 1], ['today', 1]],
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

  test('gives the search widget its box, and counts the workspace', () => {
    const [search, stats] = widgets([
      { id: 's', kind: 'search', width: 'full' },
      { id: 'w', kind: 'stats', width: 'full' },
    ]);
    assert.strictEqual(search.searchState?.text, '');
    assert.deepStrictEqual(
      search.searchState?.suggestions.recent.map((item) => item.value),
      ['is:open', '#risk/vendor', 'ledger'],
    );
    assert.deepStrictEqual(
      stats.stats?.map((stat) => [stat.label, stat.value]),
      [
        ['Notes', 2],
        ['Files', 2],
        ['Open tasks', 3],
        ['Tasks', 4],
        ['Tags', 2],
        ['Entities', 2],
      ],
    );
  });
});
