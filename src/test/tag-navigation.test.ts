import * as assert from 'assert';

import { resolveIndexedTagKey } from '../domain/index/tagNavigation';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { getEntityNamespaceAliases, parseMarkdown } from '../domain/markdown/parser';
import { parseQuery } from '../domain/query/queryParser';
import { resolveQueryTagIntersection } from '../ui/state/searchPageState';

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

  test('resolves a namespace through its alias, as the index keyed the tag', () => {
    const tags = new Map([
      ['#org/acme', true],
      ['#client/zeta', true],
    ]);

    assert.strictEqual(resolveIndexedTagKey(tags, '#organization/acme'), '#org/acme');
    assert.strictEqual(resolveIndexedTagKey(tags, 'Organization/Acme'), '#org/acme');
    const aliases = getEntityNamespaceAliases({ customer: 'client' });
    assert.strictEqual(resolveIndexedTagKey(tags, '#customer/zeta', aliases), '#client/zeta');
    assert.strictEqual(resolveIndexedTagKey(tags, '#customer/zeta'), undefined, 'a workspace alias needs the workspace\'s aliases');
    assert.strictEqual(resolveIndexedTagKey(tags, '#org/acme', getEntityNamespaceAliases({ org: 'company' })), '#org/acme', 'a key the index has is taken as it is');
  });

  test('a search for a tag by its alias gets the tag\'s header on the search page', () => {
    const note = parseMarkdown('notes/acme.md', '# Acme #organization/acme\n');
    const index = buildWorkspaceIndex(new Map([[note.filePath, note]]));
    assert.deepStrictEqual(resolveQueryTagIntersection(index, parseQuery('#organization/acme')), ['#org/acme']);
  });
});
