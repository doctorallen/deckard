import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { evaluateQuery, setQueryIdentity } from '../core/query/queryEvaluator';
import { parseQuery } from '../core/query/queryParser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { layoutTaskBoard, resolveTaskMove } from '../ui/state/taskBoardState';

const notes = {
  'notes/atlas.md': [
    '# Atlas #project/atlas',
    '',
    '- [ ] Chase the contractor @ren-kade 👤 @dana',
    '- [ ] Send the proposal [assignee:: #person/ren-kade]',
    '- [ ] Book the room',
    '- [ ] Write up what @dana said',
    '- [x] Filed the report 👤 @dana',
    '',
    'Mentioning @dana in prose is not a task.',
  ].join('\n'),
};

function indexOf(source: Record<string, string> = notes): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(source).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}

const index = indexOf();

/** The titles a query finds, so a result reads as the note wrote it. */
function found(query: string): string[] {
  return evaluateQuery(index, parseQuery(query).node).tasks.map(
    (task) => task.title,
  );
}

suite('Task assignees', () => {
  teardown(() => setQueryIdentity(undefined));

  test('the 👤 field owns the task, and a name in the words does not', () => {
    const tasks = [...index.tasks.values()].sort(
      (left, right) => left.lineNumber - right.lineNumber,
    );
    assert.deepStrictEqual(
      tasks.map((task) => [task.title.slice(0, 12), task.assignee]),
      [
        ['Chase the co', '@dana'],
        ['Send the pro', '#person/ren-kade'],
        ['Book the roo', undefined],
        ['Write up wha', undefined],
        ['Filed the re', '@dana'],
      ],
      'a person the task merely mentions is asked for nothing',
    );
    assert.strictEqual(
      tasks[0].title,
      'Chase the contractor @ren-kade',
      'the field leaves the title, and the mention stays in it',
    );
    assert.ok(
      tasks[0].tags.includes('@dana'),
      'the person a task is for is still one of its tags',
    );
  });

  test('reads the older rule back when the setting asks for it', () => {
    const older = buildWorkspaceIndex(
      new Map(
        Object.entries(notes).map(([filePath, content]) => [
          filePath,
          parseMarkdown(filePath, content, undefined, {
            assigneeFromPersonTag: true,
          }),
        ]),
      ),
    );
    const byLine = [...older.tasks.values()].sort(
      (left, right) => left.lineNumber - right.lineNumber,
    );
    assert.deepStrictEqual(
      byLine.map((task) => task.assignee),
      ['@dana', '#person/ren-kade', undefined, '@dana', '@dana'],
      'the field still wins; only a line without one falls back',
    );
  });

  test('finds a person however either side writes them', () => {
    assert.deepStrictEqual(found('assignee = @dana'), [
      'Chase the contractor @ren-kade',
      'Filed the report',
    ]);
    assert.deepStrictEqual(
      found('assignee = ren-kade'),
      ['Send the proposal'],
      'a bare name matches the #person/ tag',
    );
    assert.deepStrictEqual(found('assignee = @ren-kade'), [
      'Send the proposal',
    ]);
    assert.deepStrictEqual(found('assignee = none'), [
      'Book the room',
      'Write up what @dana said',
    ]);
    assert.deepStrictEqual(
      found('assignee != @dana AND is:open'),
      ['Send the proposal', 'Book the room', 'Write up what @dana said'],
    );
  });

  test('is:mine is who the setting says, and whatever is for nobody', () => {
    assert.deepStrictEqual(
      found('is:mine'),
      ['Book the room', 'Write up what @dana said'],
      'with no name yet, only what nobody was asked to do',
    );
    setQueryIdentity('@dana');
    assert.deepStrictEqual(
      found('is:mine AND is:open'),
      ['Chase the contractor @ren-kade', 'Book the room', 'Write up what @dana said'],
      'mine by name, and mine by default; a mention alone is neither',
    );
    setQueryIdentity('#person/ren-kade');
    assert.deepStrictEqual(found('is:mine AND is:assigned'), ['Send the proposal']);
    assert.deepStrictEqual(
      found('is:mine AND assignee = none'),
      ['Book the room', 'Write up what @dana said'],
      'assignee = none is the default kind alone',
    );
  });

  test('is:assigned and is:unassigned split the tasks', () => {
    assert.deepStrictEqual(found('is:unassigned'), [
      'Book the room',
      'Write up what @dana said',
    ]);
    assert.strictEqual(found('is:assigned').length, 3);
    assert.deepStrictEqual(
      found('is:assigned AND is:unassigned'),
      [],
      'a task is one or the other',
    );
  });

  test('only tasks answer an assignee condition', () => {
    const results = evaluateQuery(index, parseQuery('assignee = @dana').node);
    assert.deepStrictEqual(results.sections, []);
    assert.deepStrictEqual(results.files, []);
  });

  test('the board can column tasks by the person named on them', () => {
    const layout = layoutTaskBoard(
      index,
      [...index.tasks.values()],
      'assignee',
      {
        now: Date.now(),
        statuses: [],
        statusNamespace: 'status',
        format: 'emoji',
      },
    );
    assert.deepStrictEqual(
      layout.columns.map((column) => [column.label, column.cards.length]),
      [
        ['@dana', 1],
        ['#person/ren-kade', 1],
        ['Nobody named', 2],
        ['Done', 1],
      ],
      'busiest person first, then the tasks naming nobody, then Done',
    );
    assert.deepStrictEqual(
      layout.columns
        .filter((column) => column.id.startsWith('assignee:'))
        .map((column) => column.droppable),
      [true, true, true],
      'handing a task over is one field, so a person column takes a card',
    );
  });

  test('hands a task over when its card is dropped on a person', () => {
    const options = {
      now: Date.now(),
      statuses: [],
      statusNamespace: 'status',
      format: 'emoji' as const,
    };
    const byLine = [...index.tasks.values()].sort(
      (left, right) => left.lineNumber - right.lineNumber,
    );
    const move = resolveTaskMove(byLine[0], 'assignee:@ren-kade', options);
    assert.strictEqual(move.kind, 'edit');
    assert.strictEqual(
      move.kind === 'edit' ? move.edit(byLine[0].sourceLineText) : '',
      '- [ ] Chase the contractor @ren-kade 👤 @ren-kade',
    );
    assert.strictEqual(
      resolveTaskMove(byLine[0], 'assignee:@dana', options).kind,
      'unchanged',
      'the person it is already for is no edit at all',
    );
    const cleared = resolveTaskMove(byLine[0], 'assignee:', options);
    assert.strictEqual(
      cleared.kind === 'edit' ? cleared.edit(byLine[0].sourceLineText) : '',
      '- [ ] Chase the contractor @ren-kade',
    );
    assert.strictEqual(
      resolveTaskMove(byLine[0], 'assignee:#project/atlas', options).kind,
      'refused',
      'a tag that is not a person names nobody to hand it to',
    );
  });
});
