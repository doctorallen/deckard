import * as assert from 'assert';

import { parseQuery } from '../domain/query/queryParser';
import { isWildcard, normalizeFolder } from '../domain/query/queryValues';
import { escapeRegExp } from '../shared/text';

suite('Query values', () => {
  test('a wildcard holds * or ?', () => {
    assert.deepStrictEqual(['project/*', 'a?c', 'atlas', ''].map(isWildcard), [true, true, false, false]);
  });

  test('a folder loses a leading ./ and trailing slashes, and keeps its case', () => {
    assert.strictEqual(normalizeFolder('./Notes/Work//'), 'Notes/Work');
    assert.strictEqual(normalizeFolder('notes'), 'notes');
    assert.strictEqual(normalizeFolder('./'), '');
    assert.strictEqual(normalizeFolder('.//notes'), '/notes');
  });

  test('escapeRegExp matches the text literally', () => {
    const text = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    assert.ok(new RegExp(`^${escapeRegExp(text)}$`).test(text));
  });

  test('the value errors name every accepted value, as they always have', () => {
    const message = (query: string) => parseQuery(query).diagnostics[0]?.message;
    assert.strictEqual(
      message('is:maybe'),
      'is: accepts open, in-progress, done, cancelled, closed, task, note, overdue, due, today, needs-date, waiting, available, blocked, blocking, mine, assigned, unassigned, daily, periodic, parked, or step — not "maybe".',
    );
    assert.strictEqual(
      message('no:maybe'),
      'has: and no: accept due, scheduled, start, done, cancelled, priority, id, dependsOn, or steps — not "maybe".',
    );
    assert.strictEqual(message('task = maybe'), 'task accepts open, done, or any — not "maybe".');
    assert.strictEqual(
      message('priority = maybe'),
      'priority accepts highest, high, medium, none, low, or lowest — not "maybe".',
    );
  });
});
