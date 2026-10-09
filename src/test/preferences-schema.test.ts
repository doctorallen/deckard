import * as assert from 'assert';

import {
  bumped,
  carryLegacyIds,
  filterNumericRecord,
  normalizePreferences,
  omitWorkspacePreferences,
  oneOf,
  pickWorkspacePreferences,
  toggled,
  upsertById,
  WORKSPACE_PREFERENCE_KEYS,
} from '../core/storage/preferencesSchema';

suite('Preferences schema', () => {
  test('oneOf keeps an allowed value and falls back on anything else', () => {
    const modes = ['rank', 'created', 'updated'] as const;
    assert.strictEqual(oneOf('created', modes, 'rank'), 'created');
    assert.strictEqual(oneOf('rank', modes, 'rank'), 'rank');
    for (const value of ['Created', ' created', '', undefined, null, 1, {}, ['created']]) {
      assert.strictEqual(oneOf(value, modes, 'rank'), 'rank', JSON.stringify(value));
    }
    assert.strictEqual(oneOf(2, [1, 2, 3, 4], 1), 2);
    assert.strictEqual(oneOf('2', [1, 2, 3, 4], 1), 1, 'a number stored as text is not the number');
  });

  test('upsertById replaces the entry with the same id in place, or adds at the end', () => {
    const list = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    assert.deepStrictEqual(upsertById(list, { id: 'a', name: 'A2' }), [
      { id: 'a', name: 'A2' },
      { id: 'b', name: 'B' },
    ]);
    assert.deepStrictEqual(upsertById(list, { id: 'c', name: 'C' }), [...list, { id: 'c', name: 'C' }]);
    assert.deepStrictEqual(list, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'the list is not changed');
  });

  test('toggled removes a held key and appends a missing one', () => {
    assert.deepStrictEqual(toggled(['#a', '#b', '#c'], '#b'), ['#a', '#c']);
    assert.deepStrictEqual(toggled(['#a', '#c'], '#b'), ['#a', '#c', '#b']);
    assert.deepStrictEqual(toggled([], '#a'), ['#a']);
  });

  test('bumped adds one to a count, starting a missing key at one, in place', () => {
    const counts = { '#a': 2, '#b': 0 };
    assert.deepStrictEqual(bumped(counts, '#b'), { '#a': 2, '#b': 1 });
    assert.deepStrictEqual(Object.keys(bumped(counts, '#a')), ['#a', '#b'], 'a kept key keeps its place');
    assert.deepStrictEqual(bumped(counts, '#c'), { '#a': 2, '#b': 0, '#c': 1 });
    assert.deepStrictEqual(counts, { '#a': 2, '#b': 0 });
  });

  test('filterNumericRecord keeps non-empty keys whose value the predicate accepts', () => {
    const values = { a: 1, b: -1, '': 5, c: 'x' };
    assert.deepStrictEqual(
      filterNumericRecord(values, (value) => typeof value === 'number' && value > 0),
      { a: 1 },
    );
    assert.deepStrictEqual(filterNumericRecord({}, () => true), {});
    assert.deepStrictEqual(filterNumericRecord([7, 8], () => true), { 0: 7, 1: 8 }, 'an array reads as a record');
  });

  test('the workspace keeps its twenty keys, and the machine-wide blob the rest', () => {
    const blob = normalizePreferences({ favoriteTags: ['#a'], tagSortMode: 'count', pinnedNotes: [{ filePath: 'a.md' }] });
    const share = pickWorkspacePreferences(blob);
    const rest = omitWorkspacePreferences(blob);
    assert.strictEqual(WORKSPACE_PREFERENCE_KEYS.length, 20);
    assert.deepStrictEqual(Object.keys(share), WORKSPACE_PREFERENCE_KEYS.filter((key) => blob[key] !== undefined));
    assert.ok(Object.keys(rest).every((key) => !(WORKSPACE_PREFERENCE_KEYS as readonly string[]).includes(key)));
    assert.deepStrictEqual({ ...rest, ...share }, { ...blob }, 'together they are the blob');
    assert.deepStrictEqual(pickWorkspacePreferences(undefined), {});
    assert.deepStrictEqual(omitWorkspacePreferences(undefined), {});
  });

  test('carryLegacyIds leaves a blob with no old ids as it is', () => {
    const kept = { taskOrder: ['task-a1-b2'], sectionAccessCounts: { 'section-c3-d4': 1 }, sectionAccessTimes: {} };
    assert.strictEqual(carryLegacyIds(kept, new Set(['task-a1-b2']), new Set(['section-c3-d4'])), kept);
    assert.strictEqual(carryLegacyIds(kept, new Set(), undefined), kept, 'a new-shape id that is gone is left to pruning');
  });

  test('carryLegacyIds renames an old id to the first entry that widened it, and a count under the new id wins', () => {
    const carried = carryLegacyIds(
      {
        taskOrder: ['task-a1', 'task-a1-b2', 'task-z9'],
        sectionAccessCounts: { 'section-c3': 4, 'section-c3-d4': 2 },
        sectionAccessTimes: { 'section-c3': 10 },
      },
      new Set(['task-a1-b2', 'task-a1-x7']),
      new Set(['section-c3-d4', 'section-c3-e5']),
    );
    assert.deepStrictEqual(carried, {
      taskOrder: ['task-a1-b2', 'task-z9'],
      sectionAccessCounts: { 'section-c3-d4': 2 },
      sectionAccessTimes: { 'section-c3-d4': 10 },
    });
  });
});
