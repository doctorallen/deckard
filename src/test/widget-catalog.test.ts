import * as assert from 'assert';

import { isWidgetKind, WIDGET_KINDS } from '../domain/dashboard/widgetCatalog';
import { formatKeyWords, readTagNamespace } from '../domain/markdown/tagKeys';

/**
 * Home's widget catalog and the tag-key reader, each read by both sides: the
 * host keeps a stored widget by the catalog and the page offers and draws
 * one by it, and the parser and the Tags tab read a key's namespace alike.
 */
suite('Widget catalog', () => {
  test('lists every kind, in the order + Add widget offers them', () => {
    assert.deepStrictEqual(Object.keys(WIDGET_KINDS), [
      'search', 'tasks', 'agenda', 'favoriteTags', 'topTags', 'savedSearches', 'recentSearches', 'recentNotes',
      'stats', 'savedQuery', 'todayNote', 'quickAdd', 'staleTasks', 'relatedNotes', 'tagPairs', 'unhubbedTags',
      'newTags', 'quietPeople', 'pinnedNotes', 'tryNext',
    ]);
  });

  test('says what the host keeps of each kind: one or many, listed, and paged', () => {
    const traits = Object.fromEntries(
      Object.entries(WIDGET_KINDS).map(([kind, entry]) => [kind, [entry.repeatable, entry.listed, entry.pageable !== false]]),
    );
    const repeatable = Object.keys(traits).filter((kind) => traits[kind][0]);
    const unlisted = Object.keys(traits).filter((kind) => !traits[kind][1]);
    const unpaged = Object.keys(traits).filter((kind) => traits[kind][1] && !traits[kind][2]);
    assert.deepStrictEqual(repeatable, ['tasks', 'savedQuery']);
    assert.deepStrictEqual(unlisted, ['search', 'savedSearches', 'stats', 'quickAdd', 'tryNext']);
    assert.deepStrictEqual(unpaged, ['agenda', 'savedQuery']);
  });

  test('a widget that looks back starts at its default, among the spans it offers', () => {
    const lookingBack = Object.entries(WIDGET_KINDS)
      .filter(([, entry]) => entry.defaultDays !== undefined)
      .map(([kind, entry]) => [kind, entry.defaultDays, (entry.days ?? []).map(([days]) => days)]);
    assert.deepStrictEqual(lookingBack, [
      ['staleTasks', 30, [7, 14, 30, 90]],
      ['newTags', 14, [7, 14, 30, 90]],
      ['quietPeople', 90, [30, 60, 90, 180]],
    ]);
  });

  test('knows a kind by its name, and nothing else', () => {
    assert.strictEqual(isWidgetKind('quietPeople'), true);
    for (const value of ['', 'Search', 'toString', 'hasOwnProperty', 7, undefined, null]) {
      assert.strictEqual(isWidgetKind(value), false, String(value));
    }
  });
});

suite('Tag keys', () => {
  test('a namespace is what a #namespace/name key is written under', () => {
    assert.strictEqual(readTagNamespace('#project/atlas'), 'project');
    assert.strictEqual(readTagNamespace('#Project/atlas'), 'Project', 'as written');
    assert.strictEqual(readTagNamespace('#a/b/c'), 'a');
    assert.strictEqual(readTagNamespace('#a/'), 'a');
  });

  test('a person, a plain tag, and the reserved tag-at have none', () => {
    for (const key of ['@sable', '#follow-up', '#/atlas', '', 'project/atlas', '#tag-at/sable', '#TAG-AT/sable']) {
      assert.strictEqual(readTagNamespace(key), undefined, key);
    }
  });

  test('words a key as a title', () => {
    assert.strictEqual(formatKeyWords('follow-up'), 'Follow Up');
    assert.strictEqual(formatKeyWords('road_map__q3'), 'Road Map Q3');
    assert.strictEqual(formatKeyWords('Atlas'), 'Atlas');
  });
});
