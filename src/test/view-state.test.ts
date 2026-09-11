import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  createSidebarSnapshot,
  createDeckardStatsSnapshot,
  createDashboardSnapshot,
  createTagOverviewSnapshot,
  createTagOverviewSidebarSnapshot,
  matchesTaskFilter,
  rankRelatedNotes,
  sortEntities,
  sortRelatedNotes,
  sortTasks,
  sortTagOverviewCards,
  sortTags,
} from '../ui/state/dashboardState';
import {
  ParsedFile,
  Entity,
  PersistedPreferences,
  RankedNote,
  Section,
  TagOverviewCard,
  TagInfo,
  Task,
  WorkspaceIndex,
} from '../core/types';

const defaultPreferences: PersistedPreferences = {
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
  dashboardTagColumns: 2,
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [],
};

suite('Dashboard state', () => {
  test('puts favorites first and applies the selected tag sort', () => {
    const tags: TagInfo[] = [
      createTag('zeta', 4),
      createTag('alpha', 1),
      createTag('beta', 8),
    ];
    const preferences = {
      ...defaultPreferences,
      favoriteTags: ['alpha'],
      tagSortMode: 'count' as const,
    };

    assert.deepStrictEqual(
      sortTags(tags, preferences).map((tag) => tag.key),
      ['alpha', 'beta', 'zeta'],
    );
  });

  test('uses the persisted order for custom tag sorting', () => {
    const tags: TagInfo[] = [
      createTag('alpha', 1),
      createTag('beta', 2),
      createTag('gamma', 3),
    ];
    const preferences = {
      ...defaultPreferences,
      tagSortMode: 'custom' as const,
      tagAccessOrder: ['gamma', 'alpha', 'beta'],
    };

    assert.deepStrictEqual(
      sortTags(tags, preferences).map((tag) => tag.key),
      ['gamma', 'alpha', 'beta'],
    );
  });

  test('sorts tags by access counts separately from custom rank', () => {
    const tags: TagInfo[] = [
      createTag('alpha', 1),
      createTag('beta', 2),
      createTag('gamma', 3),
    ];
    const preferences = {
      ...defaultPreferences,
      tagSortMode: 'access' as const,
      tagAccessOrder: ['alpha', 'beta', 'gamma'],
      tagAccessCounts: { alpha: 1, beta: 3, gamma: 2 },
    };

    assert.deepStrictEqual(
      sortTags(tags, preferences).map((tag) => tag.key),
      ['beta', 'gamma', 'alpha'],
    );
  });

  test('sorts entities by count, access, and custom rank', () => {
    const entities: Entity[] = [
      createEntity('#project/atlas', 'Atlas', 2),
      createEntity('@mara-vale', 'Mara Vale', 5),
      createEntity('#topic/operations', 'Operations', 3),
    ];

    assert.deepStrictEqual(
      sortEntities(entities, {
        ...defaultPreferences,
        entitySortMode: 'count',
      }).map((entity) => entity.key),
      ['@mara-vale', '#topic/operations', '#project/atlas'],
    );
    assert.deepStrictEqual(
      sortEntities(entities, {
        ...defaultPreferences,
        favoriteEntities: ['#project/atlas'],
        entitySortMode: 'count',
      }).map((entity) => entity.key),
      ['#project/atlas', '@mara-vale', '#topic/operations'],
    );
    assert.deepStrictEqual(
      sortEntities(entities, {
        ...defaultPreferences,
        entitySortMode: 'access',
        entityAccessCounts: { '#project/atlas': 4, '@mara-vale': 1 },
      }).map((entity) => entity.key),
      ['#project/atlas', '@mara-vale', '#topic/operations'],
    );
    assert.deepStrictEqual(
      sortEntities(entities, {
        ...defaultPreferences,
        entitySortMode: 'custom',
        entityAccessOrder: ['#topic/operations', '#project/atlas'],
      }).map((entity) => entity.key),
      ['#topic/operations', '#project/atlas', '@mara-vale'],
    );
  });

  test('projects current index totals and valid view counts for stats', () => {
    const first = createFile(
      'notes/first.md',
      '# Relay #project/relay\nSee [[Second]].\n- [ ] Call @mara-vale',
    );
    const second = createFile('notes/second.md', '# Second #project/relay');
    const index = createFileIndex([first, second]);
    const stats = createDeckardStatsSnapshot(index, {
      ...defaultPreferences,
      tagAccessCounts: { '#project/relay': 3, missing: 9 },
      entityAccessCounts: { '#project/relay': 2 },
      sectionAccessCounts: { [first.sections[0].id]: 4 },
    });

    assert.strictEqual(stats.fileCount, 2);
    assert.strictEqual(stats.sectionCount, 2);
    assert.strictEqual(stats.taskCount, 1);
    assert.strictEqual(stats.activeTaskCount, 1);
    assert.strictEqual(stats.entityCount, 2);
    assert.strictEqual(stats.wikiLinkCount, 1);
    assert.deepStrictEqual(stats.tagViews, [
      {
        label: '#project/relay',
        detail: '2 indexed entries',
        count: 3,
      },
    ]);
    assert.strictEqual(stats.entityViews[0].label, 'relay');
    assert.strictEqual(stats.sectionViews[0].label, 'Relay');
  });

  test('filters tasks and preserves explicit task display order', () => {
    const tasks = [
      createTask('first', false, 1, ['#work']),
      createTask('second', true, 2),
      createTask('third', false, 3),
    ];
    const index = createIndex(tasks);
    const preferences = {
      ...defaultPreferences,
      taskOrder: [tasks[2].id, tasks[0].id, tasks[1].id],
    };
    const snapshot = createDashboardSnapshot(index, preferences, 'active');

    assert.strictEqual(snapshot.totalTaskCount, 3);
    assert.strictEqual(snapshot.activeTaskCount, 2);
    assert.deepStrictEqual(
      snapshot.tasks.map((item) => item.task.title),
      ['third', 'first'],
    );
    assert.strictEqual(matchesTaskFilter(tasks[1], 'completed'), true);
    assert.strictEqual(matchesTaskFilter(tasks[1], 'active'), false);
    assert.strictEqual(matchesTaskFilter(tasks[0], 'active', ['#work']), true);
    assert.strictEqual(matchesTaskFilter(tasks[0], 'active', ['home']), false);
  });

  test('keeps lightweight tags alongside canonical entities in the dashboard', () => {
    const parsed = createFile(
      'notes/project.md',
      '# Project #project-name #project/project-name #management/performance',
    );
    const index = createFileIndex([parsed]);
    const snapshot = createDashboardSnapshot(index, defaultPreferences, 'active');

    assert.strictEqual(
      snapshot.tags.some((tag) => tag.key === '#project-name'),
      true,
    );
    assert.strictEqual(
      snapshot.entities.some((entity) => entity.key === '#project-name'),
      false,
    );
    assert.strictEqual(
      snapshot.entities.some((entity) => entity.key === '#project/project-name'),
      true,
    );
    assert.strictEqual(
      snapshot.entities.find(
        (entity) => entity.key === '#management/performance',
      )?.kind,
      'management',
    );
    assert.strictEqual(
      createTagOverviewSnapshot(
        index,
        defaultPreferences,
        '#management/performance',
      )?.entity?.name,
      'performance',
    );
  });

  test('projects saved filters only while every saved tag remains indexed', () => {
    const parsed = createFile(
      'notes/saved-filter.md',
      '# Atlas #project/atlas #follow-up #urgent',
    );
    const index = createFileIndex([parsed]);
    const snapshot = createDashboardSnapshot(index, {
      ...defaultPreferences,
      savedFilters: [
        {
          id: 'atlas-follow-up',
          name: 'Atlas follow-up',
          tagKeys: ['#follow-up', '#project/atlas', '#urgent'],
        },
        {
          id: 'stale',
          name: 'Stale',
          tagKeys: ['#follow-up', '#missing'],
        },
      ],
    }, 'active');

    assert.deepStrictEqual(snapshot.savedFilters, [
      {
        id: 'atlas-follow-up',
        name: 'Atlas follow-up',
        tags: [
          { key: '#follow-up', label: '#follow-up' },
          { key: '#project/atlas', label: '#project/atlas' },
          { key: '#urgent', label: '#urgent' },
        ],
      },
    ]);
  });

  test('renders task titles as inline Markdown', () => {
    const title = '[Read the docs](https://example.com/docs) **now**';
    const snapshot = createDashboardSnapshot(
      createIndex([createTask(title, false, 1)]),
      defaultPreferences,
      'active',
    );

    assert.ok(
      snapshot.tasks[0].renderedTitle.includes(
        '<a href="https://example.com/docs">Read the docs</a>',
      ),
    );
    assert.ok(snapshot.tasks[0].renderedTitle.includes('<strong>now</strong>'));
    assert.strictEqual(snapshot.tasks[0].renderedTitle.includes(title), false);
  });

  test('sorts tasks by rank, creation date, and update date', () => {
    const first = createTask('first', false, 1, [], 10, 30);
    const second = createTask('second', false, 2, [], 30, 10);
    const third = createTask('third', false, 3, [], 20, 20);

    assert.deepStrictEqual(
      sortTasks(
        [first, second, third],
        [third.id, first.id, second.id],
        'rank',
      ).map((task) => task.title),
      ['third', 'first', 'second'],
    );
    assert.deepStrictEqual(
      sortTasks([first, second, third], [], 'created').map(
        (task) => task.title,
      ),
      ['second', 'third', 'first'],
    );
    assert.deepStrictEqual(
      sortTasks([first, second, third], [], 'updated').map(
        (task) => task.title,
      ),
      ['first', 'third', 'second'],
    );
  });

  test('ranks related notes by matching tags before overlap', () => {
    const active = createFile(
      'notes/current.md',
      '# Current #work #urgent #case',
    );
    const related = createFile(
      'notes/related.md',
      '# Related #work #urgent #extra',
    );
    const weak = createFile('notes/weak.md', '# Weak #work #other #third');
    const index = createFileIndex([active, related, weak]);

    const snapshot = createSidebarSnapshot(index, active.filePath, active);

    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.filePath),
      ['notes/related.md', 'notes/weak.md'],
    );
    assert.strictEqual(snapshot.notes[0].matchCount, 2);
    assert.strictEqual(snapshot.notes[0].totalTagCount, 3);
  });

  test('scores each related entry from its own shared tags', () => {
    const active = createFile(
      'notes/current.md',
      '# Current #work #urgent #case',
    );
    const weaker = createFile('notes/a-weaker.md', '# Weaker #work');
    const stronger = createFile(
      'notes/z-stronger.md',
      '# Stronger #work\n\n## Urgent #urgent\n\n## Case #case',
    );
    const index = createFileIndex([active, weaker, stronger]);

    const snapshot = createSidebarSnapshot(index, active.filePath, active);

    const strongerEntries = snapshot.notes.filter(
      (note) => note.filePath === 'notes/z-stronger.md',
    );
    assert.strictEqual(strongerEntries.length, 3);
    assert.deepStrictEqual(
      strongerEntries.map((note) => note.matchCount),
      [1, 1, 1],
    );
    const weakerNote = snapshot.notes.find(
      (note) => note.filePath === 'notes/a-weaker.md',
    );
    assert.ok(weakerNote);
    assert.strictEqual(weakerNote.matchCount, 1);
  });

  test('includes notes through weighted tag associations', () => {
    const active = createFile(
      'notes/current.md',
      '# Current #project/ghostline',
    );
    const bridge = createFile(
      'notes/bridge.md',
      '# Risk register #project/ghostline #risk/operations',
    );
    const associated = createFile(
      'notes/associated.md',
      '# Vendor assessment #risk/operations',
    );
    const index = createFileIndex([active, bridge, associated]);

    const snapshot = createSidebarSnapshot(index, active.filePath, active, false);

    const associatedNote = snapshot.notes.find(
      (note) => note.filePath === 'notes/associated.md',
    );
    assert.ok(associatedNote);
    assert.strictEqual(associatedNote.matchCount, 0);
    assert.strictEqual(associatedNote.associationWeight, 1);
    assert.strictEqual(associatedNote.relevanceScore, 14);
    assert.deepStrictEqual(associatedNote.reasons, ['Associated: #risk/operations']);
  });

  test('uses diminishing returns for stronger association evidence', () => {
    const active = createFile('notes/current.md', '# Current #source');
    const weakBridge = createFile(
      'notes/weak-bridge.md',
      '# Weak bridge #source #weak',
    );
    const strongBridge = createFile(
      'notes/strong-bridge.md',
      '# Strong bridge #source #strong\n\n## Repeated evidence #source #strong',
    );
    const weak = createFile('notes/weak.md', '# Weak #weak');
    const strong = createFile('notes/strong.md', '# Strong #strong');
    const index = createFileIndex([
      active,
      weakBridge,
      strongBridge,
      weak,
      strong,
    ]);

    const notes = rankRelatedNotes(
      index,
      active.filePath,
      active,
      [{ key: '#source', label: '#source' }],
      false,
    );
    const weakNote = notes.find((note) => note.filePath === weak.filePath);
    const strongNote = notes.find((note) => note.filePath === strong.filePath);

    assert.ok(weakNote);
    assert.ok(strongNote);
    assert.ok(strongNote.relevanceScore > weakNote.relevanceScore);
    assert.ok(strongNote.relevanceScore < 50);
  });

  test('normalizes association relevance by support and tag prevalence', () => {
    const active = createFile('notes/current.md', '# Current #source');
    const rareBridge = createFile('notes/rare-bridge.md', '# Bridge #source #rare');
    const commonBridge = createFile('notes/common-bridge.md', '# Bridge #source #common');
    const rare = createFile('notes/rare.md', '# Rare candidate #rare');
    const common = createFile('notes/common.md', '# Common candidate #common');
    const commonOnly = Array.from({ length: 4 }, (_, index) =>
      createFile(`notes/common-${index}.md`, `# Common ${index} #common`),
    );
    const index = createFileIndex([
      active,
      rareBridge,
      commonBridge,
      rare,
      common,
      ...commonOnly,
    ]);
    const associations = index.tagAssociations?.get('#source') ?? [];
    const rareAssociation = associations.find(
      (association) => association.associatedTag.key === '#rare',
    );
    const commonAssociation = associations.find(
      (association) => association.associatedTag.key === '#common',
    );

    assert.ok(rareAssociation);
    assert.ok(commonAssociation);
    assert.strictEqual(rareAssociation.weight, 1);
    assert.strictEqual(rareAssociation.count, 1);
    assert.ok(
      rareAssociation.normalizedWeight > commonAssociation.normalizedWeight,
    );
    assert.ok(
      rareAssociation.associatedTagSourceUnitCount <
        commonAssociation.associatedTagSourceUnitCount,
    );

    const defaultNotes = rankRelatedNotes(
      index,
      active.filePath,
      active,
      [{ key: '#source', label: '#source' }],
      false,
    );
    const minimumSupportNotes = rankRelatedNotes(
      index,
      active.filePath,
      active,
      [{ key: '#source', label: '#source' }],
      false,
      'inline',
      new Map(),
      { associationMinimumSupport: 2 },
    );
    assert.ok(defaultNotes.some((note) => note.filePath === rare.filePath));
    assert.strictEqual(
      minimumSupportNotes.some((note) => note.filePath === rare.filePath),
      false,
    );
  });

  test('adds daily date and heading-path context to related entries', () => {
    const active = createFile('notes/current.md', '# Current #work');
    const daily = createFile(
      'notes/2026-09-10.md',
      '# 2026-09-10\n\n## Project Atlas\n\n### Check-in #work',
    );
    const notes = createSidebarSnapshot(
      createFileIndex([active, daily]),
      active.filePath,
      active,
      false,
    ).notes;
    const checkIn = notes.find((note) => note.title.startsWith('Check-in'));

    assert.ok(checkIn);
    assert.strictEqual(checkIn.dailyDate, '2026-09-10');
    assert.deepStrictEqual(checkIn.headingPath, [
      '2026-09-10',
      'Project Atlas',
      'Check-in',
    ]);
  });

  test('uses entry links and section-scoped lexical evidence separately', () => {
    const active = createFile(
      'notes/current.md',
      '# Current #work\n\n[[Related#Target]]\nNeural archive calibration.',
    );
    const related = createFile(
      'notes/related.md',
      '# Broad #other\n\n## Target #other\nNeural archive calibration.\n\n## Unrelated #other\nOrdinary journal prose.',
    );
    const notes = createSidebarSnapshot(
      createFileIndex([active, related]),
      active.filePath,
      active,
    ).notes;
    const target = notes.find((note) => note.title.startsWith('Target'));
    const broad = notes.find((note) => note.title.startsWith('Broad'));
    const unrelated = notes.find((note) => note.title.startsWith('Unrelated'));

    assert.ok(target);
    assert.strictEqual(target.relevanceEvidence?.entryLinkWeight, 0.5);
    assert.ok((target.relevanceEvidence?.lexicalWeight ?? 0) > 0);
    assert.ok(
      (target.relevanceEvidence?.entryLinkWeight ?? 0) >
        (broad?.relevanceEvidence?.fileLinkWeight ?? 0),
    );
    assert.strictEqual(unrelated?.relevanceEvidence?.lexicalWeight, 0);
  });

  test('keeps optional recency disabled unless a half-life is configured', () => {
    const active = createFile('notes/current.md', '# Current #work');
    const daily = createFile('notes/2099-01-01.md', '# 2099-01-01 #work');
    const index = createFileIndex([active, daily]);
    const disabled = rankRelatedNotes(
      index,
      active.filePath,
      active,
      [{ key: '#work', label: '#work' }],
      false,
    );
    const enabled = rankRelatedNotes(
      index,
      active.filePath,
      active,
      [{ key: '#work', label: '#work' }],
      false,
      'inline',
      new Map(),
      { recencyHalfLifeDays: 30 },
    );

    assert.strictEqual(disabled[0].relevanceEvidence?.recencyWeight, 0);
    assert.strictEqual(enabled[0].relevanceEvidence?.recencyWeight, 0.1);
  });

  test('weights selected-entry ancestor tags below direct tags', () => {
    const active = createFile(
      'notes/current.md',
      '# Current #project-name #follow-up #management/performance',
    );
    const direct = createFile('notes/direct.md', '# Direct #project-name');
    const ancestor = createFile(
      'notes/ancestor.md',
      '# Ancestor #management/performance',
    );
    const index = createFileIndex([active, direct, ancestor]);
    const notes = rankRelatedNotes(
      index,
      active.filePath,
      active,
      [
        { key: '#project-name', label: '#project-name' },
        { key: '#follow-up', label: '#follow-up' },
        { key: '#management/performance', label: '#management/performance' },
      ],
      false,
      'inline',
      new Map([
        ['#project-name', 1],
        ['#follow-up', 1],
        ['#management/performance', 0.5],
      ]),
    );

    assert.deepStrictEqual(
      notes.map((note) => note.filePath),
      ['notes/direct.md', 'notes/ancestor.md'],
    );
    assert.ok(notes[0].relevanceScore > notes[1].relevanceScore);
    assert.strictEqual(notes[0].matchCount, 1);
    assert.strictEqual(notes[1].matchCount, 0.5);
  });

  test('ranks a specific nested tag match above its broad parent section', () => {
    const active = createFile(
      'notes/current.md',
      '## Check-in #project/name #checkin',
    );
    const related = createFile(
      'notes/related.md',
      '# 2026-09-10 #project/name #checkin\n\n### Project check-in #project/name #checkin',
    );
    const index = createFileIndex([active, related]);
    const snapshot = createSidebarSnapshot(index, active.filePath, active);

    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.title),
      [
        'Project check-in #project/name #checkin',
        '2026-09-10 #project/name #checkin',
      ],
    );
    assert.strictEqual(snapshot.notes[0].relevanceScore, 100);
    assert.strictEqual(snapshot.notes[1].relevanceScore, 95);
    assert.ok(
      snapshot.notes[1].reasons?.includes(
        'Broader match contains a more specific entry',
      ),
    );
  });

  test('can disable keyword-only related-note matches', () => {
    const active = createFile(
      'notes/current.md',
      '# Current #work\nSee [[Linked]].\nSignal integrity protocol.',
    );
    const keywordOnly = createFile(
      'notes/keyword-only.md',
      '# Keyword only #other\nSignal integrity protocol.',
    );
    const linked = createFile('notes/linked.md', '# Linked #other');
    const index = createFileIndex([active, keywordOnly, linked]);

    const snapshot = createSidebarSnapshot(
      index,
      active.filePath,
      active,
      false,
    );

    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.filePath),
      ['notes/linked.md'],
    );
  });

  test('sorts related notes by date, matching tags, and local access', () => {
    const active = createFile('notes/current.md', '# Current #work #urgent');
    const oldest = createFile('notes/oldest.md', '# Oldest #work');
    const newest = createFile('notes/newest.md', '# Newest #work');
    const mostTags = createFile(
      'notes/most-tags.md',
      '# Most tags #work #urgent',
    );
    oldest.updatedAt = 100;
    newest.updatedAt = 300;
    mostTags.updatedAt = 200;
    const index = createFileIndex([active, oldest, newest, mostTags]);
    const notes = createSidebarSnapshot(index, active.filePath, active).notes;

    assert.strictEqual(
      sortRelatedNotes(notes, 'newest')[0].filePath,
      'notes/newest.md',
    );
    assert.strictEqual(
      sortRelatedNotes(notes, 'oldest')[0].filePath,
      'notes/oldest.md',
    );
    assert.strictEqual(
      sortRelatedNotes(notes, 'tags')[0].filePath,
      'notes/most-tags.md',
    );
    assert.strictEqual(
      sortRelatedNotes(notes, 'access', {
        [oldest.sections[0].id]: 4,
      })[0].filePath,
      'notes/oldest.md',
    );
  });

  test('sorts Related Notes by displayed relevance before raw match count', () => {
    const notes: RankedNote[] = [
      {
        filePath: 'notes/lower-score.md',
        title: 'Lower score',
        fileName: 'lower-score.md',
        sourceLine: 1,
        headingPath: ['Lower score'],
        titleTags: [],
        matchedTags: [],
        matchCount: 2,
        totalTagCount: 2,
        overlap: 0.97,
        relevanceScore: 97,
      },
      {
        filePath: 'notes/higher-score.md',
        title: 'Higher score',
        fileName: 'higher-score.md',
        sourceLine: 1,
        headingPath: ['Higher score'],
        titleTags: [],
        matchedTags: [],
        matchCount: 1,
        totalTagCount: 2,
        overlap: 1,
        relevanceScore: 100,
      },
    ];

    assert.deepStrictEqual(
      sortRelatedNotes(notes, 'tags').map((note) => note.filePath),
      ['notes/higher-score.md', 'notes/lower-score.md'],
    );
  });

  test('sorts the current note tags alphabetically', () => {
    const active = createFile(
      'notes/current.md',
      '# Current #zeta #Alpha #middle',
    );
    const related = createFile('notes/related.md', '# Related #Alpha');
    const index = createFileIndex([active, related]);

    const snapshot = createSidebarSnapshot(index, active.filePath, active);

    assert.deepStrictEqual(
      snapshot.activeTags.map((tag) => tag.key),
      ['#alpha', '#middle', '#zeta'],
    );
  });

  test('collects active tags from front matter, sections, and tasks', () => {
    const active = createFile(
      'notes/current.md',
      [
        '---',
        'tags: [frontmatter]',
        '---',
        '# Current #section',
        '- [ ] Task #task',
      ].join('\n'),
    );
    const related = createFile('notes/related.md', '# Related #frontmatter');
    const index = createFileIndex([active, related]);

    const snapshot = createSidebarSnapshot(index, active.filePath, active);

    assert.deepStrictEqual(
      snapshot.activeTags.map((tag) => tag.key),
      ['#frontmatter', '#section', '#task'],
    );
  });

  test('keeps each tagged section as a related note reference', () => {
    const active = createFile('notes/current.md', '# Current #work');
    const related = createFile(
      'notes/related.md',
      '# First reference #work\n\n## Second reference #work',
    );
    const index = createFileIndex([active, related]);

    const snapshot = createSidebarSnapshot(index, active.filePath, active);

    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.title),
      ['Second reference #work', 'First reference #work'],
    );
    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.fileName),
      ['related.md', 'related.md'],
    );
    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.sourceLine),
      [3, 1],
    );

    const separate = createSidebarSnapshot(
      index,
      active.filePath,
      active,
      true,
      'tags',
      {},
      'separate',
    );
    assert.deepStrictEqual(
      separate.notes.map((note) => note.title),
      ['Second reference', 'First reference'],
    );
  });

  test('sorts overview cards by access and uses heading as a tie breaker', () => {
    const cards = [
      createCard('Beta', 2),
      createCard('Alpha', 2),
      createCard('Recent', 5),
    ];

    assert.deepStrictEqual(
      sortTagOverviewCards(cards, 'access').map((card) => card.heading),
      ['Recent', 'Alpha', 'Beta'],
    );
  });

  test('supports every overview sort mode with deterministic fallbacks', () => {
    const cards = [
      createCard('Beta', 0, 10, 30),
      createCard('Alpha', 0, 20, 20),
      createCard('Updated', 0, 5, 40),
    ];

    assert.deepStrictEqual(
      sortTagOverviewCards(cards, 'alphabetical').map((card) => card.heading),
      ['Alpha', 'Beta', 'Updated'],
    );
    assert.deepStrictEqual(
      sortTagOverviewCards(cards, 'created').map((card) => card.heading),
      ['Alpha', 'Beta', 'Updated'],
    );
    assert.deepStrictEqual(
      sortTagOverviewCards(cards, 'updated').map((card) => card.heading),
      ['Updated', 'Beta', 'Alpha'],
    );
  });

  test('projects a clean overview card with metadata and body only', () => {
    const parsed = parseMarkdown(
      'notes/overview.md',
      '# Heading #work\n\nBody text',
      { createdAt: 10, updatedAt: 20 },
    );
    const index = createFileIndex([parsed]);
    const preferences = {
      ...defaultPreferences,
      sectionAccessCounts: { [parsed.sections[0].id]: 4 },
    };

    const snapshot = createTagOverviewSnapshot(index, preferences, '#work');

    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections[0].heading, 'Heading #work');
    assert.deepStrictEqual(snapshot.sections[0].titleTags, [
      { key: '#work', label: '#work' },
    ]);
    assert.strictEqual(snapshot.sections[0].rawContent, 'Body text');
    assert.strictEqual(snapshot.sections[0].createdAt, 10);
    assert.strictEqual(snapshot.sections[0].updatedAt, 20);
    assert.strictEqual(snapshot.sections[0].accessCount, 4);
    assert.strictEqual(snapshot.layout, 'tabs');

    const separate = createTagOverviewSnapshot(
      index,
      preferences,
      '#work',
      'active',
      'separate',
    );
    assert.ok(separate);
    assert.strictEqual(separate.sections[0].heading, 'Heading');
  });

  test('filters a tag overview to entries carrying both relationship tags', () => {
    const parsed = createFile(
      'notes/filtered-relationship.md',
      [
        '# Parent route #parent #child',
        '## Shared child #child',
        '- [ ] Both tags #parent #child',
        '# Child-only route #child',
        '- [ ] Child only',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);
    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#child',
      'active',
      'inline',
      true,
      '#parent',
    );

    assert.ok(snapshot);
    assert.deepStrictEqual(snapshot.filterTag, {
      key: '#parent',
      label: '#parent',
    });
    assert.deepStrictEqual(
      snapshot.sections.map((section) => section.heading),
      ['Parent route #parent #child', 'Shared child #child'],
    );
    assert.deepStrictEqual(
      snapshot.tasks.map((item) => item.task.title),
      ['Both tags #parent #child'],
    );
    assert.deepStrictEqual(
      createTagOverviewSidebarSnapshot(snapshot).tagOverviewFilter,
      { key: '#parent', label: '#parent' },
    );

    const reverse = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#parent',
      'active',
      'inline',
      true,
      '#child',
    );
    assert.ok(reverse);
    assert.deepStrictEqual(
      reverse.sections.map((section) => section.heading),
      ['Parent route #parent #child', 'Shared child #child'],
    );
    assert.deepStrictEqual(
      reverse.tasks.map((item) => item.task.title),
      ['Both tags #parent #child'],
    );
  });

  test('accumulates overview filters and intersects associated sidebar tags', () => {
    const parsed = createFile(
      'notes/multi-filtered-relationship.md',
      [
        '# All routes #focus #first #second #shared',
        '- [ ] All routes task #focus #first #second',
        '# First route #focus #first #shared #first-only',
        '# Second route #focus #second #shared',
        '# Filter-only route #first #second #shared',
        '# Focus-only association #focus #unavailable',
        '# First-only association #first #unavailable',
        '# Second-only association #second #unavailable',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);
    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#focus',
      'active',
      'inline',
      true,
      undefined,
      ['#first', '#second', '#first'],
    );

    assert.ok(snapshot);
    assert.deepStrictEqual(snapshot.filterTags, [
      { key: '#first', label: '#first' },
      { key: '#second', label: '#second' },
    ]);
    assert.deepStrictEqual(
      snapshot.sections.map((section) => section.heading),
      ['All routes #focus #first #second #shared'],
    );
    assert.deepStrictEqual(
      snapshot.tasks.map((item) => item.task.title),
      ['All routes task #focus #first #second'],
    );
    assert.deepStrictEqual(
      snapshot.sharedAssociatedTags.map(
        (association) => association.associatedTag.key,
      ),
      ['#shared'],
    );

    const sidebar = createTagOverviewSidebarSnapshot(snapshot);
    assert.deepStrictEqual(sidebar.tagOverviewFilters, snapshot.filterTags);
    assert.deepStrictEqual(
      sidebar.tagOverviewRelationships?.sharedAssociatedTags.map(
        (association) => association.associatedTag.key,
      ),
      ['#shared'],
    );
  });

  test('projects weighted tag associations into tag overviews', () => {
    const parsed = parseMarkdown(
      'notes/relationship-overview.md',
      [
        '# Relay map #parent #co-occurring',
        '## Un tagged details',
        '### Signal route #child',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);

    const overview = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#parent',
    );

    assert.ok(overview);
    assert.deepStrictEqual(
      overview.associatedTags.map((association) => ({
        key: association.associatedTag.key,
        weight: association.weight,
        coOccurrenceCount: association.coOccurrenceCount,
        headingRelationshipCount: association.headingRelationshipCount,
      })),
      [
        { key: '#co-occurring', weight: 1, coOccurrenceCount: 1, headingRelationshipCount: 0 },
        { key: '#child', weight: 0.25, coOccurrenceCount: 0, headingRelationshipCount: 1 },
      ],
    );
  });

  test('filters an association to its exact source entries', () => {
    const parsed = parseMarkdown(
      'notes/sibling-overview.md',
      [
        '## First route #first #second',
        '- [ ] First task #first #second',
        '## Separate route #first',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);

    const filtered = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#second',
      'active',
      'inline',
      true,
      '#first',
    );

    assert.ok(filtered);
    assert.deepStrictEqual(
      filtered.sections.map((section) => section.heading),
      ['First route #first #second'],
    );
    assert.deepStrictEqual(
      filtered.tasks.map((item) => item.task.title),
      ['First task #first #second'],
    );
  });

  test('projects dense relationship groups and supports disabling them', () => {
    const parentTags = Array.from(
      { length: 12 },
      (_, index) => `#parent/${String(index + 1).padStart(2, '0')}`,
    );
    const childTags = Array.from(
      { length: 12 },
      (_, index) => `#child/${String(index + 1).padStart(2, '0')}`,
    );
    const parsed = parseMarkdown(
      'notes/dense-relationships.md',
      [
        `## Parent signal array ${parentTags.join(' ')}`,
        '### Relationship stress test #hub/relationship-overview',
        `#### Child signal array ${childTags.join(' ')}`,
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);

    const enabled = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#hub/relationship-overview',
    );
    const disabled = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#hub/relationship-overview',
      'active',
      'inline',
      false,
    );

    assert.ok(enabled);
    assert.ok(disabled);
    assert.strictEqual(enabled.associatedTags.length, 24);
    assert.deepStrictEqual(disabled.associatedTags, []);
  });

  test('filters generic-tag overview tasks by completion state', () => {
    const parsed = parseMarkdown(
      'notes/work.md',
      '# Work #work\n\n- [ ] Active task\n- [x] Completed task',
    );
    const index = buildWorkspaceIndex(new Map([[parsed.filePath, parsed]]));

    const all = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#work',
      'all',
    );
    const active = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#work',
      'active',
    );
    const completed = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#work',
      'completed',
    );

    assert.ok(all);
    assert.ok(active);
    assert.ok(completed);
    assert.strictEqual(all.taskFilter, 'all');
    assert.deepStrictEqual(all.taskCounts, {
      all: 2,
      active: 1,
      completed: 1,
    });
    assert.strictEqual(
      createTagOverviewSnapshot(index, defaultPreferences, '#work')?.taskFilter,
      'active',
    );
    assert.deepStrictEqual(
      all.tasks.map((item) => item.task.title),
      ['Active task', 'Completed task'],
    );
    assert.deepStrictEqual(
      active.tasks.map((item) => item.task.title),
      ['Active task'],
    );
    assert.deepStrictEqual(
      completed.tasks.map((item) => item.task.title),
      ['Completed task'],
    );
  });

  test('includes inline-only notes in tag overview cards', () => {
    const parsed = parseMarkdown('notes/inline-only.md', 'Inline note #work');
    const index = createFileIndex([parsed]);

    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#work',
    );

    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections.length, 1);
    assert.strictEqual(snapshot.sections[0].heading, 'Inline note #work');
    assert.deepStrictEqual(snapshot.sections[0].tags, [
      { key: '#work', label: '#work' },
    ]);
    assert.deepStrictEqual(snapshot.sections[0].titleTags, [
      { key: '#work', label: '#work' },
    ]);
    assert.strictEqual(snapshot.sections[0].startLine, 1);
  });

  test('keeps tags from wrapped inline entries available as title buttons', () => {
    const parsed = parseMarkdown(
      'notes/wrapped-inline.md',
      [
        '#project/neon-relay is a project. #topic/synthetic-memory is a topic.',
        '#org/lumen-transit is an organization. #meeting/sector-nine-briefing is a',
        'meeting. Ordinary labels such as #follow-up remain lightweight tags.',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);
    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#meeting/sector-nine-briefing',
    );

    assert.ok(snapshot);
    assert.deepStrictEqual(snapshot.sections[0].titleTags, [
      { key: '#project/neon-relay', label: '#project/neon-relay' },
      { key: '#topic/synthetic-memory', label: '#topic/synthetic-memory' },
      { key: '#org/lumen-transit', label: '#org/lumen-transit' },
      {
        key: '#meeting/sector-nine-briefing',
        label: '#meeting/sector-nine-briefing',
      },
      { key: '#follow-up', label: '#follow-up' },
    ]);
  });

  test('keeps numbered inline entries separate in tag overviews', () => {
    const parsed = parseMarkdown(
      'notes/numbered-inline.md',
      [
        '1. @ivo-chen verifies the physical junction.',
        '2. @mara-vale approves an operational exception.',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);

    const ivo = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '@ivo-chen',
    );
    const mara = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '@mara-vale',
    );

    assert.ok(ivo);
    assert.ok(mara);
    assert.deepStrictEqual(ivo.sections.map((section) => section.heading), [
      '1. @ivo-chen verifies the physical junction.',
    ]);
    assert.deepStrictEqual(mara.sections.map((section) => section.heading), [
      '2. @mara-vale approves an operational exception.',
    ]);
    assert.strictEqual(ivo.sections[0].rawContent, '');
    assert.strictEqual(mara.sections[0].rawContent, '');
  });

  test('includes nested bullets in tagged list overview cards', () => {
    const parsed = parseMarkdown(
      'notes/list-item.md',
      [
        '- #project/east-junction',
        '  - Finishing the relay inspection.',
        '  - Moving the patrol to the abandoned platform.',
        '- #project/neon-relay',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);

    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#project/east-junction',
    );

    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections.length, 1);
    assert.strictEqual(
      snapshot.sections[0].rawContent,
      [
        '  - Finishing the relay inspection.',
        '  - Moving the patrol to the abandoned platform.',
      ].join('\n'),
    );
  });

  test('projects tag overview cards into sidebar notes without changing order', () => {
    const first = createFile(
      'notes/first.md',
      '# Zeta #work\n\n## Alpha #work',
    );
    const second = createFile('notes/second.md', '# Beta #work');
    const index = createFileIndex([first, second]);
    const overview = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#work',
    );

    assert.ok(overview);
    const sidebar = createTagOverviewSidebarSnapshot(overview);

    assert.deepStrictEqual(
      sidebar.notes.map((note) => note.filePath),
      ['notes/first.md', 'notes/second.md', 'notes/first.md'],
    );
    assert.deepStrictEqual(
      sidebar.notes.map((note) => note.title),
      ['Alpha #work', 'Beta #work', 'Zeta #work'],
    );
    assert.deepStrictEqual(
      sidebar.notes.map((note) => note.fileName),
      ['first.md', 'second.md', 'first.md'],
    );
    assert.deepStrictEqual(
      sidebar.notes.map((note) => note.sourceLine),
      overview.sections.map((section) => section.startLine),
    );
    assert.deepStrictEqual(sidebar.tagOverview, {
      key: '#work',
      label: '#work',
    });

    const separateOverview = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#work',
      'active',
      'separate',
    );
    assert.ok(separateOverview);
    const separateSidebar = createTagOverviewSidebarSnapshot(separateOverview);
    assert.deepStrictEqual(
      separateSidebar.notes.map((note) => note.title),
      ['Alpha', 'Beta', 'Zeta'],
    );
  });

  test('projects tag associations into the sidebar tree', () => {
    const parsed = createFile(
      'notes/relationship-sidebar.md',
      [
        '# Parent route #parent #focus',
        '## Child route #child',
        '- [ ] Follow up #focus #task',
      ].join('\n'),
    );
    const index = createFileIndex([parsed]);
    const overview = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#focus',
    );

    assert.ok(overview);
    const sidebar = createTagOverviewSidebarSnapshot(overview);

    assert.deepStrictEqual(
      sidebar.tagOverviewRelationships?.associatedTags.map(
        (association) => association.associatedTag.key,
      ),
      ['#parent', '#task', '#child'],
    );

    const filteredOverview = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      '#focus',
      'active',
      'inline',
      true,
      '#task',
    );
    assert.ok(filteredOverview);
    const filteredSidebar = createTagOverviewSidebarSnapshot(filteredOverview);
    assert.deepStrictEqual(filteredSidebar.tagOverviewFilter, {
      key: '#task',
      label: '#task',
    });
    assert.deepStrictEqual(filteredSidebar.tagOverviewFilters, [
      { key: '#task', label: '#task' },
    ]);
    assert.deepStrictEqual(
      filteredSidebar.tagOverviewRelationships?.associatedTags.map(
        (association) => association.associatedTag.key,
      ),
      ['#parent', '#task', '#child'],
    );
  });
});

