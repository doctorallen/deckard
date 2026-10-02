import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { TagInfo, WorkspaceIndex } from '../domain/model';
import {
  TagFileEdits,
  TagNotes,
  TagRewriteResult,
  TagService,
  TagWriteDescription,
  TagWriteOutcome,
} from '../services/tagService';

// TagService decides what a rename or merge does to the notes; these run it
// against an index built from plain text and notes held in memory, so every
// outcome is a value to assert without VS Code.

/** An index of the notes, by path, as the scanner would build it. */
function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)]),
    ),
  );
}

/** The indexed tag with this key, which the test expects to exist. */
function tagOf(index: WorkspaceIndex, key: string): TagInfo {
  const tag = index.tags.get(key);
  assert.ok(tag, `${key} is indexed`);
  return tag;
}

/**
 * Notes in memory: their text now, which a test can change after indexing
 * to make one stale, and every write asked of them.
 */
class FakeNotes implements TagNotes<string> {
  public readonly texts: Map<string, string>;
  public readonly writes: { files: readonly TagFileEdits[]; description: TagWriteDescription }[] = [];
  public readonly read: string[] = [];
  /** What the next write reports; by default it lands and changes each note. */
  public outcome: (files: readonly TagFileEdits[]) => TagWriteOutcome<string> = (files) => ({
    applied: true,
    notes: files.length,
    handle: 'handle',
  });
  /** The notes whose file cannot be found, which reading rejects. */
  public missing = new Set<string>();

  public constructor(notes: Record<string, string>) {
    this.texts = new Map(Object.entries(notes));
  }

  public optionsFor(): Promise<{ personMarker: string }> {
    return Promise.resolve({ personMarker: '@' });
  }

  public contentOf(filePath: string): Promise<string> {
    this.read.push(filePath);
    return this.missing.has(filePath)
      ? Promise.reject(new Error(`no file for ${filePath}`))
      : Promise.resolve(this.texts.get(filePath) ?? '');
  }

  public write(files: readonly TagFileEdits[], description: TagWriteDescription): Promise<TagWriteOutcome<string>> {
    this.writes.push({ files, description });
    return Promise.resolve(this.outcome(files));
  }
}

/** A service over an index that counts its refreshes, and preferences that record each key they move. */
function serviceWith(options: { refresh?: () => Promise<void> } = {}) {
  const moved: [string, string][] = [];
  let refreshes = 0;
  const service = new TagService({
    index: {
      refresh: () => {
        refreshes += 1;
        return options.refresh?.() ?? Promise.resolve();
      },
    },
    preferences: {
      replaceTagKey: (sourceKey, targetKey) => {
        moved.push([sourceKey, targetKey]);
        return Promise.resolve();
      },
    },
  });
  return { service, moved, refreshes: () => refreshes };
}

/** The outcome, once any merge it waits on is confirmed. */
async function confirmed<Handle>(result: TagRewriteResult<Handle>) {
  return result.kind === 'confirm-merge' ? result.merge() : result;
}

const notes = {
  'notes/a.md': '# Alpha #apollo\n\nText.\n',
  'notes/b.md': '# Beta #apollo #atlas\n',
  'notes/c.md': '# Gamma\n',
};

