import * as assert from 'assert';

import { parseStatsMessage } from '../ui/webview/messages';

suite('Stats messages', () => {
  test('accepts the messages its rows post', () => {
    assert.deepStrictEqual(
      parseStatsMessage({ type: 'openTag', tagKey: '#project/relay' }),
      { type: 'openTag', tagKey: '#project/relay' },
    );
    assert.deepStrictEqual(
      parseStatsMessage({
        type: 'openSource',
        filePath: 'notes/first.md',
        line: 3,
      }),
      { type: 'openSource', filePath: 'notes/first.md', line: 3 },
    );
  });

  test('keeps only the fields the host reads', () => {
    assert.deepStrictEqual(
      parseStatsMessage({
        type: 'openTag',
        tagKey: '#project/relay',
        filterTagKeys: ['#risk/vendor'],
      }),
      { type: 'openTag', tagKey: '#project/relay' },
    );
  });

  test('rejects anything its rows could not have posted', () => {
    for (const message of [
      undefined,
      'openTag',
      { type: 'openTag', tagKey: '' },
      { type: 'openSource', filePath: 'notes/first.md', line: 0 },
      { type: 'openSource', filePath: 'notes/first.md', line: 1.5 },
      { type: 'toggleTask', taskId: 'a', completed: true },
    ]) {
      assert.strictEqual(
        parseStatsMessage(message),
        undefined,
        JSON.stringify(message),
      );
    }
  });
});
