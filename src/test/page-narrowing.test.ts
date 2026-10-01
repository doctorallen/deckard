import * as assert from 'assert';

import {
  exactlyType,
  isRequestId,
  isSourceLocation,
  isStringArray,
  MAX_QUERY_LENGTH,
  narrowAs,
  narrowExportResults,
  narrowOpenSearch,
  narrowOpenSource,
  narrowOpenTag,
  narrowParkTag,
  narrowPinNote,
  narrowRenameTag,
  narrowSetZenMode,
  narrowToggleTask,
  narrowWith,
  onlyType,
} from '../ui/webview/host/narrowing';

/** Every value narrows to `expected`, or, with `undefined`, is refused. */
function check<T>(narrow: (value: unknown) => T | undefined, cases: Array<[unknown, T | undefined]>): void {
  for (const [value, expected] of cases) {
    assert.deepStrictEqual(narrow(value), expected, JSON.stringify(value));
  }
}

/** A page's table of the shared checks, keyed as a page keys its own. */
const narrow = narrowWith<{
  setZenMode: ReturnType<typeof narrowSetZenMode>;
  openSource: ReturnType<typeof narrowOpenSource>;
  openTag: ReturnType<typeof narrowOpenTag>;
  renameTag: ReturnType<typeof narrowRenameTag>;
  parkTag: ReturnType<typeof narrowParkTag>;
  unparkTag: ReturnType<typeof narrowParkTag>;
  toggleTask: ReturnType<typeof narrowToggleTask>;
  pinNote: ReturnType<typeof narrowPinNote>;
  unpinNote: ReturnType<typeof narrowPinNote>;
  openSearch: ReturnType<typeof narrowOpenSearch>;
  exportResults: ReturnType<typeof narrowExportResults>;
  chooseTheme: { type: 'chooseTheme' };
  openHelp: { type: 'openHelp' };
}>({
  setZenMode: narrowSetZenMode,
  openSource: narrowOpenSource,
  openTag: narrowOpenTag,
  renameTag: narrowRenameTag,
  parkTag: narrowParkTag,
  unparkTag: narrowParkTag,
  toggleTask: narrowToggleTask,
  pinNote: narrowPinNote,
  unpinNote: narrowPinNote,
  openSearch: narrowOpenSearch,
  exportResults: narrowExportResults,
  chooseTheme: onlyType('chooseTheme'),
  openHelp: exactlyType('openHelp'),
});

