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
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
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

  test('ranks notes by shared tags across every section in the note', () => {
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

    assert.deepStrictEqual(
      snapshot.notes.slice(0, 3).map((note) => note.filePath),
      [
        'notes/z-stronger.md',
        'notes/z-stronger.md',
        'notes/z-stronger.md',
      ],
    );
    assert.strictEqual(snapshot.notes[0].matchCount, 3);
    assert.deepStrictEqual(
      snapshot.notes[0].matchedTags.map((tag) => tag.key),
      ['#case', '#urgent', '#work'],
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
    assert.strictEqual(associatedNote.relevanceScore, 50);
    assert.deepStrictEqual(associatedNote.reasons, ['Associated: #risk/operations']);
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
      ['First reference #work', 'Second reference #work'],
    );
    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.fileName),
      ['related.md', 'related.md'],
    );
    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.sourceLine),
      [1, 3],
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
      ['First reference', 'Second reference'],
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
