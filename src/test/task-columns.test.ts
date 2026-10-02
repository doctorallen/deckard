import * as assert from 'assert';

import {
  checkNewStatusColumn,
  checkStatusNamespace,
  isBoardNamespace,
  isStatusColumnList,
  isStatusColumnName,
  MAX_STATUS_COLUMNS,
} from '../domain/tasks/taskColumns';

/**
 * The board's status columns, checked once for both sides: the gear says at
 * once why what was typed cannot be a column, and the host refuses a list
 * the setting would not hold.
 */
suite('Status columns', () => {
  test('a status is letters, digits, - and _, starting with a letter or digit', () => {
    for (const status of ['todo', 'in-review', 'v2', '2nd_pass', 'Doing']) {
      assert.strictEqual(isStatusColumnName(status), true, status);
    }
    for (const status of ['', 'to do', '-todo', '_todo', '#todo', 'todo/now', 7, undefined, null]) {
      assert.strictEqual(isStatusColumnName(status), false, String(status));
    }
  });

  test('a namespace starts with a letter', () => {
    for (const namespace of ['status', 'stage-2', 'Context', 'a_b']) {
      assert.strictEqual(isBoardNamespace(namespace), true, namespace);
    }
    for (const namespace of ['', '1stage', 'a b', '-x', 'a/b', 3, undefined]) {
      assert.strictEqual(isBoardNamespace(namespace), false, String(namespace));
    }
  });

  test('a list holds no more than the gear keeps, each a status', () => {
    assert.strictEqual(isStatusColumnList([]), true);
    assert.strictEqual(isStatusColumnList(['todo', 'doing']), true);
    assert.strictEqual(isStatusColumnList(Array.from({ length: MAX_STATUS_COLUMNS }, (_, at) => `s${at}`)), true);
    assert.strictEqual(isStatusColumnList(Array.from({ length: MAX_STATUS_COLUMNS + 1 }, (_, at) => `s${at}`)), false);
    assert.strictEqual(isStatusColumnList(['todo', 'to do']), false);
    assert.strictEqual(isStatusColumnList('todo'), false);
    assert.strictEqual(isStatusColumnList(undefined), false);
  });

  test('a status typed to add is saved trimmed and in lower case, or says why it cannot be', () => {
    assert.strictEqual(checkNewStatusColumn('   ', ['todo']), undefined, 'an empty field adds nothing');
    assert.deepStrictEqual(checkNewStatusColumn('  Review ', ['todo']), { value: 'review' });
    assert.deepStrictEqual(checkNewStatusColumn('in review', ['todo']), {
      error: 'A status is letters, digits, - and _, starting with a letter or digit.',
    });
    assert.deepStrictEqual(checkNewStatusColumn('TODO', ['todo', 'doing']), { error: 'todo is already a column.' });
  });

  test('a status tag typed is saved trimmed and in lower case, or says why it cannot be', () => {
    assert.deepStrictEqual(checkStatusNamespace(' Stage '), { value: 'stage' });
    for (const typed of ['', '1stage', 'a b']) {
      assert.deepStrictEqual(checkStatusNamespace(typed), {
        error: 'A status tag is letters, digits, - and _, starting with a letter.',
      }, typed);
    }
  });
});
