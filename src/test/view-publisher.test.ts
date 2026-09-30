import * as assert from 'assert';

import { setTimingLog } from '../core/timing';
import type { WorkspaceIndex } from '../core/types';
import { ViewPublisher } from '../core/workspace/viewPublisher';

/** A publisher whose view turns a test steps through, one `step` per host turn. */
function createPublisher() {
  const turns: Array<() => void> = [];
  const publisher = new ViewPublisher((run) => turns.push(run));
  const drain = (ran: string[]) => {
    for (let run = turns.shift(); run; run = turns.shift()) {
      run();
      ran.push('|');
    }
  };
  return { publisher, turns, drain };
}

/** An index for a publish; the publisher never looks inside it. */
const INDEX = {} as WorkspaceIndex;

suite('Publishing to views in turns', () => {
  test('tells the plain listeners at once with the index, then each view in a turn, by priority', () => {
    const { publisher, drain } = createPublisher();
    const ran: string[] = [];
    publisher.onDidUpdateView(() => ran.push('later'), { name: 'later', priority: () => 2 });
    publisher.onDidUpdateView(() => ran.push('front'), { name: 'front', priority: () => 0 });
    publisher.onDidUpdate((index) => ran.push(index === INDEX ? 'plain' : 'wrong index'));
    publisher.publish(() => INDEX);
    assert.deepStrictEqual(ran, ['plain']);
    drain(ran);
    assert.deepStrictEqual(ran, ['plain', 'front', '|', 'later', '|']);
    publisher.dispose();
  });

  test('derives the index once, inside the timing of the plain listeners', () => {
    const { publisher } = createPublisher();
    const lines: string[] = [];
    setTimingLog({ logLevel: 2, trace: () => undefined, debug: (line) => lines.push(line), info: (line) => lines.push(line) });
    let derived = 0;
    try {
      publisher.publish(() => {
        derived += 1;
        lines.push('derived');
        return INDEX;
      });
    } finally {
      setTimingLog(undefined);
      publisher.dispose();
    }
    assert.strictEqual(derived, 1);
    assert.strictEqual(lines[0], 'derived');
    assert.ok(lines[1]?.startsWith('Refresh views after an index update'), lines.join('\n'));
  });

  test('resolves published at the first publish', async () => {
    const { publisher } = createPublisher();
    let resolved = false;
    void publisher.published.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    assert.strictEqual(resolved, false, 'not before a publish');
    publisher.publish(() => INDEX);
    await publisher.published;
    assert.strictEqual(resolved, true);
    publisher.dispose();
  });

  test('puts a view last when its priority throws or is not a number, in the order views asked', () => {
    const { publisher, drain } = createPublisher();
    const ran: string[] = [];
    publisher.onDidUpdateView(() => ran.push('throws'), {
      name: 'throws',
      priority: () => {
        throw new Error('no priority');
      },
    });
    publisher.onDidUpdateView(() => ran.push('nan'), { name: 'nan', priority: () => Number.NaN });
    publisher.onDidUpdateView(() => ran.push('hidden'), { name: 'hidden', priority: () => 2 });
    publisher.publish(() => INDEX);
    drain(ran);
    assert.deepStrictEqual(ran, ['hidden', '|', 'throws', '|', 'nan', '|']);
    publisher.dispose();
  });

  test('skips a view disposed while it waited, and runs nothing once disposed', () => {
    const { publisher, turns, drain } = createPublisher();
    const ran: string[] = [];
    const gone = publisher.onDidUpdateView(() => ran.push('gone'), { name: 'gone', priority: () => 0 });
    publisher.onDidUpdateView(() => ran.push('kept'), { name: 'kept', priority: () => 1 });
    publisher.publish(() => INDEX);
    gone.dispose();
    drain(ran);
    assert.deepStrictEqual(ran, ['kept', '|']);

    ran.length = 0;
    publisher.publish(() => INDEX);
    publisher.dispose();
    assert.strictEqual(turns.length, 1, 'the turn was already asked for');
    drain(ran);
    assert.deepStrictEqual(ran, ['|'], 'and does nothing');
  });
});
