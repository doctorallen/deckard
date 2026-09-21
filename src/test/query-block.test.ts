import * as assert from 'assert';

import MarkdownIt = require('markdown-it');

import { Section, TagInfo, Task, WorkspaceIndex } from '../core/types';
import {
  addQueryBlockRenderer,
  createPreviewSourceHref,
  renderQueryBlockHtml,
} from '../ui/preview/queryBlockHtml';
import {
  createQueryBlockSnapshot,
  describeQueryBlockCounts,
  findQueryBlocks,
  isQueryBlockLine,
  parseQueryBlockInfo,
} from '../ui/state/queryBlockState';

suite('Deckard query blocks', () => {
  test('recognizes only deckard fences and reads their options', () => {
    assert.strictEqual(parseQueryBlockInfo('js'), undefined);
    assert.strictEqual(parseQueryBlockInfo(''), undefined);
    assert.deepStrictEqual(parseQueryBlockInfo('Deckard'), { warnings: [] });
    assert.deepStrictEqual(parseQueryBlockInfo(' deckard sort=updated limit=5'), {
      sort: 'updated',
      limit: 5,
      warnings: [],
    });
  });

  test('reports options it cannot use without dropping the valid ones', () => {
    const options = parseQueryBlockInfo(
      'deckard sort=newest limit=0 colour=red sort=created',
    );
    assert.strictEqual(options?.sort, 'created');
    assert.strictEqual(options?.limit, undefined);
    assert.strictEqual(options?.warnings.length, 3);
  });

  test('finds blocks with CommonMark fence rules', () => {
    const text = [
      '# Note',
      '```deckard',
      'tag = #project/atlas',
      'AND task = open',
      '```',
      '````markdown',
      '```deckard',
      'tag = #example',
      '```',
      '````',
      '~~~deckard limit=2',
      '#risk/vendor',
    ].join('\n');

    assert.deepStrictEqual(
      findQueryBlocks(text).map((block) => [
        block.startLine,
        block.endLine,
        block.query,
        block.options.limit,
      ]),
      [
        [1, 4, 'tag = #project/atlas\nAND task = open', undefined],
        [10, 11, '#risk/vendor', 2],
      ],
    );
  });

  test('knows which lines hold query text', () => {
    const blocks = findQueryBlocks(
      ['```deckard', '#a', '```', 'prose', '```js', 'code', '```', '```deckard', '#b'].join('\n'),
    );
    assert.deepStrictEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((line) => isQueryBlockLine(blocks, line)),
      [false, true, false, false, false, false, false, false, true],
    );
  });

  test('lists notes with heading context and tasks open first by due date', () => {
    const snapshot = createQueryBlockSnapshot(
      createIndex(),
      'tag = #project/atlas',
      { warnings: [] },
    );

    assert.deepStrictEqual(
      snapshot.notes.map((note) => [note.title, note.context]),
      [
        ['Atlas', []],
        ['Check-in <script>', ['Atlas']],
      ],
    );
    assert.deepStrictEqual(
      snapshot.tasks.map((task) => task.id),
      ['t-late', 't-soon', 't-undated', 't-done'],
    );
    assert.strictEqual(
      describeQueryBlockCounts(snapshot),
      '2 notes · 4 tasks, 3 open',
    );
  });

  test('sorts by date and limits each list while keeping the totals', () => {
    const snapshot = createQueryBlockSnapshot(
      createIndex(),
      'tag = #project/atlas',
      { sort: 'updated', limit: 1, warnings: [] },
    );

    assert.deepStrictEqual(snapshot.notes.map((note) => note.id), ['child']);
    assert.deepStrictEqual(snapshot.tasks.map((task) => task.id), ['t-undated']);
    assert.strictEqual(snapshot.noteCount, 2);
    assert.strictEqual(snapshot.taskCount, 4);
    assert.strictEqual(snapshot.openTaskCount, 3);
  });

  test('reports a query that cannot run', () => {
    const invalid = createQueryBlockSnapshot(
      createIndex(),
      '(tag = #project/atlas',
      { warnings: [] },
    );
    assert.strictEqual(invalid.hasError, true);
    assert.strictEqual(invalid.messages[0]?.severity, 'error');

    const empty = createQueryBlockSnapshot(createIndex(), '  ', {
      warnings: [],
    });
    assert.strictEqual(empty.hasError, true);
    assert.match(empty.messages[0]?.text ?? '', /Write a Deckard query/);
  });

  test('renders results in the preview with source links and escaped text', () => {
    let renders = 0;
    const md = addQueryBlockRenderer(new MarkdownIt(), {
      getIndex: () => createIndex(),
      onDidRender: () => {
        renders += 1;
      },
    });
    const html = md.render('```deckard\ntag = #project/atlas\n```\n');

    assert.strictEqual(renders, 1);
    assert.ok(html.includes('class="deckard-query code-line" data-line="0"'));
    assert.ok(html.includes('href="/notes/Atlas%20plan.md#L5"'));
    assert.ok(html.includes('Check-in &lt;script&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('2 notes · 4 tasks, 3 open'));
  });

  test('marks overdue open tasks and completed tasks', () => {
    const html = renderQueryBlockHtml(
      'tag = #project/atlas',
      { warnings: [] },
      createIndex(),
      undefined,
      new Date(2026, 8, 13).getTime(),
    );

    assert.ok(html.includes('<span class="deckard-query-due is-overdue">due 2026-09-01</span>'));
    assert.ok(html.includes('<span class="deckard-query-due">due 2026-09-20</span>'));
    assert.ok(html.includes('deckard-query-task is-done'));
  });

  test('leaves other fences to the existing renderer', () => {
    const md = addQueryBlockRenderer(new MarkdownIt(), {
      getIndex: () => createIndex(),
    });
    assert.ok(
      md
        .render('```js\nconst a = 1;\n```\n')
        .includes('<pre><code class="language-js">'),
    );
  });

  test('explains an empty block and a block rendered before indexing', () => {
    const md = addQueryBlockRenderer(new MarkdownIt(), {
      getIndex: () => undefined,
    });
    assert.ok(
      md.render('```deckard\n#project/atlas\n```\n').includes('Deckard is indexing'),
    );

    const html = renderQueryBlockHtml('', { warnings: [] }, createIndex());
    assert.ok(html.includes('deckard-query-message is-error'));
  });

  test('keeps tags inside a title and drops the ones that label it', () => {
    const index = createIndex();
    index.tasks.set(
      't-people',
      createTask({
        id: 't-people',
        title: 'Pair @ren with @dax on the audit. #project/atlas',
        lineNumber: 11,
      }),
    );
    const snapshot = createQueryBlockSnapshot(index, 'text ~ "pair"', {
      warnings: [],
    });
    assert.deepStrictEqual(
      snapshot.tasks.map((task) => task.title),
      ['Pair @ren with @dax on the audit.'],
    );
  });

  test('puts each result on its own row with where it lives beneath', () => {
    const index = createIndex();
    index.sections.set(
      'daily',
      createSection({
        id: 'daily',
        filePath: 'notes/2026-08-14.md',
        heading: '2026-08-14',
        headingLevel: 1,
      }),
    );
    index.sections.set(
      'daily-check-in',
      createSection({
        id: 'daily-check-in',
        filePath: 'notes/2026-08-14.md',
        heading: 'Wardens check-in',
        parentSectionId: 'daily',
        tags: ['#risk/vendor'],
        startLine: 3,
      }),
    );
    index.tags.get('#risk/vendor')?.sectionIds.push('daily-check-in');

    const html = renderQueryBlockHtml(
      'tag = #risk/vendor',
      { warnings: [] },
      index,
    );
    assert.ok(html.includes('<div class="deckard-query-group-title">Notes</div>'));
    // A daily note's date heading already names its file.
    assert.ok(
      html.includes(
        '<a class="deckard-query-title" href="/notes/2026-08-14.md#L3">Wardens check-in</a><div class="deckard-query-meta">2026-08-14</div>',
      ),
    );
    assert.ok(html.includes('<div class="deckard-query-meta">vendor.md</div>'));
  });

  test('encodes file names in source links', () => {
    assert.strictEqual(
      createPreviewSourceHref('notes/Q3 #1 plan.md', 12),
      '/notes/Q3%20%231%20plan.md#L12',
    );
  });
});

/**
 * A small index with a nested heading, a heading that needs escaping, and
 * tasks that exercise the open-first, due-date order.
 */
function createIndex(): WorkspaceIndex {
  const file = 'notes/Atlas plan.md';
  const sections: Section[] = [
    createSection({
      id: 'parent',
      filePath: file,
      heading: 'Atlas #project/atlas',
      headingLevel: 1,
      tags: ['#project/atlas'],
      startLine: 1,
      createdAt: 300,
      updatedAt: 100,
    }),
    createSection({
      id: 'child',
      filePath: file,
      heading: 'Check-in <script>',
      parentSectionId: 'parent',
      tags: ['#project/atlas'],
      startLine: 5,
      createdAt: 100,
      updatedAt: 300,
    }),
    createSection({
      id: 'vendor',
      filePath: 'notes/vendor.md',
      heading: 'Vendor risk',
      tags: ['#risk/vendor'],
    }),
  ];

  const tasks: Task[] = [
    createTask({
      id: 't-done',
      filePath: file,
      sectionId: 'child',
      title: 'Collect export',
      completed: true,
      lineNumber: 8,
    }),
    createTask({
      id: 't-late',
      filePath: file,
      sectionId: 'child',
      title: 'Send summary',
      dueAt: new Date(2026, 8, 1).getTime(),
      dueText: '2026-09-01',
      lineNumber: 9,
    }),
    createTask({
      id: 't-undated',
      filePath: file,
      sectionId: 'child',
      title: 'Book room',
      lineNumber: 7,
    }),
    createTask({
      id: 't-soon',
      filePath: file,
      sectionId: 'child',
      title: 'Draft agenda',
      dueAt: new Date(2026, 8, 20).getTime(),
      dueText: '2026-09-20',
      lineNumber: 10,
    }),
  ];

  const tags = new Map<string, TagInfo>([
    [
      '#project/atlas',
      createTag('#project/atlas', ['parent', 'child'], tasks.map((task) => task.id)),
    ],
    ['#risk/vendor', createTag('#risk/vendor', ['vendor'], [])],
  ]);

  return {
    files: new Map(),
    sections: new Map(sections.map((section) => [section.id, section])),
    tasks: new Map(tasks.map((task) => [task.id, task])),
    tags,
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createTag(key: string, sectionIds: string[], taskIds: string[]): TagInfo {
  return {
    key,
    label: key,
    sectionIds,
    taskIds,
    filePaths: [],
    count: sectionIds.length + taskIds.length,
    isFavorite: false,
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
    tags: ['#project/atlas'],
    tagLabels: {},
    lineNumber: 1,
    checkboxColumn: 3,
    checkboxValue: ' ',
    sourceLineText: '- [ ] task',
    ...values,
  };
}
