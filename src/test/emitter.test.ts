import * as assert from 'assert';

import { Emitter } from '../core/emitter';
import type { Disposable } from '../ports/events';

suite('Emitter', () => {
  test('tells each listener of each value, in the order they subscribed', () => {
    const emitter = new Emitter<number>();
    const heard: string[] = [];
    emitter.event((value) => heard.push(`a${value}`));
    emitter.event((value) => heard.push(`b${value}`));
    emitter.fire(1);
    emitter.fire(2);
    assert.deepStrictEqual(heard, ['a1', 'b1', 'a2', 'b2']);
  });

  test('stops telling a listener once its subscription is disposed', () => {
    const emitter = new Emitter<number>();
    const heard: number[] = [];
    const subscription = emitter.event((value) => heard.push(value));
    emitter.fire(1);
    subscription.dispose();
    emitter.fire(2);
    assert.deepStrictEqual(heard, [1]);
  });

  test('pushes the subscription onto the disposables it is given, and calls with thisArgs', () => {
    const emitter = new Emitter<void>();
    const disposables: Disposable[] = [];
    const owner = { calls: 0 };
    emitter.event(function (this: typeof owner) { this.calls += 1; }, owner, disposables);
    emitter.fire();
    assert.strictEqual(owner.calls, 1);
    assert.strictEqual(disposables.length, 1);
    disposables[0].dispose();
    emitter.fire();
    assert.strictEqual(owner.calls, 1);
  });

  test('a listener that throws does not stop the others', () => {
    const emitter = new Emitter<number>();
    const heard: number[] = [];
    const error = console.error;
    console.error = () => undefined;
    try {
      emitter.event(() => {
        throw new Error('listener failed');
      });
      emitter.event((value) => heard.push(value));
      emitter.fire(3);
    } finally {
      console.error = error;
    }
    assert.deepStrictEqual(heard, [3]);
  });

  test('once disposed, fires to no one and takes no new listeners', () => {
    const emitter = new Emitter<number>();
    const heard: number[] = [];
    emitter.event((value) => heard.push(value));
    emitter.dispose();
    emitter.fire(1);
    emitter.event((value) => heard.push(value)).dispose();
    emitter.fire(2);
    assert.deepStrictEqual(heard, []);
  });
});
