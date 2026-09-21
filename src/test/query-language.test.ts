import * as assert from 'assert';

import {
  buildTagIntersectionQuery,
  collectQueryTagKeys,
  formatQuery,
  fromBuilderGroups,
  getQueryTagIntersection,
  toBuilderGroups,
} from '../core/query/queryFormat';
import { parseQuery } from '../core/query/queryParser';
import {
  QUERY_FIELD_OPERATORS,
  QUERY_OPERATOR_INVERSES,
} from '../core/query/queryTypes';
import { evaluateQuery } from '../core/query/queryEvaluator';
import {
  ParsedFile,
  PersistedPreferences,
  Section,
  TagInfo,
  Task,
  WorkspaceIndex,
} from '../core/types';
import {
  createSearchPageSnapshot,
} from '../ui/state/dashboardState';

suite('Deckard query language', () => {
  test('parses a bare tag as a tag condition', () => {
    const parsed = parseQuery('#project/atlas');
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.deepStrictEqual(getQueryTagIntersection(parsed.node), [
      '#project/atlas',
    ]);
  });

  test('parses a bare word as a text condition', () => {
    const parsed = parseQuery('vendor');
    assert.strictEqual(parsed.node?.type, 'condition');
    assert.deepStrictEqual(
      parsed.node?.type === 'condition'
        ? [parsed.node.field, parsed.node.operator, parsed.node.value]
        : undefined,
      ['text', 'contains', 'vendor'],
    );
  });

  test('joins adjacent terms with an implicit AND', () => {
    const parsed = parseQuery('#project/atlas #urgent');
    assert.deepStrictEqual(getQueryTagIntersection(parsed.node), [
      '#project/atlas',
      '#urgent',
    ]);
  });

  test('gives OR lower precedence than AND', () => {
    const parsed = parseQuery('tag:#a AND tag:#b OR tag:#c');
    assert.strictEqual(parsed.node?.type, 'or');
    assert.strictEqual(
      formatQuery(parsed.node),
      'tag = #a AND tag = #b OR tag = #c',
    );
  });

  test('parses the grouped example from the feature request', () => {
    const parsed = parseQuery(
      '(tag:#project/skybridge-signal AND tag:@ren-kade) OR (tag:#risk/service-failure AND text ~ "elevator")',
    );
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.strictEqual(parsed.node?.type, 'or');
    assert.deepStrictEqual(collectQueryTagKeys(parsed.node), [
      '#project/skybridge-signal',
      '@ren-kade',
      '#risk/service-failure',
    ]);
  });

  test('keeps a hyphen inside a tag out of negation', () => {
    const parsed = parseQuery('tag:#risk/service-failure');
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.deepStrictEqual(getQueryTagIntersection(parsed.node), [
      '#risk/service-failure',
    ]);
  });

  test('reads a leading dash as NOT', () => {
    const parsed = parseQuery('#a -#b');
    assert.deepStrictEqual(parsed.diagnostics, []);
    assert.strictEqual(formatQuery(parsed.node), 'tag = #a AND NOT tag = #b');
  });

  test('reads a comparison written after a colon', () => {
    const parsed = parseQuery('updated:>2026-01-01');
    assert.strictEqual(
      parsed.node?.type === 'condition' ? parsed.node.operator : undefined,
      'gt',
    );
  });

  test('reports an unknown field instead of guessing', () => {
    const parsed = parseQuery('colour:red');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /not a Deckard query field/);
  });

  test('reports an unclosed group', () => {
    const parsed = parseQuery('(tag:#a AND tag:#b');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /closing parenthesis/);
  });

  test('reports an unclosed quote', () => {
    const parsed = parseQuery('text ~ "elevator');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /closing quote/);
  });

  test('rejects an operator a field cannot answer', () => {
    const parsed = parseQuery('tag > #a');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /does not support/);
  });

  test('rejects a task state that is not open, done, or any', () => {
    const parsed = parseQuery('task:maybe');
    assert.strictEqual(parsed.node, undefined);
    assert.match(parsed.diagnostics[0].message, /open, done, or any/);
  });

  test('treats an empty query as no query at all', () => {
    const parsed = parseQuery('   ');
    assert.strictEqual(parsed.node, undefined);
    assert.deepStrictEqual(parsed.diagnostics, []);
  });

  test('round-trips a query through its canonical text', () => {
    const source =
      '(tag = #a AND text ~ "two words") OR NOT tag = #b OR task = open';
    const formatted = formatQuery(parseQuery(source).node);
    assert.strictEqual(formatted, formatQuery(parseQuery(formatted).node));
  });

  test('writes equality with = and still accepts :', () => {
    assert.strictEqual(
      formatQuery(parseQuery('tag:#a').node),
      'tag = #a',
      'the canonical form should use =',
    );
    assert.strictEqual(
      formatQuery(parseQuery('tag = #a').node),
      formatQuery(parseQuery('tag:#a').node),
      ': should remain a synonym for =',
    );
  });

  test('quotes a value that would otherwise re-tokenize', () => {
    const formatted = formatQuery(parseQuery('text ~ "a (b) c"').node);
    assert.strictEqual(formatted, 'text ~ "a (b) c"');
    assert.deepStrictEqual(parseQuery(formatted).diagnostics, []);
  });

  test('expresses a tag intersection as the query the chips imply', () => {
    const query = buildTagIntersectionQuery(['#project/atlas', '@ren-kade']);
    assert.strictEqual(query, 'tag = #project/atlas AND tag = @ren-kade');
    assert.deepStrictEqual(getQueryTagIntersection(parseQuery(query).node), [
      '#project/atlas',
      '@ren-kade',
    ]);
  });

  test('does not mistake a wildcard tag for a plain intersection', () => {
    assert.strictEqual(
      getQueryTagIntersection(parseQuery('tag:#project/*').node),
      undefined,
    );
  });

  test('does not mistake a negated tag for a plain intersection', () => {
    assert.strictEqual(
      getQueryTagIntersection(parseQuery('tag:#a AND NOT tag:#b').node),
      undefined,
    );
  });

  test('round-trips a query through the visual builder', () => {
    const source = '(tag:#a AND task:open) OR text ~ "vendor"';
    const groups = toBuilderGroups(parseQuery(source).node);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].rows.length, 2);
    // The builder keeps its OR groups parenthesized for legibility, so the
    // round trip is checked by meaning rather than by spelling.
    const rebuilt = fromBuilderGroups(groups);
    assert.strictEqual(
      formatQuery(parseQuery(rebuilt).node),
      formatQuery(parseQuery(source).node),
    );
  });

  test('folds a negated condition into its opposite operator', () => {
    const groups = toBuilderGroups(parseQuery('NOT tag:#a').node);
    const row = groups[0].rows[0];
    assert.strictEqual(row.supported, true);
    assert.strictEqual(row.operator, 'neq');
    // The builder has no negate control, so the row must carry the whole
    // meaning of the condition on its own.
    assert.strictEqual(fromBuilderGroups(groups), 'tag != #a');
  });

  test('keeps a negated comparison meaningful as one operator', () => {
    const groups = toBuilderGroups(parseQuery('NOT updated > 7d').node);
    assert.strictEqual(groups[0].rows[0].operator, 'lte');
    assert.strictEqual(fromBuilderGroups(groups), 'updated <= 7d');
  });

  test('offers an opposite for every operator a field accepts', () => {
    for (const [field, operators] of Object.entries(QUERY_FIELD_OPERATORS)) {
      for (const operator of operators) {
        assert.ok(
          operators.includes(QUERY_OPERATOR_INVERSES[operator]),
          `${field} accepts ${operator} but not its opposite`,
        );
      }
    }
  });

  test('marks a builder row unsupported instead of dropping it', () => {
    const groups = toBuilderGroups(parseQuery('NOT (tag:#a OR tag:#b)').node);
    const row = groups[0].rows[0];
    assert.strictEqual(row.supported, false);
    assert.strictEqual(
      fromBuilderGroups(groups),
      'NOT (tag = #a OR tag = #b)',
    );
  });
});

