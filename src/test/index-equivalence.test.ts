import * as assert from 'assert';

import { ParsedFile } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { IndexState } from '../core/workspace/indexState';
import { createNotesGraphSnapshot } from '../ui/state/notesGraphState';
import { buildLegacyWorkspaceIndex } from './fixtures/legacyWorkspaceIndex';
import {
  developmentNotes,
  edgeCaseNotes,
  normalizeIndex,
  parseNotes,
  randomNotes,
  sampleNotes,
  toFileMap,
} from './indexCorpus';

/**
 * The index is a fold of each note's own contribution. These tests hold it
 * to the whole-workspace pass it replaced, exactly: every map in the same
 * order, every association with the same weight to the last bit.
 */
suite('Index equivalence', () => {
  const corpora: Array<[string, () => ParsedFile[]]> = [
    ['the sample workspace', () => parseNotes(sampleNotes())],
    ['the development notes', () => parseNotes(developmentNotes())],
    ['the edge cases', () => parseNotes(edgeCaseNotes())],
    ['random notes, seed 1', () => parseNotes(randomNotes(1, 80))],
    ['random notes, seed 7', () => parseNotes(randomNotes(7, 80))],
    ['random notes, seed 42', () => parseNotes(randomNotes(42, 150))],
    ['everything at once', () =>
      parseNotes([...sampleNotes(), ...edgeCaseNotes(), ...randomNotes(3, 60)])],
  ];

  corpora.forEach(([name, load]) => {
    test(`builds ${name} exactly as the whole-workspace pass did`, () => {
      const files = load();
      assert.ok(files.length > 0);
      const legacy = buildLegacyWorkspaceIndex(toFileMap(files));
      const folded = buildWorkspaceIndex(toFileMap(files));
      assert.ok((legacy.tagAssociations?.size ?? 0) > 0 || name === 'the development notes');
      assert.deepStrictEqual(normalizeIndex(folded), normalizeIndex(legacy));
      assert.deepStrictEqual(
        { ...createNotesGraphSnapshot(folded), updatedAt: 0 },
        { ...createNotesGraphSnapshot(legacy), updatedAt: 0 },
        'the Notes Graph is the same',
      );
    });
  });

  test('answers a tag it is asked about before, or without, reading them all', () => {
    const files = parseNotes([...edgeCaseNotes(), ...randomNotes(11, 60)]);
    const legacy = buildLegacyWorkspaceIndex(toFileMap(files));
    const folded = IndexState.build(files).snapshot();
    const keys = [...(legacy.tagAssociations?.keys() ?? [])];
    assert.ok(keys.length > 5);
    keys.slice(0, 5).forEach((key) =>
      assert.deepStrictEqual(
        normalizeIndex({ ...folded, tagAssociations: new Map([[key, folded.tagAssociations?.get(key) ?? []]]) }),
        normalizeIndex({ ...folded, tagAssociations: new Map([[key, legacy.tagAssociations?.get(key) ?? []]]) }),
        key,
      ),
    );
    assert.strictEqual(folded.tagAssociations?.get('#no/such-tag'), undefined);
    assert.strictEqual(folded.tagAssociations?.has(keys[0]), true);
    assert.strictEqual(folded.tagAssociations?.size, legacy.tagAssociations?.size);
  });
});
