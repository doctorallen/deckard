import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { evaluateQuery } from '../core/query/queryEvaluator';
import { parseQuery } from '../core/query/queryParser';
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

  test('shows today\'s note, stale tasks, and where Quick add writes', () => {
    const index = createWorkIndex();
    const [today, quickAdd, stale] = widgets(
      [
        { id: 'd', kind: 'todayNote', width: 'half', count: 5 },
        { id: 'q', kind: 'quickAdd', width: 'full' },
        { id: 's', kind: 'staleTasks', width: 'half', count: 5, days: 30 },
      ],
      index,
    );
    assert.deepStrictEqual(today.today, {
      date: '2026-09-16',
      filePath: 'notes/2026-09-16.md',
      openTaskCount: 1,
    });
    assert.deepStrictEqual(today.tasks?.map((entry) => entry.task.lineNumber), [2]);
    assert.strictEqual(quickAdd.today?.filePath, 'notes/2026-09-16.md');
    assert.strictEqual(quickAdd.tasks, undefined, 'Quick add lists nothing');
    assert.deepStrictEqual(
      stale.tasks?.map((entry) => entry.task.title),
      ['Forgotten task'],
      'only the open task in the note left alone for 60 days',
    );

    const [noNote] = createDashboardWidgets(
      index,
      { ...preferences, dashboardWidgets: [{ id: 'd', kind: 'todayNote', width: 'half' }] },
      { now: now + DAY, upcomingDays: 7, tagTitleDisplayMode: 'inline' },
    );
    assert.deepStrictEqual(noNote.today, { date: '2026-09-17', openTaskCount: 0 });
  });

  test('ranks notes related to the last note, and lists pinned notes', () => {
    const index = createWorkIndex();
    const [related, pinned] = createDashboardWidgets(
      index,
      {
        ...preferences,
        pinnedNotes: [
          { filePath: 'notes/hub.md' },
          { filePath: 'notes/gone.md' },
        ],
        dashboardWidgets: [
          { id: 'r', kind: 'relatedNotes', width: 'half', count: 5 },
          { id: 'p', kind: 'pinnedNotes', width: 'half', count: 5 },
        ],
      },
      {
        now,
        upcomingDays: 7,
        tagTitleDisplayMode: 'inline',
        sourceNotePath: 'notes/old.md',
      },
    );
    assert.strictEqual(related.sourceNote?.title, 'Old notes');
    assert.ok(
      related.notes?.some((note) => note.filePath === 'notes/2026-09-16.md'),
      'a note sharing its tags is related',
    );
    assert.ok(related.notes?.every((note) => note.filePath !== 'notes/old.md'));

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
    assert.strictEqual(
      pinned.sourceNote,
      undefined,
      'Home lists pins; it does not offer to make one',
    );

    const [nothingOpen] = widgets(
      [{ id: 'r', kind: 'relatedNotes', width: 'half' }],
      index,
    );
    assert.strictEqual(nothingOpen.sourceNote, undefined);
    assert.deepStrictEqual(nothingOpen.notes, []);
  });

  test('ranks tag pairs by the entries carrying both, not by one line', () => {
    // Harbor scopes six check-ins from its heading, so Sable and Harbor are
    // carried together six times without ever being written on one line.
    // Courier and the invoice are written side by side once.
    const files = [
      parseMarkdown(
        'notes/harbor.md',
        [
          '# Harbor #team/harbor',
          '## Check-in one #person/sable-ortiz',
          'Prose.',
          '## Check-in two #person/sable-ortiz',
          'Prose.',
          '## Check-in three #person/sable-ortiz',
          'Prose.',
        ].join('\n'),
      ),
      parseMarkdown(
        'notes/courier.md',
        '# Courier #contact/courier #feature/repair-invoice\nWritten together, once.',
      ),
    ];
    const index = buildWorkspaceIndex(
      new Map(files.map((file) => [file.filePath, file])),
    );

    const [pairs] = createDashboardWidgets(
      index,
      {
        ...preferences,
        dashboardWidgets: [{ id: 'p', kind: 'tagPairs', width: 'full', count: 10 }],
      },
      { now, upcomingDays: 7, tagTitleDisplayMode: 'inline' },
    );

    const listed = pairs.tagPairs ?? [];
    const first = listed[0];
    assert.deepStrictEqual(
      first.tags.map((tag) => tag.key),
      ['#person/sable-ortiz', '#team/harbor'],
      'the pair carried by more entries comes first, however it was written',
    );
    assert.ok(
      first.count > 1,
      'a pair that never shares a line still counts more than once',
    );
    const once = listed.find((pair) =>
      pair.tags.some((tag) => tag.key === '#contact/courier'),
    );
    assert.strictEqual(once?.count, 1);
    assert.ok(
      listed.indexOf(first) < listed.indexOf(once!),
      'the once-written pair ranks below it',
    );
  });

  test('counts a pair as the search the row opens counts it', () => {
    const index = createWorkIndex();
    const [pairs] = createDashboardWidgets(
      index,
      {
        ...preferences,
        dashboardWidgets: [{ id: 'p', kind: 'tagPairs', width: 'full', count: 20 }],
      },
      { now, upcomingDays: 7, tagTitleDisplayMode: 'inline' },
    );

    // Pressing a row searches for both tags. The number beside it has to be
    // the number that search then shows, or the row argues with itself.
    for (const pair of pairs.tagPairs ?? []) {
      const query = `${pair.tags[0].key} AND ${pair.tags[1].key}`;
      const results = evaluateQuery(index, parseQuery(query).node);
      assert.strictEqual(
        results.sections.length + results.files.length + results.tasks.length,
        pair.count,
        query,
      );
    }
  });

  test('lists tags written together, tags without a hub, and new tags', () => {
    const index = createWorkIndex();
    const [pairs, unhubbed, fresh] = createDashboardWidgets(
      index,
      {
        ...preferences,
        tagFirstSeen: {
          '#project/atlas': 0,
          '#risk/vendor': now - 2 * DAY,
          '#team/harbor': now - 40 * DAY,
        },
        dashboardWidgets: [
          { id: 'p', kind: 'tagPairs', width: 'half', count: 5 },
          { id: 'u', kind: 'unhubbedTags', width: 'half', count: 5 },
          { id: 'n', kind: 'newTags', width: 'half', count: 5, days: 14 },
        ],
      },
      { now, upcomingDays: 7, tagTitleDisplayMode: 'inline' },
    );
    assert.deepStrictEqual(
      pairs.tagPairs?.map((pair) => pair.tags.map((tag) => tag.key)),
      [['#project/atlas', '#risk/vendor']],
      'each pair is listed once',
    );
    assert.ok((pairs.tagPairs?.[0].count ?? 0) > 0);
    assert.match(pairs.tagPairs?.[0].detail ?? '', /carry both/);

    assert.deepStrictEqual(
      unhubbed.tags?.map((tag) => tag.key),
      ['#risk/vendor'],
      'Atlas has a hub, and Harbor is used too little',
    );

    assert.deepStrictEqual(fresh.tags?.map((tag) => tag.key), ['#risk/vendor']);
    assert.match(fresh.tags?.[0].detail ?? '', /^First seen 2 days ago · /);
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