suite('Deckard query evaluation', () => {
  test('matches an OR of two tag intersections', () => {
    const index = createIndex();
    const results = evaluateQuery(
      index,
      parseQuery('(tag:#project/atlas AND tag:@ren) OR tag:#risk/vendor').node,
    );
    assert.deepStrictEqual(
      results.sections.map((section) => section.id).sort(),
      ['atlas-ren', 'vendor'],
    );
  });

  test('matches text inside a section body', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('text ~ elevator').node);
    assert.deepStrictEqual(
      results.sections.map((section) => section.id),
      ['vendor'],
    );
  });

  test('combines a tag and a text condition', () => {
    const index = createIndex();
    const results = evaluateQuery(
      index,
      parseQuery('tag:#risk/vendor AND text ~ "elevator"').node,
    );
    assert.strictEqual(results.sections.length, 1);
  });

  test('excludes with NOT', () => {
    const index = createIndex();
    const ids = evaluateQuery(
      index,
      parseQuery('tag:#project/atlas AND NOT tag:@ren').node,
    ).sections.map((section) => section.id);
    assert.ok(ids.includes('atlas-solo'));
    assert.ok(
      !ids.includes('atlas-ren'),
      'the section carrying @ren should be excluded',
    );
  });

  test('inherits a tag from a parent heading', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('tag:#project/atlas').node);
    assert.ok(
      results.sections.some((section) => section.id === 'atlas-child'),
      'a nested section should answer for its parent heading tag',
    );
  });

  test('matches a namespace with a wildcard', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('tag:#risk/*').node);
    assert.deepStrictEqual(
      results.sections.map((section) => section.id),
      ['vendor'],
    );
  });

  test('matches an entity namespace by kind', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('kind:person').node);
    assert.deepStrictEqual(
      results.sections.map((section) => section.id),
      ['atlas-ren'],
    );
  });

  test('answers a task state only from tasks', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('task:open').node);
    assert.deepStrictEqual(
      results.tasks.map((task) => task.id),
      ['task-open'],
    );
    assert.deepStrictEqual(results.sections, []);
  });

  test('matches a file name glob', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('file:2026-09-*.md').node);
    assert.ok(results.sections.length > 0);
    assert.ok(
      results.sections.every((section) =>
        section.filePath.includes('2026-09-'),
      ),
    );
  });

  test('matches a front-matter-only note as a file result', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('tag:#topic/intro').node);
    assert.deepStrictEqual(
      results.files.map((file) => file.filePath),
      ['notes/intro.md'],
    );
  });

  test('answers a negated whole-word text condition', () => {
    const index = createIndex();
    const ids = evaluateQuery(
      index,
      parseQuery('tag:#project/atlas AND text != Sequencing').node,
    ).sections.map((section) => section.id);
    assert.ok(!ids.includes('atlas-solo'));
    assert.ok(ids.includes('atlas-ren'));
  });

  test('answers a path that does not contain a fragment', () => {
    const index = createIndex();
    const results = evaluateQuery(
      index,
      parseQuery('tag:#project/atlas AND path !~ 2026-09-08').node,
    );
    assert.ok(
      results.sections.every(
        (section) => !section.filePath.includes('2026-09-08'),
      ),
    );
    assert.ok(results.sections.length > 0);
  });

  test('returns nothing for a query that failed to parse', () => {
    const index = createIndex();
    const results = evaluateQuery(index, parseQuery('(tag:#a').node);
    assert.deepStrictEqual(results, { sections: [], tasks: [], files: [] });
  });
});

