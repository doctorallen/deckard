import * as assert from 'assert';

import { resolveIndexedTagKey } from '../core/workspace/tagNavigation';

suite('Tag navigation', () => {
  test('resolves canonical and markerless namespaced keys', () => {
    const tags = new Map([
      ['#project/neon-relay', true],
      ['#topic/operations', true],
    ]);

    assert.strictEqual(
      resolveIndexedTagKey(tags, '#project/neon-relay'),
      '#project/neon-relay',
    );
    assert.strictEqual(
      resolveIndexedTagKey(tags, 'project/neon-relay'),
      '#project/neon-relay',
    );
    assert.strictEqual(
      resolveIndexedTagKey(tags, '#PROJECT/NEON-RELAY'),
      '#project/neon-relay',
    );
  });

  test('returns undefined for empty or unknown keys', () => {
    const tags = new Map([['#project/neon-relay', true]]);

    assert.strictEqual(resolveIndexedTagKey(tags, '  '), undefined);
    assert.strictEqual(resolveIndexedTagKey(tags, 'project/missing'), undefined);
  });
});
