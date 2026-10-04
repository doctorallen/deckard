import * as assert from 'assert';

import { chooseNoteTarget, readNoteTarget } from '../domain/notes/noteTarget';
import { openingOf } from '../webview/shared/openSource';
import { narrowOpenSource } from '../ui/webview/host/narrowing';

suite('Where a note opens', () => {
  test('the setting picks, and Shift picks the other', () => {
    assert.strictEqual(chooseNoteTarget('editor', false), 'editor');
    assert.strictEqual(chooseNoteTarget('editor', true), 'page');
    assert.strictEqual(chooseNoteTarget('page', false), 'page');
    assert.strictEqual(chooseNoteTarget('page', true), 'editor');
  });

  test('anything but page, as written, is the editor', () => {
    assert.strictEqual(readNoteTarget('page'), 'page');
    for (const value of ['editor', 'Page', '', undefined, 3]) {
      assert.strictEqual(readNoteTarget(value), 'editor', String(value));
    }
  });

  test('a click carries Shift as the other way, beside Cmd/Ctrl and a double-click', () => {
    const click = (init: Partial<MouseEvent>) => ({ metaKey: false, ctrlKey: false, shiftKey: false, detail: 1, ...init }) as MouseEvent;
    assert.deepStrictEqual(openingOf(click({})), { beside: false, pin: false, opposite: false });
    assert.deepStrictEqual(openingOf(click({ shiftKey: true })), { beside: false, pin: false, opposite: true });
    assert.deepStrictEqual(openingOf(click({ shiftKey: true, metaKey: true, detail: 2 })), { beside: true, pin: true, opposite: true });
    const base = { type: 'openSource', filePath: 'a.md', line: 2 };
    assert.deepStrictEqual(narrowOpenSource({ ...base, opposite: true }), { ...base, opposite: true }, 'the host passes it on');
    assert.deepStrictEqual(narrowOpenSource({ ...base, opposite: false }), base, 'and leaves it off when it is off');
    assert.strictEqual(narrowOpenSource({ ...base, opposite: 'yes' }), undefined);
  });
});
