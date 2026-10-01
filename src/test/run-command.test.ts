import * as assert from 'assert';

import * as vscode from 'vscode';

import { setTimingLog, TimingLog } from '../shared/timing';
import { runCommand } from '../ui/commands/runCommand';

/** A log that keeps its error lines, at the default level. */
function createLog() {
  const errors: string[] = [];
  const log: TimingLog = {
    logLevel: 3,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    error: (message) => errors.push(message),
  };
  return { log, errors };
}

suite('runCommand', () => {
  teardown(() => setTimingLog(undefined));

  test('returns what the handler returns, a value at once and a promise as a promise', async () => {
    const { log, errors } = createLog();
    setTimingLog(log);
    assert.strictEqual(runCommand('deckard.test', (value: number) => value + 1)(41), 42);
    const pending = runCommand('deckard.test', async (value: number) => value * 2)(21);
    assert.ok(pending instanceof Promise);
    assert.strictEqual(await pending, 42);
    assert.deepStrictEqual(errors, []);
  });

  test('swallows a cancellation, thrown or rejected, and logs nothing', async () => {
    const { log, errors } = createLog();
    setTimingLog(log);
    const thrown = runCommand('deckard.test', (): number => {
      throw new vscode.CancellationError();
    });
    assert.strictEqual(thrown(), undefined);
    const rejected = runCommand('deckard.test', async (): Promise<number> => {
      throw new vscode.CancellationError();
    });
    assert.strictEqual(await rejected(), undefined);
    assert.deepStrictEqual(errors, []);
  });

  test('logs any other failure with the command and throws it on, unchanged', async () => {
    const { log, errors } = createLog();
    setTimingLog(log);
    const failure = new Error('disk full');
    const thrown = runCommand('deckard.sync', () => {
      throw failure;
    });
    assert.throws(() => thrown(), (error) => error === failure);
    const rejected = runCommand('deckard.async', async () => {
      throw failure;
    });
    await assert.rejects(rejected() as Promise<never>, (error: unknown) => error === failure);
    assert.deepStrictEqual(errors, [
      'The command deckard.sync failed: disk full',
      'The command deckard.async failed: disk full',
    ]);
  });
});