suite('TagService', () => {
  test('renames a tag in every note that has it, and carries the preferences over', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    const { service, moved, refreshes } = serviceWith();

    const result = await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#hermes', label: '#hermes' },
      notes: fake,
    });

    assert.deepStrictEqual(result, { kind: 'written', merge: false, notes: 2, handle: 'handle' });
    assert.deepStrictEqual(
      fake.writes[0].files.map((file) => file.filePath),
      ['notes/a.md', 'notes/b.md'],
    );
    assert.deepStrictEqual(fake.read, ['notes/a.md', 'notes/b.md'], 'only the notes it changes are read');
    assert.strictEqual(fake.writes[0].description.merge, false);
    assert.deepStrictEqual(moved, [['#apollo', '#hermes']]);
    assert.strictEqual(refreshes(), 1);
  });

  test('an Undo puts the preferences back and reads the notes again', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    const { service, moved, refreshes } = serviceWith();
    await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#hermes', label: '#hermes' },
      notes: fake,
    });

    await fake.writes[0].description.restore();

    assert.deepStrictEqual(moved, [['#apollo', '#hermes'], ['#hermes', '#apollo']]);
    assert.strictEqual(refreshes(), 2);
  });

  test('refuses a new name that is the old tag however it is typed', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    const { service } = serviceWith();
    for (const key of ['#apollo', '#Apollo']) {
      assert.deepStrictEqual(
        await service.rewrite({ index, source: tagOf(index, '#apollo'), replacement: { key, label: key }, notes: fake }),
        { kind: 'refused', reason: 'same' },
      );
    }
    assert.strictEqual(fake.writes.length, 0);
  });

  test('asks before merging into a tag that exists, and writes nothing until asked', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    const { service, moved } = serviceWith();

    const result = await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#atlas', label: '#atlas' },
      notes: fake,
    });

    assert.strictEqual(result.kind, 'confirm-merge');
    assert.strictEqual(result.kind === 'confirm-merge' && result.summary.mergedCount, 2);
    assert.strictEqual(fake.writes.length, 0);
    assert.strictEqual(fake.read.length, 0);

    const merged = await confirmed(result);
    assert.deepStrictEqual(merged, { kind: 'written', merge: true, notes: 2, handle: 'handle' });
    assert.strictEqual(fake.writes[0].description.merge, true);
    assert.deepStrictEqual(moved, [['#apollo', '#atlas']]);
    // A note already holding #atlas loses #apollo rather than holding two.
    const b = fake.writes[0].files.find((file) => file.filePath === 'notes/b.md');
    assert.deepStrictEqual(b?.edits, [{ start: 7, end: 15, text: '' }]);
  });

  test('stops at the first note that changed since it was indexed', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes({ ...notes, 'notes/a.md': '# Alpha #apollo\n\nEdited.\n' });
    const { service, moved } = serviceWith();

    const result = await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#hermes', label: '#hermes' },
      notes: fake,
    });

    assert.deepStrictEqual(result, { kind: 'stale', filePath: 'notes/a.md' });
    assert.deepStrictEqual(fake.read, ['notes/a.md']);
    assert.strictEqual(fake.writes.length, 0);
    assert.deepStrictEqual(moved, []);
  });

  test('finds nothing to write when no note holds the tag', async () => {
    const index = indexOf(notes);
    const { service } = serviceWith();
    const ghost: TagInfo = { ...tagOf(index, '#apollo'), key: '#ghost', label: '#ghost' };

    assert.deepStrictEqual(
      await service.rewrite({ index, source: ghost, replacement: { key: '#hermes', label: '#hermes' }, notes: new FakeNotes(notes) }),
      { kind: 'not-found' },
    );
  });

  test('says which notes VS Code refused, and moves no preference', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    fake.outcome = () => ({ applied: false });
    const { service, moved, refreshes } = serviceWith();

    const result = await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#hermes', label: '#hermes' },
      notes: fake,
    });

    assert.deepStrictEqual(result, { kind: 'rejected', filePaths: ['notes/a.md', 'notes/b.md'] });
    assert.deepStrictEqual(moved, []);
    assert.strictEqual(refreshes(), 0);
  });

  test('reports a write that changed no note, as when every change is left out of the preview', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    fake.outcome = () => ({ applied: true, notes: 0, handle: 'handle' });
    const { service, moved } = serviceWith();

    assert.deepStrictEqual(
      await service.rewrite({ index, source: tagOf(index, '#apollo'), replacement: { key: '#hermes', label: '#hermes' }, notes: fake }),
      { kind: 'unchanged' },
    );
    assert.deepStrictEqual(moved, []);
  });

  test('still reports the write when the notes cannot be read again', async () => {
    const index = indexOf(notes);
    const failure = new Error('index busy');
    const { service } = serviceWith({ refresh: () => Promise.reject(failure) });

    const result = await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#hermes', label: '#hermes' },
      notes: new FakeNotes(notes),
    });

    assert.deepStrictEqual(result, {
      kind: 'written',
      merge: false,
      notes: 2,
      handle: 'handle',
      refreshFailure: { error: failure },
    });
  });

  test('a note the rename does not change is never read, so one that cannot be found does not stop it', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    fake.missing.add('notes/c.md');
    const { service } = serviceWith();

    const result = await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#hermes', label: '#hermes' },
      notes: fake,
    });

    assert.deepStrictEqual(result, { kind: 'written', merge: false, notes: 2, handle: 'handle' });
    assert.deepStrictEqual(fake.read, ['notes/a.md', 'notes/b.md']);
  });

  test('stops, writing nothing, at a note it changes that cannot be found or opened', async () => {
    const index = indexOf(notes);
    const fake = new FakeNotes(notes);
    fake.missing.add('notes/b.md');
    const { service, moved } = serviceWith();

    const result = await service.rewrite({
      index,
      source: tagOf(index, '#apollo'),
      replacement: { key: '#hermes', label: '#hermes' },
      notes: fake,
    });

    assert.strictEqual(result.kind, 'unopened');
    assert.strictEqual(result.kind === 'unopened' && result.filePath, 'notes/b.md');
    assert.match(String(result.kind === 'unopened' && result.error), /no file for notes\/b\.md/);
    assert.strictEqual(fake.writes.length, 0);
    assert.deepStrictEqual(moved, []);
  });
});
