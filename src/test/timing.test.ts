import * as assert from 'assert';

import {
  logTrace,
  measure,
  measureAsync,
  setTimingLog,
  SLOW_OPERATION_MS,
  TimingLog,
} from '../core/timing';

/** VS Code's numbering: Trace 1, Debug 2, Info 3. */
function createLog(logLevel: number) {
  const lines: Array<[string, string]> = [];
  const log: TimingLog = {
    logLevel,
    trace: (message) => lines.push(['trace', message]),
    debug: (message) => lines.push(['debug', message]),
    info: (message) => lines.push(['info', message]),
  };
  return { log, lines };
}

/** Holds the thread for at least `milliseconds`. */
function busyWait(milliseconds: number): void {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    // Waiting.
  }
}

suite('Timing log', () => {
  teardown(() => setTimingLog(undefined));

  test('runs the work and returns its result with no log attached', () => {
    assert.strictEqual(measure('Nothing', () => 42), 42);
  });

  test('writes every measurement at Debug when the log keeps Debug', () => {
    const { log, lines } = createLog(2);
    setTimingLog(log);
    measure('Build index', () => [1, 2, 3], (items) => `${items.length} notes`);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0][0], 'debug');
    assert.match(lines[0][1], /^Build index: \d+\.\d ms \(3 notes\)$/);
  });

  test('keeps quick work out of a log at the default Info level', () => {
    const { log, lines } = createLog(3);
    setTimingLog(log);
    let described = false;
    measure('Tag links', () => 1, () => {
      described = true;
      return 'detail';
    });
    assert.deepStrictEqual(lines, []);
    assert.strictEqual(described, false, 'an unwritten line is never built');
  });

  test('reports slow work at Info so it shows by default', () => {
    const { log, lines } = createLog(3);
    setTimingLog(log);
    measure('Related Notes', () => busyWait(SLOW_OPERATION_MS + 5));
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0][0], 'info');
    assert.match(lines[0][1], /^Slow: Related Notes: \d+\.\d ms$/);
  });

  test('measures work that finishes later', async () => {
    const { log, lines } = createLog(2);
    setTimingLog(log);
    const result = await measureAsync('Scan workspace', async () => 'done');
    assert.strictEqual(result, 'done');
    assert.match(lines[0][1], /^Scan workspace: /);
  });

  test('still reports work that throws', () => {
    const { log, lines } = createLog(2);
    setTimingLog(log);
    assert.throws(() =>
      measure('Broken', () => {
        throw new Error('boom');
      }),
    );
    assert.match(lines[0][1], /^Broken: /);
  });

  test('builds Trace lines only when the log keeps them', () => {
    const { log, lines } = createLog(2);
    setTimingLog(log);
    logTrace(() => {
      throw new Error('a Trace line should not be built at Debug');
    });
    assert.deepStrictEqual(lines, []);

    const trace = createLog(1);
    setTimingLog(trace.log);
    logTrace(() => 'cursor moved');
    assert.deepStrictEqual(trace.lines, [['trace', 'cursor moved']]);
  });

  test('writes nothing when the log is off', () => {
    const { log, lines } = createLog(0);
    setTimingLog(log);
    measure('Build index', () => 1);
    logTrace(() => 'hidden');
    assert.deepStrictEqual(lines, []);
  });
});
