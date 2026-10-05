import * as assert from 'assert';

import { Debouncer, KeyedDebouncer } from '../shared/debounce';
import { installManualClock, ManualClock } from './manualClock';

/** Waits `milliseconds` of real time. */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs a test on a clock moved by hand, over Node's own timers, which the
 * debouncers use. The first test of each suite waits on the real clock.
 */
function onManualClock(body: (clock: ManualClock) => void): () => void {
  return () => {
    const clock = installManualClock(globalThis as never);
    try {
      body(clock);
    } finally {
      clock.restore();
    }
  };
}

const DELAY = 100;

suite('Debouncer', () => {
  test('runs once, the delay after the call', async () => {
    const debouncer = new Debouncer(DELAY);
    const runs: string[] = [];
    debouncer.schedule(() => runs.push('a'));
    assert.strictEqual(debouncer.pending, true);
    await wait(DELAY / 3);
    assert.strictEqual(runs.length, 0);
    await wait(DELAY * 2);
    assert.deepStrictEqual(runs, ['a']);
    assert.strictEqual(debouncer.pending, false);
  });

  test('a newer call replaces the waiting run and restarts the wait', onManualClock((clock) => {
    const debouncer = new Debouncer(DELAY);
    const runs: string[] = [];
    debouncer.schedule(() => runs.push('first'));
    clock.advance(DELAY * 0.6);
    debouncer.schedule(() => runs.push('second'));
    clock.advance(DELAY - 1);
    assert.deepStrictEqual(runs, [], 'the second call restarted the wait');
    clock.advance(1);
    assert.deepStrictEqual(runs, ['second']);
  }));

  test('is no longer pending while its run runs, so the run may schedule again', onManualClock((clock) => {
    const debouncer = new Debouncer(DELAY);
    const seen: boolean[] = [];
    let again = true;
    const run = (): void => {
      seen.push(debouncer.pending);
      if (!again) {
        return;
      }
      again = false;
      debouncer.schedule(run);
    };
    debouncer.schedule(run);
    clock.advance(DELAY * 4);
    assert.deepStrictEqual(seen, [false, false]);
  }));

  test('cancel and dispose drop the waiting run; a later call still runs', onManualClock((clock) => {
    const debouncer = new Debouncer(DELAY);
    const runs: string[] = [];
    debouncer.schedule(() => runs.push('cancelled'));
    debouncer.cancel();
    debouncer.cancel();
    debouncer.schedule(() => runs.push('disposed'));
    debouncer.dispose();
    assert.strictEqual(debouncer.pending, false);
    clock.advance(DELAY * 2);
    assert.strictEqual(runs.length, 0);
    debouncer.schedule(() => runs.push('after'));
    clock.advance(DELAY * 2);
    assert.deepStrictEqual(runs, ['after']);
  }));
});

suite('KeyedDebouncer', () => {
  test('keeps one waiting run per key, each replaced only by its own key', async () => {
    const debouncer = new KeyedDebouncer(DELAY);
    const runs: string[] = [];
    debouncer.schedule('a', () => runs.push('a1'));
    debouncer.schedule('b', () => runs.push('b1'));
    debouncer.schedule('a', () => runs.push('a2'));
    assert.strictEqual(debouncer.isPending('a'), true);
    assert.strictEqual(debouncer.isPending('b'), true);
    await wait(DELAY * 2);
    assert.deepStrictEqual(runs.sort(), ['a2', 'b1']);
    assert.strictEqual(debouncer.isPending('a'), false);
  });

  test('a call for another key neither restarts nor drops a waiting run', onManualClock((clock) => {
    const debouncer = new KeyedDebouncer(DELAY);
    const runs: string[] = [];
    debouncer.schedule('a', () => runs.push('a'));
    clock.advance(DELAY * 0.6);
    debouncer.schedule('b', () => runs.push('b'));
    clock.advance(DELAY * 0.4);
    assert.deepStrictEqual(runs, ['a']);
    clock.advance(DELAY * 0.6 - 1);
    assert.deepStrictEqual(runs, ['a']);
    clock.advance(1);
    assert.deepStrictEqual(runs, ['a', 'b']);
  }));

  test('forgets the key before its run, so the run may schedule its key again', onManualClock((clock) => {
    const debouncer = new KeyedDebouncer(DELAY);
    const seen: boolean[] = [];
    debouncer.schedule('a', () => {
      seen.push(debouncer.isPending('a'));
      debouncer.schedule('a', () => seen.push(debouncer.isPending('a')));
    });
    clock.advance(DELAY * 4);
    assert.deepStrictEqual(seen, [false, false]);
  }));

  test('cancel drops one key; dispose drops every key; later calls still run', onManualClock((clock) => {
    const debouncer = new KeyedDebouncer(DELAY);
    const runs: string[] = [];
    debouncer.schedule('a', () => runs.push('a'));
    debouncer.schedule('b', () => runs.push('b'));
    debouncer.cancel('a');
    debouncer.cancel('missing');
    assert.strictEqual(debouncer.isPending('a'), false);
    clock.advance(DELAY * 2);
    assert.deepStrictEqual(runs, ['b']);
    debouncer.schedule('a', () => runs.push('a again'));
    debouncer.schedule('c', () => runs.push('c'));
    debouncer.dispose();
    clock.advance(DELAY * 2);
    assert.deepStrictEqual(runs, ['b']);
    debouncer.schedule('a', () => runs.push('after'));
    clock.advance(DELAY * 2);
    assert.deepStrictEqual(runs, ['b', 'after']);
  }));
});
