import * as assert from 'assert';

import { narrowSidebarNotesMessage } from '../ui/webview/pages/sidebarNotes/messages';

// The Related Notes sidebar's narrowing table, with the payloads
// parseSidebarMessage and the host's own three checks were held to before
// they moved: each accepted message, and each refused one.
suite('Related Notes messages', () => {
  test('accepts only valid sidebar navigation messages', () => {
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'openSource', filePath: 'notes/related.md', line: 4 }),
      { type: 'openSource', filePath: 'notes/related.md', line: 4 },
    );
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'openTag', tagKey: 'work' }), { type: 'openTag', tagKey: 'work' });
    // A tag opens its own page; the old filter arguments are dropped.
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'openTag', tagKey: '#focus', filterTagKeys: ['#first', '#second'] }),
      { type: 'openTag', tagKey: '#focus' },
    );
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'renameTag', tagKey: '#work' }), { type: 'renameTag', tagKey: '#work' });
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'refineActiveSearch', facetId: 'related', clause: '#team/harbor', mode: 'exclude', extra: 'dropped' }),
      { type: 'refineActiveSearch', facetId: 'related', clause: '#team/harbor', mode: 'exclude' },
    );
    assert.strictEqual(
      narrowSidebarNotesMessage({ type: 'refineActiveSearch', facetId: 'related', clause: '#team/harbor', mode: 'replace' }),
      undefined,
    );
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'refineActiveSearch', facetId: 'related', clause: '', mode: 'and' }), undefined);
    assert.strictEqual(
      narrowSidebarNotesMessage({ type: 'refineActiveSearch', facetId: 'related', clause: 'x'.repeat(2001), mode: 'and' }),
      undefined,
    );
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'setActiveSearch', query: '#project/atlas' }), undefined);
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'setActiveSearch', query: 7 }), undefined);
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'openDashboard' }), { type: 'openDashboard' });
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'createDailyNote' }), { type: 'createDailyNote' });
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'openHelp' }), { type: 'openHelp' });
    // A page at the top of Context, by its id; the host opens only a page it lists.
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'goToPage', page: 'board', extra: 1 }), { type: 'goToPage', page: 'board' });
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'goToPage', page: 'Board!' }), undefined);
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'clearEntryRelatedNotes' }), { type: 'clearEntryRelatedNotes' });
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'setRelatedNotesSort', mode: 'access' }),
      { type: 'setRelatedNotesSort', mode: 'access' },
    );
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'setRelatedNotesSort', mode: 'random' }), undefined);
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'openSource', filePath: 'notes/a.md', line: 0 }), undefined);
  });

  test('keeps only the fields the host reads', () => {
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'openSource', filePath: 'notes/a.md', line: 3, beside: true, pin: false, extra: 1 }),
      { type: 'openSource', filePath: 'notes/a.md', line: 3, beside: true },
    );
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'ready', now: 1 }), { type: 'ready' });
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'openTaskBoard', query: '#a' }), { type: 'openTaskBoard' });
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'insertLink', filePath: 'notes/a.md', line: 2, beside: true }),
      { type: 'insertLink', filePath: 'notes/a.md', line: 2 },
    );
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'renameTag', tagKey: '#work', extra: 1 }), { type: 'renameTag', tagKey: '#work' });
  });

  test('opens from the sidebar toolbar', () => {
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'openTaskBoard' }), { type: 'openTaskBoard' });
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'openNotesGraph' }), { type: 'openNotesGraph' });
  });

  test('accepts the graph rows, and nothing malformed', () => {
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'activateNotesGraphNode', nodeId: 'task:related', open: false }),
      { type: 'activateNotesGraphNode', nodeId: 'task:related', open: false },
    );
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'hoverNotesGraphNode', nodeId: 'tag:#project/atlas' }),
      { type: 'hoverNotesGraphNode', nodeId: 'tag:#project/atlas' },
    );
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'hoverNotesGraphNode' }), { type: 'hoverNotesGraphNode' });
    for (const message of [
      { type: 'activateNotesGraphNode', nodeId: 'task:related', open: 'yes' },
      { type: 'activateNotesGraphNode', nodeId: '', open: true },
      { type: 'hoverNotesGraphNode', nodeId: '' },
      { type: 'hoverNotesGraphNode', nodeId: 7 },
    ]) {
      assert.strictEqual(narrowSidebarNotesMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('accepts park messages and nothing else like them', () => {
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'unparkTag', tagKey: '#a' }), { type: 'unparkTag', tagKey: '#a' });
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'parkTag', tagKey: '#a' }), { type: 'parkTag', tagKey: '#a' });
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'parkTag', tagKey: '#a', extra: 1 }), undefined);
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'unparkTag', tagKey: '' }), undefined);
  });

  test('asks for a suggested tag with the tag alone', () => {
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'addSuggestedTag', tagKey: '#risk/vendor' }),
      { type: 'addSuggestedTag', tagKey: '#risk/vendor' },
    );
    for (const message of [
      { type: 'addSuggestedTag', tagKey: '' },
      { type: 'addSuggestedTag', tagKey: 3 },
      { type: 'addSuggestedTag', tagKey: '#risk/vendor', extra: 1 },
    ]) {
      assert.strictEqual(narrowSidebarNotesMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('takes 0, 1, or 2 preview lines, a daily-notes choice, and nothing else', () => {
    [0, 1, 2].forEach((lines) =>
      assert.deepStrictEqual(
        narrowSidebarNotesMessage({ type: 'setRelatedNotesPreviewLines', lines }),
        { type: 'setRelatedNotesPreviewLines', lines },
      ),
    );
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'setRelatedNotesPreviewLines', lines: 3 }), undefined);
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'setRelatedNotesPreviewLines', lines: '1' }), undefined);
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'setHideDailyNotes', hide: true }), { type: 'setHideDailyNotes', hide: true });
    assert.strictEqual(narrowSidebarNotesMessage({ type: 'setHideDailyNotes', hide: 'yes' }), undefined);
  });

  test('accepts the links, mentions, and links search, and nothing malformed', () => {
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'linkMention', filePath: 'notes/a.md', line: 3, startColumn: 0, extra: 1 }),
      { type: 'linkMention', filePath: 'notes/a.md', line: 3, startColumn: 0 },
    );
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'linkAllMentions', extra: 1 }), { type: 'linkAllMentions' });
    assert.deepStrictEqual(narrowSidebarNotesMessage({ type: 'openLinksSearch', query: 'x' }), { type: 'openLinksSearch' });
    for (const message of [
      { type: 'linkMention', filePath: 'notes/a.md', line: 3, startColumn: -1 },
      { type: 'linkMention', filePath: 'notes/a.md', line: 3, startColumn: 1.5 },
      { type: 'linkMention', filePath: 'notes/a.md', line: 0, startColumn: 1 },
      { type: 'linkMention', filePath: 'notes/a.md', line: 3 },
      { type: 'insertLink', filePath: 'notes/a.md', line: 1.5 },
      { type: 'insertLink', filePath: 7, line: 1 },
      { type: 'insertLink', filePath: 'notes/a.md', line: 1, beside: 'yes' },
    ]) {
      assert.strictEqual(narrowSidebarNotesMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('accepts what the calendar\'s day asks, and nothing malformed', () => {
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'calendarDay', message: { type: 'openDay', date: '2026-09-24', extra: 1 } }),
      { type: 'calendarDay', message: { type: 'openDay', date: '2026-09-24' } },
    );
    assert.deepStrictEqual(
      narrowSidebarNotesMessage({ type: 'calendarDay', message: { type: 'toggleTask', taskId: 'a', completed: true } }),
      { type: 'calendarDay', message: { type: 'toggleTask', taskId: 'a', completed: true } },
    );
    for (const message of [
      { type: 'homeAddWidget', value: 'calendar' },
      { type: 'homeResetWidgets' },
      { type: 'calendarDay' },
      { type: 'calendarDay', message: { type: 'openDay', date: 'Thursday' } },
      { type: 'calendarDay', message: { type: 'selectDay', date: '2026-09-24', extra: 1 } },
      { type: 'calendarDay', message: 'openDay' },
    ]) {
      assert.strictEqual(narrowSidebarNotesMessage(message), undefined, JSON.stringify(message));
    }
  });

  test('refuses anything that is not a message it sends', () => {
    for (const message of [undefined, null, 'ready', 7, {}, { type: 7 }, { type: 'constructor' }, { type: 'toggleTask', taskId: 'a', completed: true }]) {
      assert.strictEqual(narrowSidebarNotesMessage(message), undefined, JSON.stringify(message));
    }
  });
});