suite('Deckard search page state', () => {
  test('a search that is not one tag has no tag header', () => {
    const index = createIndex();
    const snapshot = createSearchPageSnapshot(
      index,
      createPreferences(),
      'tag = #risk/vendor OR tag = #project/atlas',
      { originQuery: '#project/atlas' },
    );

    assert.strictEqual(snapshot.tag, undefined);
    assert.strictEqual(snapshot.hub, undefined);
    assert.strictEqual(snapshot.originQuery, '#project/atlas');
  });

  test('a search of one tag is that tag\'s page, however it is written', () => {
    const index = createIndex();
    for (const text of ['#project/atlas', 'tag = #project/atlas', 'tag:#project/atlas']) {
      const snapshot = createSearchPageSnapshot(index, createPreferences(), text);
      assert.strictEqual(snapshot.tag?.key, '#project/atlas', text);
      assert.strictEqual(snapshot.query.text, text, 'the box keeps what was typed');
    }
    const narrowed = createSearchPageSnapshot(
      index,
      createPreferences(),
      '#project/atlas is:open',
    );
    assert.strictEqual(narrowed.tag, undefined, 'anything more is a search');
  });

  test('reads is:, has:, no:, and in: as shorthand conditions', () => {
    const conditions = (text: string) => {
      const parsed = parseQuery(text);
      assert.deepStrictEqual(parsed.diagnostics, [], text);
      const found: string[] = [];
      const visit = (node: typeof parsed.node): void => {
        if (!node) {
          return;
        }
        if (node.type === 'condition') {
          found.push(`${node.field} ${node.operator} ${node.value}`);
        } else if (node.type === 'not') {
          found.push('NOT');
          visit(node.child);
        } else {
          node.children.forEach(visit);
        }
      };
      visit(parsed.node);
      return found;
    };

    assert.deepStrictEqual(conditions('is:open'), ['is eq open']);
    assert.deepStrictEqual(conditions('is:todo'), ['is eq open']);
    assert.deepStrictEqual(conditions('has:due no:priority'), [
      'has eq due',
      'has neq priority',
    ]);
    assert.deepStrictEqual(conditions('-is:done'), ['NOT', 'is eq done']);
    assert.deepStrictEqual(conditions('in:./notes/work/'), ['in eq notes/work']);
  });

  test('rejects a shorthand value it does not know', () => {
    assert.match(parseQuery('is:maybe').diagnostics[0].message, /is: accepts/);
    assert.match(parseQuery('no:colour').diagnostics[0].message, /has: and no: accept/);
  });

  test('writes shorthands back the way they are typed', () => {
    assert.strictEqual(
      formatQuery(parseQuery('is:open no:due in:notes #project/atlas').node),
      'is:open AND no:due AND in:notes AND tag = #project/atlas',
    );
    // The builder folds NOT into the operator, and still writes a shorthand.
    assert.strictEqual(
      fromBuilderGroups(toBuilderGroups(parseQuery('-is:open').node)),
      '-is:open',
    );
    assert.strictEqual(
      fromBuilderGroups(toBuilderGroups(parseQuery('NOT has:due').node)),
      'no:due',
    );
  });

  test('evaluates is:, has:, and no: against tasks and notes', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const index = createIndex();
    index.tasks.set('late', createTask({ id: 'late', dueAt: now - 2 * day }));
    index.tasks.set('soon', createTask({ id: 'soon', dueAt: now + 2 * day }));
    index.tasks.set('later', createTask({ id: 'later', dueAt: now + 20 * day }));
    const taskIds = (text: string) =>
      evaluateQuery(index, parseQuery(text).node).tasks.map((task) => task.id);

    assert.deepStrictEqual(taskIds('is:open'), ['task-open', 'late', 'soon', 'later']);
    assert.deepStrictEqual(taskIds('is:done'), ['task-done']);
    assert.deepStrictEqual(taskIds('is:overdue'), ['late']);
    assert.deepStrictEqual(taskIds('is:due'), ['late', 'soon']);
    assert.deepStrictEqual(taskIds('has:due'), ['late', 'soon', 'later']);
    assert.deepStrictEqual(taskIds('no:due'), ['task-open', 'task-done']);

    // no:due answers for tasks only, as due = none does, rather than
    // listing every note that has no due date.
    assert.deepStrictEqual(evaluateQuery(index, parseQuery('no:due').node).sections, []);
    const notes = evaluateQuery(index, parseQuery('is:note').node);
    assert.strictEqual(notes.tasks.length, 0);
    assert.strictEqual(notes.sections.length, 5);
  });

  test('matches in: against whole folders', () => {
    const index = createIndex();
    const sectionCount = (text: string) =>
      evaluateQuery(index, parseQuery(text).node).sections.length;

    assert.strictEqual(sectionCount('in:notes'), 5);
    // A folder is matched whole, so a name that only starts the same way
    // does not count.
    assert.strictEqual(sectionCount('in:note'), 0);
    assert.strictEqual(sectionCount('-in:notes'), 0);
    assert.strictEqual(sectionCount('in:no*'), 5);
  });
});

