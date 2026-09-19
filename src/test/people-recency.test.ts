import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { PersistedPreferences, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createDashboardWidgets } from '../ui/state/dashboardWidgets';
import {
  isPersonTag,
  listPeopleRecency,
  listQuietPeople,
} from '../ui/state/peopleRecency';

/** Only what a widget reads; the rest of Home is not in play here. */
const preferences: PersistedPreferences = {
  version: 1,
  favoriteTags: [],
  favoriteEntities: [],
  tagSortMode: 'alphabetical',
  entitySortMode: 'alphabetical',
  tagAccessOrder: [],
  tagAccessCounts: {},
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
  savedFilters: [],
  recentQueries: [],
  dashboardWidgets: [],
};

const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 8, 19, 9, 0, 0).getTime();

/** Notes with the days they were last written, as front matter states them. */
function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

function day(offset: number): string {
  return new Date(now - offset * DAY).toISOString().slice(0, 10);
}

const index = indexOf({
  'notes/standup.md': [
    '---',
    `updated: ${day(2)}`,
    '---',
    '# Standup',
    '',
    '- [ ] Chase the survey @ren-kade',
    '- [x] Sent the note @ren-kade',
  ].join('\n'),
  'notes/spring-review.md': [
    '---',
    `updated: ${day(120)}`,
    '---',
    '# Spring review',
    '',
    'Walked through the plan with @sable-ortiz and #person/mara-vale.',
    '',
    '- [ ] Book the follow-up @sable-ortiz',
  ].join('\n'),
  'notes/atlas.md': [
    '---',
    `updated: ${day(1)}`,
    '---',
    '# Atlas #project/atlas',
    '',
    'No one is named here.',
  ].join('\n'),
});

suite('People recency', () => {
  test('knows a person tag from any other tag', () => {
    assert.strictEqual(isPersonTag('@ren-kade'), true);
    assert.strictEqual(isPersonTag('#person/mara-vale'), true);
    assert.strictEqual(isPersonTag('#project/atlas'), false);
    assert.strictEqual(isPersonTag('#personnel/policy'), false);
  });

  test('says when each name was last written, and what is open', () => {
    const people = listPeopleRecency(index);
    assert.deepStrictEqual(
      people.map((person) => [
        person.tag.key,
        Math.round((now - person.lastWrittenAt) / DAY),
        person.openTasks,
      ]),
      [
        ['@ren-kade', 2, 1],
        ['@sable-ortiz', 120, 1],
        ['#person/mara-vale', 120, 0],
      ],
      'most recently written first, and only open tasks are counted',
    );
  });

  test('lists who has gone quiet, longest ago first', () => {
    assert.deepStrictEqual(
      listQuietPeople(index, now, 90).map((person) => person.tag.key),
      ['@sable-ortiz', '#person/mara-vale'],
    );
    assert.deepStrictEqual(
      listQuietPeople(index, now, 365).map((person) => person.tag.key),
      [],
      'nobody is quiet when the window is long enough',
    );
    assert.deepStrictEqual(
      listQuietPeople(index, now, 1).map((person) => person.tag.key),
      ['@sable-ortiz', '#person/mara-vale', '@ren-kade'],
    );
  });

  test('draws them on Home with how long it has been', () => {
    const [widget] = createDashboardWidgets(
      index,
      {
        ...preferences,
        dashboardWidgets: [
          { id: 'q', kind: 'quietPeople', width: 'half', count: 5, days: 90 },
        ],
      },
      { now, upcomingDays: 7, tagTitleDisplayMode: 'inline' },
    );
    assert.strictEqual(widget.total, 2);
    assert.deepStrictEqual(
      widget.tags?.map((tag) => tag.key),
      ['@sable-ortiz', '#person/mara-vale'],
    );
    assert.strictEqual(
      widget.tags?.[0].detail,
      'Written 120 days ago · 1 open task',
    );
    assert.match(
      widget.tags?.[1].detail ?? '',
      /^Written 120 days ago · 1 note · 0 tasks$/,
      'someone with nothing open is counted by what mentions them',
    );
  });
});
