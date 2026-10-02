import * as assert from 'assert';

import { findTagLookalikes, findTagMergeCandidates, isWithinDistance } from '../domain/ranking/tagHygiene';
import { TagInfo, WorkspaceIndex } from '../domain/model';

/** An index holding only the tags a pair is read from. */
function indexOfTags(counts: Record<string, number>): WorkspaceIndex {
  const tags = new Map<string, TagInfo>(
    Object.entries(counts).map(([label, count]) => [
      label.toLocaleLowerCase(),
      {
        key: label.toLocaleLowerCase(),
        label,
        count,
        sectionIds: [],
        taskIds: [],
        filePaths: [],
      } as unknown as TagInfo,
    ]),
  );
  return {
    files: new Map(),
    sections: new Map(),
    tasks: new Map(),
    tags,
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

/** Each pair as it reads: the rarer spelling, the kept tag, and why. */
function pairs(index: WorkspaceIndex, limit = 12): string[] {
  return findTagMergeCandidates(index, limit).candidates.map(
    (candidate) =>
      `${candidate.sourceLabel} -> ${candidate.targetLabel} (${candidate.reason})`,
  );
}

suite('Tag hygiene', () => {
  test('finds a tag typed twice, and points at the spelling in use', () => {
    assert.deepStrictEqual(
      pairs(
        indexOfTags({
          '#project/atlas': 42,
          '#project/atals': 1,
          '#risk/vendor': 9,
        }),
      ),
      ['#project/atals -> #project/atlas (spelling)'],
    );
  });

  test('reads one name written two ways', () => {
    assert.deepStrictEqual(
      pairs(
        indexOfTags({
          '@ren-kade': 3,
          '#person/ren-kade': 11,
          '#org/acme': 2,
          '#organization/acme': 6,
          '#vendor-risk': 4,
          '#vendorrisk': 1,
          '#topic/report': 8,
          '#topic/reports': 2,
        }),
      ),
      [
        '@ren-kade -> #person/ren-kade (marker)',
        '#org/acme -> #organization/acme (namespace)',
        '#vendorrisk -> #vendor-risk (separator)',
        '#topic/reports -> #topic/report (plural)',
      ],
    );
  });

  test('leaves tags that only share a namespace alone', () => {
    assert.deepStrictEqual(
      pairs(
        indexOfTags({
          '#project/atlas': 4,
          '#project/relay': 4,
          '#project/vendor-review': 2,
          '#risk/vendor': 2,
        }),
      ),
      [],
    );
  });

  test('counts a transposition as one edit, and bounds the rest', () => {
    assert.strictEqual(isWithinDistance('atlas', 'atals', 1), true);
    assert.strictEqual(isWithinDistance('atlas', 'atlss', 1), true);
    assert.strictEqual(isWithinDistance('atlas', 'atalss', 1), false);
    assert.strictEqual(isWithinDistance('argent-protocol', 'argant-protocal', 2), true);
    assert.strictEqual(isWithinDistance('argent', 'argent', 2), false, 'a tag is not its own twin');
    assert.strictEqual(isWithinDistance('a', 'abcd', 2), false);
  });

  test('ranks the clearest pairs first and says how many there are', () => {
    const found = findTagMergeCandidates(
      indexOfTags({
        '#project/atlas': 40,
        '#project/atlss': 1,
        '#project/relay': 30,
        '#project/relai': 6,
        '@sable-ortiz': 2,
        '#person/sable-ortiz': 20,
      }),
      2,
    );
    assert.strictEqual(found.total, 3);
    assert.deepStrictEqual(
      found.candidates.map((candidate) => candidate.sourceLabel),
      ['@sable-ortiz', '#project/atlss'],
    );
    assert.strictEqual(
      found.candidates[0].detail,
      'the same name written two ways, with 2 entries and 20 entries',
    );
  });

  test('a tag\'s own page names its other spellings, at most three', () => {
    const index = indexOfTags({
      '#project/atlas': 12,
      '#proj/atlas': 3,
      '#projects/atlas': 2,
      '#project/atlass': 1,
      '#atlas': 1,
      '#project/beta': 4,
    });
    const found = findTagLookalikes(index, '#project/atlas');
    assert.strictEqual(found.length, 3);
    assert.ok(found.every((other) => other.key !== '#project/atlas' && other.key !== '#project/beta'));
    const proj = findTagLookalikes(index, '#proj/atlas').find((other) => other.key === '#project/atlas');
    assert.deepStrictEqual(proj && [proj.count, proj.sourceKey, proj.targetKey], [12, '#proj/atlas', '#project/atlas']);
  });
});