/**
 * Minimal preferences for the state projections under test.
 */
function createPreferences(): PersistedPreferences {
  return {
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
    dashboardTagColumns: 1,
    dashboardViewState: {
      mode: 'home',
      tagSearchQuery: '',
    },
    taskBoardLayout: 'board',
    taskBoardGroup: 'status',
      renderMode: 'markdown',
    tagOverviewSortMode: 'alphabetical',
    tagOverviewLayout: 'tabs',
  searchPageSize: 30,
    relatedNotesSortMode: 'newest',
    sectionAccessCounts: {},
    savedFilters: [],
    dashboardWidgets: [],
  };
}

/**
 * Builds a small, explicit index so query behaviour is checked against known
 * membership rather than against whatever a parser run happens to produce.
 */
function createIndex(): WorkspaceIndex {
  const sections: Section[] = [
    createSection({
      id: 'atlas-ren',
      filePath: 'notes/2026-09-08.md',
      heading: 'Shutdown telemetry audit',
      tags: ['#project/atlas', '@ren'],
      rawContent: 'Ren will retain only the shutdown telemetry feed.',
    }),
    createSection({
      id: 'atlas-solo',
      filePath: 'notes/2026-09-09.md',
      heading: 'Atlas planning',
      tags: ['#project/atlas'],
      rawContent: 'Sequencing for the next milestone.',
    }),
    createSection({
      id: 'atlas-parent',
      filePath: 'notes/2026-09-10.md',
      heading: 'Atlas',
      tags: ['#project/atlas'],
      headingTags: [{ key: '#project/atlas', label: '#project/atlas' }],
      rawContent: '',
      bodyContent: '',
    }),
    createSection({
      id: 'atlas-child',
      filePath: 'notes/2026-09-10.md',
      heading: 'Check-in',
      tags: [],
      parentSectionId: 'atlas-parent',
      rawContent: 'Notes from the check-in.',
    }),
    createSection({
      id: 'vendor',
      filePath: 'notes/2026-09-11.md',
      heading: 'Vendor risk',
      tags: ['#risk/vendor'],
      rawContent: 'Documented the absence of an elevator service contract.',
    }),
  ];

  const tasks: Task[] = [
    createTask({
      id: 'task-open',
      filePath: 'notes/2026-09-08.md',
      title: 'Send the audit summary',
      tags: ['#project/atlas'],
      completed: false,
    }),
    createTask({
      id: 'task-done',
      filePath: 'notes/2026-09-08.md',
      title: 'Collect the telemetry export',
      tags: ['#project/atlas'],
      completed: true,
    }),
  ];

  const files: ParsedFile[] = [
    {
      filePath: 'notes/intro.md',
      content: '---\ntopics:\n  - intro\n---\nWelcome.',
      sections: [],
      tasks: [],
      frontmatterTags: [{ key: '#topic/intro', label: '#topic/intro' }],
      links: [],
    },
  ];

  const tags = new Map<string, TagInfo>();
  const addTag = (
    key: string,
    sectionIds: string[],
    taskIds: string[],
    filePaths: string[],
  ): void => {
    tags.set(key, {
      key,
      label: key,
      sectionIds,
      taskIds,
      filePaths,
      count: sectionIds.length + taskIds.length + filePaths.length,
      isFavorite: false,
    });
  };
  addTag(
    '#project/atlas',
    ['atlas-ren', 'atlas-solo', 'atlas-parent'],
    ['task-open', 'task-done'],
    [],
  );
  addTag('@ren', ['atlas-ren'], [], []);
  addTag('#risk/vendor', ['vendor'], [], []);
  addTag('#topic/intro', [], [], ['notes/intro.md']);

  return {
    files: new Map(files.map((file) => [file.filePath, file])),
    sections: new Map(sections.map((section) => [section.id, section])),
    tasks: new Map(tasks.map((task) => [task.id, task])),
    tags,
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createSection(values: Partial<Section> & { id: string }): Section {
  return {
    filePath: 'notes/note.md',
    heading: '',
    headingLevel: 2,
    tags: [],
    tagLabels: {},
    links: [],
    rawContent: '',
    bodyContent: '',
    startLine: 1,
    endLine: 2,
    bodyEndLine: 2,
    ...values,
  };
}

function createTask(values: Partial<Task> & { id: string }): Task {
  return {
    filePath: 'notes/note.md',
    title: '',
    completed: false,
    tags: [],
    tagLabels: {},
    lineNumber: 1,
    checkboxColumn: 3,
    checkboxValue: ' ',
    sourceLineText: '- [ ] task',
    ...values,
  };
}