suite('Page message narrowing', () => {
  test('refuses anything that is not a message of a type the table names', () => {
    check(narrow, [
      [undefined, undefined],
      [null, undefined],
      ['openTag', undefined],
      [{ tagKey: '#a' }, undefined],
      [{ type: 7 }, undefined],
      [{ type: 'unknown' }, undefined],
      // A type only the prototype has names nothing.
      [{ type: 'constructor' }, undefined],
      [{ type: 'hasOwnProperty' }, undefined],
      [{ type: '__proto__' }, undefined],
    ]);
  });

  test('a type alone: any extra fields, or none', () => {
    check(narrow, [
      [{ type: 'chooseTheme' }, { type: 'chooseTheme' }],
      [{ type: 'chooseTheme', extra: 1 }, { type: 'chooseTheme' }],
      [{ type: 'openHelp' }, { type: 'openHelp' }],
      [{ type: 'openHelp', topic: 'periodic' }, undefined],
    ]);
  });

  test('zen on or off', () => {
    check(narrow, [
      [{ type: 'setZenMode', enabled: true }, { type: 'setZenMode', enabled: true }],
      [{ type: 'setZenMode', enabled: false, extra: 1 }, { type: 'setZenMode', enabled: false }],
      [{ type: 'setZenMode', enabled: 'yes' }, undefined],
      [{ type: 'setZenMode' }, undefined],
    ]);
  });

  test('a line to open keeps Beside and Keep only when they are on', () => {
    check(narrow, [
      [{ type: 'openSource', filePath: 'notes/a.md', line: 3 }, { type: 'openSource', filePath: 'notes/a.md', line: 3 }],
      [
        { type: 'openSource', filePath: 'notes/a.md', line: 3, beside: true, pin: true, extra: 1 },
        { type: 'openSource', filePath: 'notes/a.md', line: 3, beside: true, pin: true },
      ],
      [{ type: 'openSource', filePath: 'notes/a.md', line: 3, beside: false, pin: false }, { type: 'openSource', filePath: 'notes/a.md', line: 3 }],
      [{ type: 'openSource', filePath: 'notes/a.md', line: 0 }, undefined],
      [{ type: 'openSource', filePath: 'notes/a.md', line: 1.5 }, undefined],
      [{ type: 'openSource', filePath: 'notes/a.md', line: '3' }, undefined],
      [{ type: 'openSource', line: 3 }, undefined],
      [{ type: 'openSource', filePath: 'notes/a.md', line: 3, beside: 'yes' }, undefined],
      [{ type: 'openSource', filePath: 'notes/a.md', line: 3, pin: 1 }, undefined],
    ]);
    assert.strictEqual(isSourceLocation({ filePath: '', line: 1 }), true, 'the host decides whether a path is a note');
  });

  test('a tag to open or rename by any non-empty key, and to park by that alone', () => {
    check(narrow, [
      [{ type: 'openTag', tagKey: 'project/relay', extra: 1 }, { type: 'openTag', tagKey: 'project/relay' }],
      [{ type: 'openTag', tagKey: '' }, undefined],
      [{ type: 'openTag', tagKey: 3 }, undefined],
      [{ type: 'renameTag', tagKey: '#a', extra: 1 }, { type: 'renameTag', tagKey: '#a' }],
      [{ type: 'renameTag' }, undefined],
      [{ type: 'parkTag', tagKey: '#a' }, { type: 'parkTag', tagKey: '#a' }],
      [{ type: 'unparkTag', tagKey: '#a' }, { type: 'unparkTag', tagKey: '#a' }],
      [{ type: 'parkTag', tagKey: '#a', extra: 1 }, undefined],
      [{ type: 'unparkTag', tagKey: '' }, undefined],
    ]);
  });

  test('a task box by id, checked or not', () => {
    check(narrow, [
      [{ type: 'toggleTask', taskId: 'a', completed: true, extra: 1 }, { type: 'toggleTask', taskId: 'a', completed: true }],
      [{ type: 'toggleTask', taskId: '', completed: false }, { type: 'toggleTask', taskId: '', completed: false }],
      [{ type: 'toggleTask', taskId: 'a' }, undefined],
      [{ type: 'toggleTask', completed: true }, undefined],
    ]);
  });

  test('a pin keeps its line and key only when they are well formed', () => {
    check(narrow, [
      [{ type: 'pinNote', filePath: 'notes/a.md' }, { type: 'pinNote', filePath: 'notes/a.md' }],
      [{ type: 'pinNote', filePath: 'notes/a.md', line: 4, pinKey: 'k' }, { type: 'pinNote', filePath: 'notes/a.md', line: 4, pinKey: 'k' }],
      [{ type: 'unpinNote', filePath: 'notes/a.md', line: 0, pinKey: '' }, { type: 'unpinNote', filePath: 'notes/a.md' }],
      [{ type: 'pinNote', filePath: 'notes/a.md', line: 2.5 }, { type: 'pinNote', filePath: 'notes/a.md' }],
      [{ type: 'pinNote', filePath: '' }, undefined],
      [{ type: 'unpinNote' }, undefined],
    ]);
  });

  test('a search no longer than a search may be, and an export of notes or tasks', () => {
    check(narrow, [
      [{ type: 'openSearch', query: '#a is:open' }, { type: 'openSearch', query: '#a is:open' }],
      [{ type: 'openSearch', query: '' }, { type: 'openSearch', query: '' }],
      [{ type: 'openSearch', query: 'x'.repeat(MAX_QUERY_LENGTH) }, { type: 'openSearch', query: 'x'.repeat(MAX_QUERY_LENGTH) }],
      [{ type: 'openSearch', query: 'x'.repeat(MAX_QUERY_LENGTH + 1) }, undefined],
      [{ type: 'exportResults', kind: 'tasks', extra: 1 }, { type: 'exportResults', kind: 'tasks' }],
      [{ type: 'exportResults', kind: 'notes' }, { type: 'exportResults', kind: 'notes' }],
      [{ type: 'exportResults', kind: 'cards' }, undefined],
    ]);
  });

  test('one type of a check that serves two, under the key a table lists it by', () => {
    const tabled = narrowWith({
      parkTag: narrowAs('parkTag', narrowParkTag),
      unparkTag: narrowAs('unparkTag', narrowParkTag),
      pinNote: narrowAs('pinNote', narrowPinNote),
      unpinNote: narrowAs('unpinNote', narrowPinNote),
    });
    check(tabled, [
      [{ type: 'parkTag', tagKey: '#a' }, { type: 'parkTag', tagKey: '#a' }],
      [{ type: 'unparkTag', tagKey: '#a' }, { type: 'unparkTag', tagKey: '#a' }],
      [{ type: 'parkTag', tagKey: '#a', extra: 1 }, undefined],
      [{ type: 'pinNote', filePath: '/a.md', line: 2 }, { type: 'pinNote', filePath: '/a.md', line: 2 }],
      [{ type: 'unpinNote', filePath: '/a.md', pinKey: 'k' }, { type: 'unpinNote', filePath: '/a.md', pinKey: 'k' }],
    ]);
    // Asked directly of a message of the other type, it refuses it.
    assert.strictEqual(narrowAs('pinNote', narrowPinNote)({ type: 'unpinNote', filePath: '/a.md' }), undefined);
  });

  test('a request id is a whole number held exactly', () => {
    for (const id of [0, 1, -3, Number.MAX_SAFE_INTEGER]) {
      assert.strictEqual(isRequestId(id), true, String(id));
    }
    for (const id of [1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null, undefined]) {
      assert.strictEqual(isRequestId(id), false, String(id));
    }
  });

  test('an array of strings', () => {
    assert.strictEqual(isStringArray(['a', 'b']), true);
    assert.strictEqual(isStringArray([]), true);
    assert.strictEqual(isStringArray(['a', 1]), false);
    assert.strictEqual(isStringArray('a'), false);
  });
});
