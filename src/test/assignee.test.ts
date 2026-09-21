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
    '- [ ] Chase the contractor @dana with @ren-kade',
    '- [ ] Send the proposal #person/ren-kade',
    '- [ ] Book the room',
    '- [x] Filed the report @dana',
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

  test('the first person on the line owns the task', () => {
    const tasks = [...index.tasks.values()].sort(
      (left, right) => left.lineNumber - right.lineNumber,
    );
    assert.deepStrictEqual(
      tasks.map((task) => [task.title.slice(0, 12), task.assignee]),
      [
        ['Chase the co', '@dana'],
        ['Send the pro', '#person/ren-kade'],
        ['Book the roo', undefined],
        ['Filed the re', '@dana'],
      ],
      'the second person on a line is mentioned, not asked',
    );
  });

  test('finds a person however either side writes them', () => {
    assert.deepStrictEqual(found('assignee = @dana'), [
      'Chase the contractor @dana with @ren-kade',
      'Filed the report @dana',
    ]);
    assert.deepStrictEqual(
      found('assignee = ren-kade'),
      ['Send the proposal #person/ren-kade'],
      'a bare name matches the #person/ tag',
    );
    assert.deepStrictEqual(found('assignee = @ren-kade'), [
      'Send the proposal #person/ren-kade',
    ]);
    assert.deepStrictEqual(found('assignee = none'), ['Book the room']);
    assert.deepStrictEqual(
      found('assignee != @dana AND is:open'),
      ['Send the proposal #person/ren-kade', 'Book the room'],
    );
  });

  test('is:mine is who the setting says, and nobody until it says', () => {
    assert.deepStrictEqual(found('is:mine'), [], 'nobody is me yet');
    setQueryIdentity('@dana');
    assert.deepStrictEqual(found('is:mine AND is:open'), [
      'Chase the contractor @dana with @ren-kade',
    ]);
    setQueryIdentity('#person/ren-kade');
    assert.deepStrictEqual(found('is:mine'), [
      'Send the proposal #person/ren-kade',
    ]);
  });

  test('is:assigned and is:unassigned split the tasks', () => {
    assert.deepStrictEqual(found('is:unassigned'), ['Book the room']);
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
        ['Nobody named', 1],
        ['Done', 1],
      ],
      'busiest person first, then the tasks naming nobody, then Done',
    );
    assert.deepStrictEqual(
      layout.columns
        .filter((column) => column.id.startsWith('assignee:'))
        .map((column) => column.droppable),
      [false, false, false],
      'a person column takes no dropped card, nor does Nobody named',
    );
  });

  test('refuses to write a person by dropping a card', () => {
    const task = [...index.tasks.values()][0];
    const move = resolveTaskMove(task, 'assignee:@ren-kade', {
      now: Date.now(),
      statuses: [],
      statusNamespace: 'status',
      format: 'emoji',
    });
    assert.strictEqual(move.kind, 'refused');
  });
});
