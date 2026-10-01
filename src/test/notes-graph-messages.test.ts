import * as assert from 'assert';

import { narrowNotesGraphMessage } from '../ui/webview/pages/notesGraph/messages';

// The Notes Graph's narrowing table, with the payloads parseNotesGraphMessage
// was held to before it moved: each accepted message, and each refused one.
suite('Notes graph page messages', () => {
  test('accepts the scope a graph asks for, and no other', () => {
    assert.deepStrictEqual(
      narrowNotesGraphMessage({ type: 'setGraphScope', local: true, depth: 2 }),
      { type: 'setGraphScope', local: true, depth: 2 },
    );
    assert.deepStrictEqual(
      narrowNotesGraphMessage({ type: 'setGraphScope', local: false, depth: 1, skipPeriodic: false }),
      { type: 'setGraphScope', local: false, depth: 1, skipPeriodic: false },
    );
    for (const message of [
      { type: 'setGraphScope', local: true, depth: 0 },
      { type: 'setGraphScope', local: true, depth: 9 },
      { type: 'setGraphScope', local: true, depth: 1.5 },
      { type: 'setGraphScope', local: 'yes', depth: 1 },
      { type: 'setGraphScope', local: true, depth: 1, skipPeriodic: 'yes' },
    ]) {
      assert.strictEqual(
        narrowNotesGraphMessage(message),
        undefined,
        JSON.stringify(message),
      );
    }
  });

  test('accepts a filter message only with both kinds said', () => {
    assert.deepStrictEqual(
      narrowNotesGraphMessage({ type: 'setGraphFilter', showNotes: true, showTasks: false }),
      { type: 'setGraphFilter', showNotes: true, showTasks: false },
    );
    assert.strictEqual(narrowNotesGraphMessage({ type: 'setGraphFilter', showNotes: true }), undefined);
    assert.strictEqual(narrowNotesGraphMessage({ type: 'setGraphFilter', showNotes: 'yes', showTasks: true }), undefined);
  });

  test('accepts valid openSource and openTag messages', () => {
    assert.deepStrictEqual(
      narrowNotesGraphMessage({
        type: 'openSource',
        filePath: 'notes/a.md',
        line: 3,
      }),
      { type: 'openSource', filePath: 'notes/a.md', line: 3 },
    );
    assert.deepStrictEqual(
      narrowNotesGraphMessage({ type: 'openTag', tagKey: 'project/atlas' }),
      { type: 'openTag', tagKey: 'project/atlas' },
    );
    assert.deepStrictEqual(
      narrowNotesGraphMessage({
        type: 'selectNode',
        nodeId: 'section:notes/a.md:3',
      }),
      { type: 'selectNode', nodeId: 'section:notes/a.md:3' },
    );
    assert.deepStrictEqual(narrowNotesGraphMessage({ type: 'clearSelection' }), {
      type: 'clearSelection',
    });
  });

  test('keeps only the fields the host reads', () => {
    assert.deepStrictEqual(
      narrowNotesGraphMessage({ type: 'openSource', filePath: 'notes/a.md', line: 3, beside: true, pin: false, extra: 1 }),
      { type: 'openSource', filePath: 'notes/a.md', line: 3, beside: true },
    );
    assert.deepStrictEqual(
      narrowNotesGraphMessage({ type: 'clearSelection', nodeId: 'tag:#project/atlas' }),
      { type: 'clearSelection' },
    );
    assert.deepStrictEqual(
      narrowNotesGraphMessage({ type: 'selectNode', nodeId: 'tag:#project/atlas', open: true }),
      { type: 'selectNode', nodeId: 'tag:#project/atlas' },
    );
  });

  test('rejects malformed messages', () => {
    assert.strictEqual(narrowNotesGraphMessage(undefined), undefined);
    assert.strictEqual(narrowNotesGraphMessage({ type: 'unknown' }), undefined);
    assert.strictEqual(narrowNotesGraphMessage({ type: 'constructor' }), undefined);
    assert.strictEqual(
      narrowNotesGraphMessage({ type: 'openSource', filePath: 'a.md', line: 0 }),
      undefined,
    );
    assert.strictEqual(
      narrowNotesGraphMessage({
        type: 'openSource',
        filePath: 'a.md',
        line: 1.5,
      }),
      undefined,
    );
    assert.strictEqual(
      narrowNotesGraphMessage({ type: 'openTag', tagKey: '' }),
      undefined,
    );
    assert.strictEqual(
      narrowNotesGraphMessage({ type: 'selectNode', nodeId: '' }),
      undefined,
    );
    // Escape on the canvas posts this; it is refused, as it always was.
    assert.strictEqual(
      narrowNotesGraphMessage({ type: 'selectNode', nodeId: null }),
      undefined,
    );
  });
});
