import * as assert from 'assert';

import { type FirstRunNotice, sayOneNotice } from '../ui/commands/firstRunNotices';

/** A notice that records that it was asked, and says it or not. */
function notice(name: string, asked: string[], says: boolean | Error): FirstRunNotice {
  return {
    say: async () => {
      asked.push(name);
      if (says instanceof Error) {
        throw says;
      }
      return says;
    },
    failure: `Could not say ${name}`,
  };
}

suite('First-run notices', () => {
  test('says the first notice that has something to say, and asks none after it', async () => {
    const asked: string[] = [];
    const said = await sayOneNotice([notice('status', asked, false), notice('summary', asked, true), notice('unknown', asked, true)]);
    assert.strictEqual(said, 1);
    assert.deepStrictEqual(asked, ['status', 'summary']);
  });

  test('a notice that fails is passed over for the next', async () => {
    const asked: string[] = [];
    const said = await sayOneNotice([notice('status', asked, new Error('no settings')), notice('summary', asked, true)]);
    assert.strictEqual(said, 1);
    assert.deepStrictEqual(asked, ['status', 'summary']);
  });

  test('says nothing when no notice has anything to say', async () => {
    const asked: string[] = [];
    assert.strictEqual(await sayOneNotice([notice('status', asked, false), notice('unknown', asked, false)]), -1);
    assert.deepStrictEqual(asked, ['status', 'unknown']);
  });
});
