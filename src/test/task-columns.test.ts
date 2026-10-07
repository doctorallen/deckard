import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
  checkNewStatusColumn,
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
    for (const status of ['todo', 'in-review', 'v2', '2nd_pass', 'Doing', 'à-faire', 'prêt', '進行中', 'e\u0301tape']) {
      assert.strictEqual(isStatusColumnName(status), true, status);
    }
    for (const status of ['', 'to do', '-todo', '_todo', '#todo', 'todo/now', 7, undefined, null]) {
      assert.strictEqual(isStatusColumnName(status), false, String(status));
    }
  });

  test('a namespace starts with a letter', () => {
    for (const namespace of ['status', 'stage-2', 'Context', 'a_b', 'état', 'Étape', '状態']) {
      assert.strictEqual(isBoardNamespace(namespace), true, namespace);
    }
    for (const namespace of ['', '1stage', 'a b', '-x', 'a/b', '\u0301a', 'a·b', 3, undefined]) {
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
    assert.deepStrictEqual(checkNewStatusColumn(' À-Faire ', ['todo']), { value: 'à-faire' }, 'a status in any script, as tags are');
  });

  test('a namespace to group by starts with a letter, in any script', () => {
    for (const typed of ['status', 'Context', 'état', '状態']) {
      assert.strictEqual(isBoardNamespace(typed), true, typed);
    }
    for (const typed of ['', '1stage', 'a b', '-x', 'a/b', '\u0301a']) {
      assert.strictEqual(isBoardNamespace(typed), false, typed);
    }
  });

  test('the settings allow what the board takes, as VS Code reads their patterns', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { pattern?: string; items?: { pattern?: string } }> }[] };
    };
    const settings = Object.assign({}, ...manifest.contributes.configuration.map((section) => section.properties)) as Record<
      string,
      { pattern?: string; items?: { pattern?: string } }
    >;
    // VS Code compiles a setting's pattern with the `u` flag.
    const pattern = (source: string | undefined): RegExp => new RegExp(source ?? '', 'u');
    const statuses = pattern(settings['deckard.board.statuses'].items?.pattern);
    for (const typed of ['todo', 'Doing', '2nd_pass', 'à-faire', '進行中', 'e\u0301tape', '', 'to do', '-todo', '#todo', 'a/b']) {
      assert.strictEqual(statuses.test(typed), isStatusColumnName(typed), `deckard.board.statuses: ${typed}`);
    }
  });
});
