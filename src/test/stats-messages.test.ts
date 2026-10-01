import * as assert from 'assert';

import { narrowStatsMessage } from '../ui/webview/pages/stats/messages';

// The Stats page's narrowing table, with the payloads parseStatsMessage was
// held to before it moved: each accepted message, and each refused one.
suite('Stats messages', () => {
  test('accepts the messages its rows post', () => {
    assert.deepStrictEqual(
      narrowStatsMessage({ type: 'openTag', tagKey: '#project/relay' }),
      { type: 'openTag', tagKey: '#project/relay' },
    );
    assert.deepStrictEqual(
      narrowStatsMessage({
        type: 'openSource',
        filePath: 'notes/first.md',
        line: 3,
      }),
      { type: 'openSource', filePath: 'notes/first.md', line: 3 },
    );
  });

  test('keeps only the fields the host reads', () => {
    assert.deepStrictEqual(
      narrowStatsMessage({
        type: 'openTag',
        tagKey: '#project/relay',
        filterTagKeys: ['#risk/vendor'],
      }),
      { type: 'openTag', tagKey: '#project/relay' },
    );
    assert.deepStrictEqual(
      narrowStatsMessage({ type: 'openSource', filePath: 'notes/first.md', line: 3, beside: true, pin: false, extra: 1 }),
      { type: 'openSource', filePath: 'notes/first.md', line: 3, beside: true },
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
        narrowStatsMessage(message),
        undefined,
        JSON.stringify(message),
      );
    }
  });

  test('accepts the messages the totals post, and nothing like them', () => {
    assert.deepStrictEqual(narrowStatsMessage({ type: 'openTagList', namespaced: true }), { type: 'openTagList', namespaced: true });
    assert.deepStrictEqual(narrowStatsMessage({ type: 'openNotesGraph', onlyWrittenLinks: true, extra: 1 }), { type: 'openNotesGraph', onlyWrittenLinks: true });
    assert.deepStrictEqual(narrowStatsMessage({ type: 'openSearch', query: 'link = [[Q4 offsite]]' }), { type: 'openSearch', query: 'link = [[Q4 offsite]]' });
    assert.deepStrictEqual(narrowStatsMessage({ type: 'reindexWorkspace' }), { type: 'reindexWorkspace' });
    for (const message of [
      { type: 'openTagList' },
      { type: 'openTagList', namespaced: 'yes' },
      { type: 'openNotesGraph' },
      { type: 'openNotesGraph', onlyWrittenLinks: false },
      { type: 'openSearch', query: 'x'.repeat(2001) },
      { type: 'reindexWorkspace', now: true },
    ]) {
      assert.strictEqual(narrowStatsMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('accepts a band and a merge into, and nothing malformed', () => {
    assert.deepStrictEqual(narrowStatsMessage({ type: 'openTagList', namespaced: false, min: 3, max: 5 }), { type: 'openTagList', namespaced: false, min: 3, max: 5 });
    assert.deepStrictEqual(narrowStatsMessage({ type: 'mergeTagInto', sourceKey: '#once' }), { type: 'mergeTagInto', sourceKey: '#once' });
    for (const message of [
      { type: 'openTagList', namespaced: false, min: 0 },
      { type: 'openTagList', namespaced: false, min: 5, max: 3 },
      { type: 'openTagList', namespaced: false, max: 3 },
      { type: 'mergeTagInto', sourceKey: '' },
      { type: 'mergeTagInto', sourceKey: 'x'.repeat(501) },
    ]) {
      assert.strictEqual(narrowStatsMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('accepts the merge a pair posts, and nothing else', () => {
    assert.deepStrictEqual(
      narrowStatsMessage({
        type: 'mergeTags',
        sourceKey: '#project/atlss',
        targetKey: '#project/atlas',
      }),
      {
        type: 'mergeTags',
        sourceKey: '#project/atlss',
        targetKey: '#project/atlas',
      },
    );
    for (const message of [
      { type: 'mergeTags', sourceKey: '#a', targetKey: '#a' },
      { type: 'mergeTags', sourceKey: '', targetKey: '#a' },
      { type: 'mergeTags', sourceKey: '#a' },
      { type: 'mergeTags', sourceKey: 1, targetKey: 2 },
    ]) {
      assert.strictEqual(
        narrowStatsMessage(message),
        undefined,
        JSON.stringify(message),
      );
    }
  });

  test('accepts the names to create, up to five hundred, and nothing malformed', () => {
    assert.deepStrictEqual(narrowStatsMessage({ type: 'createMissingNotes', names: ['Q4 offsite'] }), { type: 'createMissingNotes', names: ['Q4 offsite'] });
    assert.deepStrictEqual(narrowStatsMessage({ type: 'createMissingNotes', names: [] }), { type: 'createMissingNotes', names: [] });
    for (const message of [
      { type: 'createMissingNotes' },
      { type: 'createMissingNotes', names: [''] },
      { type: 'createMissingNotes', names: [7] },
      { type: 'createMissingNotes', names: ['x'.repeat(501)] },
      { type: 'createMissingNotes', names: Array.from({ length: 501 }, (_, at) => `n${at}`) },
    ]) {
      assert.strictEqual(narrowStatsMessage(message), undefined, JSON.stringify(message).slice(0, 80));
    }
  });
});
