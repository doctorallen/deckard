import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { ParsedFile } from '../core/types';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createEntityKindMemo, IndexState, NoteChange } from '../domain/index/indexState';
import { getEntityKind } from '../domain/markdown/parser';
import { createNotesGraphSnapshot } from '../ui/state/notesGraphState';
import { buildLegacyWorkspaceIndex } from './fixtures/legacyWorkspaceIndex';
import {
  createRandom,
  developmentNotes,
  editNote,
  edgeCaseNotes,
  normalizeIndex,
  parseNotes,
  pick,
  randomNote,
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
  /**
   * The incremental index against a full build: random saves, new notes,
   * deletions, a note deleted and added back, in batches of one to five,
   * and after every batch the updated index must be the full build of the
   * same notes, strictly, map order included. Ten seeds of 400 operations.
   */
  const seeds = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
  seeds.forEach((seed) => {
    test(`an update equals a full build of the same notes, seed ${seed}`, () => {
      const random = createRandom(seed);
      const noteCount = 60;
      const texts = new Map(randomNotes(seed, noteCount));
      let clock = Date.UTC(2026, 8, 1);
      const parse = (filePath: string, text: string): ParsedFile => {
        clock += 1000 + Math.floor(random() * 5000);
        return parseMarkdown(filePath, text, { createdAt: clock - 86400000, updatedAt: clock });
      };
      const files = new Map([...texts].map(([filePath, text]) => [filePath, parse(filePath, text)]));
      const state = IndexState.build(files.values());
      state.snapshot();
      const log: string[] = [];
      let nextNote = noteCount;
      let operations = 0;

      while (operations < 400) {
        const batch: NoteChange[] = [];
        const size = random() < 0.7 ? 1 : 2 + Math.floor(random() * 4);
        for (let step = 0; step < size && operations < 400; step += 1, operations += 1) {
          const roll = random();
          const paths = [...files.keys()];
          if (roll < 0.7 && paths.length > 0) {
            const filePath = pick(random, paths);
            const text = editNote(random, texts.get(filePath) ?? '', nextNote);
            texts.set(filePath, text);
            const file = parse(filePath, text);
            files.set(filePath, file);
            batch.push({ filePath, file });
            log.push(`edit ${filePath}`);
          } else if (roll < 0.8 || paths.length < 5) {
            const filePath = `notes/n${nextNote}.md`;
            const text = randomNote(random, nextNote, nextNote + 1);
            nextNote += 1;
            texts.set(filePath, text);
            const file = parse(filePath, text);
            files.set(filePath, file);
            batch.push({ filePath, file });
            log.push(`add ${filePath}`);
          } else if (roll < 0.9) {
            const filePath = pick(random, paths);
            files.delete(filePath);
            texts.delete(filePath);
            batch.push({ filePath });
            log.push(`delete ${filePath}`);
          } else {
            // Deleted and added back: it goes to the end, as in a Map.
            const filePath = pick(random, paths);
            const text = editNote(random, texts.get(filePath) ?? '', nextNote);
            texts.set(filePath, text);
            const file = parse(filePath, text);
            files.delete(filePath);
            files.set(filePath, file);
            batch.push({ filePath }, { filePath, file });
            log.push(`delete and add ${filePath}`);
          }
        }
        state.apply(batch);
        // Sometimes several updates land before anyone reads the index.
        if (random() < 0.2 && operations < 400) {
          continue;
        }
        const updated = state.snapshot();
        const expected = buildWorkspaceIndex(new Map(files));
        try {
          assert.deepStrictEqual([...state.files.keys()], [...files.keys()], 'the notes, in order');
          assert.deepStrictEqual(normalizeIndex(updated), normalizeIndex(expected));
        } catch (error) {
          throw new Error(
            `Seed ${seed} diverged after operation ${operations}: ${log.slice(-12).join('; ')}\n${String(error)}`,
          );
        }
      }
      // And the direct pass agrees with both at the end.
      assert.deepStrictEqual(
        normalizeIndex(state.snapshot()),
        normalizeIndex(buildLegacyWorkspaceIndex(new Map(files))),
      );
    });
  });

  test('an index handed out earlier never changes under its holder', () => {
    const random = createRandom(99);
    const texts = new Map(randomNotes(99, 40));
    const files = new Map([...texts].map(([filePath, text]) => [filePath, parseMarkdown(filePath, text)]));
    const state = IndexState.build(files.values());
    const held = state.snapshot();
    // What the held index should read, from a build of the same notes.
    const expected = normalizeIndex(buildWorkspaceIndex(new Map(files)));
    for (let step = 0; step < 10; step += 1) {
      const filePath = pick(random, [...files.keys()]);
      const text = editNote(random, texts.get(filePath) ?? '', 40);
      texts.set(filePath, text);
      const file = parseMarkdown(filePath, text);
      files.set(filePath, file);
      state.apply([{ filePath, file }]);
      state.snapshot();
    }
    state.apply([{ filePath: [...files.keys()][0] }]);
    state.snapshot();
    // Its associations are ranked only now, after all of that.
    assert.deepStrictEqual(normalizeIndex(held), expected);
  });

  test('builds the direct way while two entries share an id, and folds again once they do not', () => {
    const files = parseNotes(edgeCaseNotes());
    const state = IndexState.build(files);
    state.snapshot();
    // Ids are hashed from path, line, and text, so a repeat takes a hash
    // collision; here one is made by hand.
    const deep = files.find((file) => file.filePath === 'deep.md');
    const body = files.find((file) => file.filePath === 'body-tags.md');
    assert.ok(deep && body);
    const clash: ParsedFile = structuredClone(body);
    clash.sections[1].id = deep.sections[1].id;
    clash.sections.forEach((section) => {
      if (section.parentSectionId === body.sections[1].id) {
        section.parentSectionId = deep.sections[1].id;
      }
    });
    state.apply([{ filePath: clash.filePath, file: clash }]);
    const withClash = files.map((file) => (file.filePath === clash.filePath ? clash : file));
    assert.deepStrictEqual(
      normalizeIndex(state.snapshot()),
      normalizeIndex(buildLegacyWorkspaceIndex(toFileMap(withClash))),
      'the direct pass, as it always was',
    );
    assert.deepStrictEqual(
      normalizeIndex(state.snapshot()),
      normalizeIndex(buildWorkspaceIndex(toFileMap(withClash))),
    );

    state.apply([{ filePath: body.filePath, file: body }]);
    assert.deepStrictEqual(
      normalizeIndex(state.snapshot()),
      normalizeIndex(buildLegacyWorkspaceIndex(toFileMap(files))),
      'and the fold again once the repeat is gone',
    );
  });

  test('the entity-kind memo answers as getEntityKind does, spelling by spelling', () => {
    const kindOf = createEntityKindMemo();
    const spellings: Array<[string, string]> = [
      ['#project/atlas', '#project/atlas'],
      ['#project/atlas', '#Project/Atlas'],
      ['@dana', '@dana'],
      ['#plain', '#plain'],
    ];
    for (const [key, label] of spellings) {
      assert.deepStrictEqual(kindOf(key, label), getEntityKind({ key, label }), `${key} as ${label}`);
      assert.deepStrictEqual(kindOf(key, label), getEntityKind({ key, label }), 'and again, from the memo');
    }
  });
});