function createTag(key: string, count: number): TagInfo {
  return {
    key,
    label: `#${key}`,
    sectionIds: Array.from(
      { length: count },
      (_, index) => `${key}-section-${index}`,
    ),
    taskIds: [],
    filePaths: [],
    count,
    isFavorite: false,
  };
}

function createEntity(key: string, name: string, count: number): Entity {
  return {
    key,
    label: key,
    kind: key.startsWith('@') ? 'person' : 'project',
    name,
    sectionIds: [],
    taskIds: [],
    filePaths: [],
    count,
    isFavorite: false,
  };
}

function createTask(
  title: string,
  completed: boolean,
  lineNumber: number,
  tags: string[] = [],
  createdAt?: number,
  updatedAt?: number,
): Task {
  return {
    id: `task-${title}`,
    filePath: 'notes/today.md',
    sectionId: undefined,
    title,
    completed,
    tags,
    tagLabels: Object.fromEntries(tags.map((tag) => [tag, `#${tag}`])),
    lineNumber,
    checkboxColumn: 3,
    checkboxValue: completed ? 'x' : ' ',
    sourceLineText: `- [${completed ? 'x' : ' '}] ${title}`,
    createdAt,
    updatedAt,
  };
}

function createIndex(tasks: Task[]): WorkspaceIndex {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  return {
    files: new Map(),
    sections: new Map<string, Section>(),
    tasks: taskMap,
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createFile(filePath: string, content: string): ParsedFile {
  return parseMarkdown(filePath, content);
}

function createFileIndex(files: ParsedFile[]): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(files.map((file) => [file.filePath, file])),
  );
}

function createCard(
  heading: string,
  accessCount: number,
  createdAt?: number,
  updatedAt?: number,
): TagOverviewCard {
  return {
    id: heading,
    filePath: `notes/${heading.toLowerCase()}.md`,
    heading,
    titleTags: [],
    tags: [],
    rawContent: '',
    renderedHtml: '',
    startLine: 1,
    createdAt,
    updatedAt,
    accessCount,
  };
}
