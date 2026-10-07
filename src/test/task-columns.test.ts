import * as assert from 'assert';

import { isBoardNamespace } from '../domain/tasks/taskColumns';
import {
  isCancelledHidden,
  listUnknownColumns,
  orderOpenStatuses,
  readTaskColumnKey,
  readUnknownColumnKey,
  unknownColumnKey,
} from '../domain/tasks/statusColumns';
import { DEFAULT_TASK_STATUSES, readTaskStatuses } from '../domain/tasks/taskStatuses';

/**
 * The board's status columns, a view of the status list: the gear orders
 * and hides them by name, and the board and the Tasks view read the same
 * order.
 */
suite('Status columns', () => {
  const keys = (choices: Parameters<typeof orderOpenStatuses>[1] = {}) =>
    orderOpenStatuses(DEFAULT_TASK_STATUSES, choices).map((entry) => `${entry.key}${entry.hidden ? ' (hidden)' : ''}`);

  test('every open status is a column, in the list\'s order, until the gear says otherwise', () => {
    assert.deepStrictEqual(keys(), ['todo', 'in-progress', 'waiting', 'someday', 'blocked']);
    assert.deepStrictEqual(
      orderOpenStatuses(DEFAULT_TASK_STATUSES).map((entry) => `[${entry.symbol}] ${entry.name}`),
      ['[ ] Todo', '[/] In progress', '[w] Waiting', '[s] Someday', '[=] Blocked'],
    );
  });

  test('the gear orders columns by name, the rest after, and hides them by name', () => {
    assert.deepStrictEqual(keys({ order: ['Blocked', 'in progress', 'Gone'] }), ['blocked', 'in-progress', 'todo', 'waiting', 'someday']);
    assert.deepStrictEqual(keys({ hidden: ['someday'] }), ['todo', 'in-progress', 'waiting', 'someday (hidden)', 'blocked']);
  });

  test('Cancelled is hidden until the gear shows it, by its status\'s name', () => {
    assert.strictEqual(isCancelledHidden(DEFAULT_TASK_STATUSES), true);
    assert.strictEqual(isCancelledHidden(DEFAULT_TASK_STATUSES, { hidden: [] }), false);
    const dropped = readTaskStatuses([{ symbol: '-', name: 'Dropped', type: 'cancelled' }]);
    assert.strictEqual(isCancelledHidden(dropped), false, 'a cancelled status of another name is shown');
    assert.strictEqual(isCancelledHidden(dropped, { hidden: ['dropped'] }), true);
  });

  test('a character no status names is a column of its own, by its code point', () => {
    assert.strictEqual(unknownColumnKey('?'), 'unknown-63');
    assert.strictEqual(readUnknownColumnKey('unknown-63'), '?');
    assert.strictEqual(readUnknownColumnKey('unknown-x'), undefined);
    assert.strictEqual(readUnknownColumnKey('todo'), undefined);
    const tasks = ['?', '!', '?', '/'].map((symbol) => ({ status: { symbol, name: symbol === '/' ? 'In progress' : 'Unknown', type: 'todo' as const } }));
    assert.deepStrictEqual(listUnknownColumns(tasks, DEFAULT_TASK_STATUSES).map((entry) => entry.key), ['unknown-33', 'unknown-63']);
    assert.strictEqual(readTaskColumnKey({ status: { symbol: '!', name: 'Unknown', type: 'todo' } }, DEFAULT_TASK_STATUSES), 'unknown-33');
    assert.strictEqual(readTaskColumnKey({ status: { symbol: 'w', name: 'Waiting', type: 'onHold' } }, DEFAULT_TASK_STATUSES), 'waiting');
  });

  test('a namespace to group by starts with a letter, in any script', () => {
    for (const namespace of ['status', 'stage-2', 'Context', 'a_b', 'état', 'Étape', '状態']) {
      assert.strictEqual(isBoardNamespace(namespace), true, namespace);
    }
    for (const namespace of ['', '1stage', 'a b', '-x', 'a/b', '́a', 'a·b', 3, undefined]) {
      assert.strictEqual(isBoardNamespace(namespace), false, String(namespace));
    }
  });
});
