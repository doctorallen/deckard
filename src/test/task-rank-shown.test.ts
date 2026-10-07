import * as assert from 'assert';

import { rankShown } from '../domain/tasks/taskRank';

suite('Ranking what is shown', () => {
  const live = ['a', 'b', 'c', 'd', 'e', 'f'];

  test('the shown tasks take the order given, as one run where the first of them was', () => {
    assert.deepStrictEqual(rankShown(['a', 'b', 'c', 'd'], ['c', 'b'], live), ['a', 'c', 'b', 'd']);
    assert.deepStrictEqual(rankShown(['a', 'b', 'c', 'd'], ['d', 'b'], live), ['a', 'd', 'b', 'c'], 'c keeps its place among the rest');
  });

  test('tasks shown but never ranked join the run, and tasks not shown stay unranked', () => {
    assert.deepStrictEqual(rankShown(['a', 'b'], ['e', 'b', 'f'], live), ['a', 'e', 'b', 'f']);
    assert.deepStrictEqual(rankShown([], ['f', 'e'], live), ['f', 'e'], 'a first ranking ranks the shown alone, not every task');
    assert.deepStrictEqual(rankShown(['a'], ['f', 'e'], live), ['a', 'f', 'e'], 'none ranked before: after every ranked task');
  });

  test('a task gone from the workspace is let go, and one shown twice is ranked once', () => {
    assert.deepStrictEqual(rankShown(['gone', 'a', 'b'], ['b', 'a', 'b'], live), ['b', 'a']);
    assert.deepStrictEqual(rankShown(['a', 'b'], ['gone'], live), ['a', 'b']);
  });
});
