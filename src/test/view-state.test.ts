import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  createSidebarSnapshot,
  createDashboardSnapshot,
  createTagOverviewSnapshot,
  createTagOverviewSidebarSnapshot,
  matchesTaskFilter,
  sortTasks,
  sortTagOverviewCards,
  sortTags,
} from '../ui/state/dashboardState';
import {
  ParsedFile,
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
  tagSortMode: 'alphabetical',
  tagAccessOrder: [],
  tagAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank',
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
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

  test('filters tasks and preserves explicit task display order', () => {
    const tasks = [
      createTask('first', false, 1, ['work']),
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
    assert.strictEqual(matchesTaskFilter(tasks[0], 'active', ['work']), true);
    assert.strictEqual(matchesTaskFilter(tasks[0], 'active', ['home']), false);
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
      ['alpha', 'middle', 'zeta'],
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
      ['First reference', 'Second reference'],
    );
    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.fileName),
      ['related.md', 'related.md'],
    );
    assert.deepStrictEqual(
      snapshot.notes.map((note) => note.sourceLine),
      [1, 3],
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

    const snapshot = createTagOverviewSnapshot(index, preferences, 'work');

    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections[0].heading, 'Heading');
    assert.strictEqual(snapshot.sections[0].rawContent, 'Body text');
    assert.strictEqual(snapshot.sections[0].createdAt, 10);
    assert.strictEqual(snapshot.sections[0].updatedAt, 20);
    assert.strictEqual(snapshot.sections[0].accessCount, 4);
  });

  test('includes inline-only notes in tag overview cards', () => {
    const parsed = parseMarkdown('notes/inline-only.md', 'Inline note #work');
    const index = createFileIndex([parsed]);

    const snapshot = createTagOverviewSnapshot(
      index,
      defaultPreferences,
      'work',
    );

    assert.ok(snapshot);
    assert.strictEqual(snapshot.sections.length, 1);
    assert.strictEqual(snapshot.sections[0].heading, 'Inline note');
    assert.deepStrictEqual(snapshot.sections[0].tags, [
      { key: 'work', label: '#work' },
    ]);
    assert.strictEqual(snapshot.sections[0].startLine, 1);
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
      'work',
    );

    assert.ok(overview);
    const sidebar = createTagOverviewSidebarSnapshot(overview);

    assert.deepStrictEqual(
      sidebar.notes.map((note) => note.filePath),
      ['notes/first.md', 'notes/second.md', 'notes/first.md'],
    );
    assert.deepStrictEqual(
      sidebar.notes.map((note) => note.title),
      ['Alpha', 'Beta', 'Zeta'],
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
      key: 'work',
      label: '#work',
    });
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
    tags: [],
    rawContent: '',
    renderedHtml: '',
    startLine: 1,
    createdAt,
    updatedAt,
    accessCount,
  };
}
