import * as assert from 'assert';

import { isObject, isRecord } from '../shared/guards';

suite('Type guards', () => {
  test('isRecord accepts a plain object and refuses an array', () => {
    assert.strictEqual(isRecord({}), true);
    assert.strictEqual(isRecord({ jsonrpc: '2.0' }), true);
    assert.strictEqual(isRecord(Object.create(null)), true);
    assert.strictEqual(isRecord([]), false);
    assert.strictEqual(isRecord([1, 2]), false);
  });

  test('isObject accepts an array as well as a plain object', () => {
    assert.strictEqual(isObject({}), true);
    assert.strictEqual(isObject({ type: 'open' }), true);
    assert.strictEqual(isObject([]), true);
    assert.strictEqual(isObject([1, 2]), true);
  });

  test('both refuse null, undefined, and every primitive', () => {
    for (const value of [null, undefined, 0, 1, '', 'text', true, false, Symbol('s'), 10n]) {
      assert.strictEqual(isRecord(value), false, String(value));
      assert.strictEqual(isObject(value), false, String(value));
    }
  });

  test('both refuse a function, which typeof does not call an object', () => {
    assert.strictEqual(isRecord(() => undefined), false);
    assert.strictEqual(isObject(() => undefined), false);
  });
});
