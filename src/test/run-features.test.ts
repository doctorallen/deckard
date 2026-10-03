import * as assert from 'assert';

import type * as vscode from 'vscode';

import { NamedFeature, runFeatures } from '../composition/feature';
import type { Services } from '../composition/services';
import { setTimingLog, TimingLog } from '../shared/timing';

suite('runFeatures', () => {
  teardown(() => setTimingLog(undefined));

  test('runs every feature in order, and logs one that fails rather than stopping', async () => {
    const errors: string[] = [];
    const log: TimingLog = {
      logLevel: 3,
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      error: (message) => errors.push(message),
    };
    setTimingLog(log);
    const ran: string[] = [];
    const features: NamedFeature[] = [
      { name: 'first', register: () => void ran.push('first') },
      {
        name: 'throwing',
        register: () => {
          ran.push('throwing');
          throw new Error('no such view');
        },
      },
      {
        name: 'rejecting',
        register: async () => {
          ran.push('rejecting');
          throw new Error('no such setting');
        },
      },
      { name: 'last', register: () => void ran.push('last') },
    ];
    runFeatures(features, {} as vscode.ExtensionContext, {} as Services);
    // Each synchronous feature has run by the time runFeatures returns.
    assert.deepStrictEqual(ran, ['first', 'throwing', 'rejecting', 'last']);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(errors, [
      'Deckard could not register throwing: no such view',
      'Deckard could not register rejecting: no such setting',
    ]);
  });
});
