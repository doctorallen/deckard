import * as assert from 'assert';

import { OwnWrites, WriteHistory } from '../core/workspace/writeHistory';

/** A note Deckard saved itself is read back at once, and only once. */
suite('Own writes', () => {
  test('a noted save is taken once', () => {
    const ownWrites = new OwnWrites();
    ownWrites.note('file:///notes/a.md', 1000);
    assert.strictEqual(ownWrites.take('file:///notes/a.md', 1500), true);
    assert.strictEqual(ownWrites.take('file:///notes/a.md', 1600), false, 'a second save is the reader\'s');
  });

  test('a save nobody noted waits as before', () => {
    assert.strictEqual(new OwnWrites().take('file:///notes/b.md', 1000), false);
  });

  test('a note not taken within a few seconds expires', () => {
    const ownWrites = new OwnWrites();
    ownWrites.note('file:///notes/c.md', 1000);
    assert.strictEqual(ownWrites.take('file:///notes/c.md', 7000), false);
  });

  test('two histories do not share their own writes', () => {
    const first = new WriteHistory<{ notes: string[] }>();
    const second = new WriteHistory<{ notes: string[] }>();
    first.ownWrites.note('file:///notes/d.md', 1000);
    assert.strictEqual(second.ownWrites.take('file:///notes/d.md', 1000), false);
    assert.strictEqual(first.ownWrites.take('file:///notes/d.md', 1000), true);
  });
});

/** The last write, and whether a write's Undo is still the one to take. */
suite('Write history', () => {
  const write = (label: string, notes = ['a.md']): { label: string; notes: string[] } => ({ label, notes });

  test('keeps the last write, and only the last', () => {
    const history = new WriteHistory<{ label: string; notes: string[] }>();
    const before = history.lastWrite;
    history.remember(write('first'));
    history.remember(write('second'));
    assert.strictEqual(before, undefined);
    assert.strictEqual(history.lastWrite?.label, 'second');
  });

  test('a write that changed no note leaves nothing to take back', () => {
    const history = new WriteHistory<{ label: string; notes: string[] }>();
    history.remember(write('first'));
    history.remember(write('nothing', []));
    assert.strictEqual(history.lastWrite, undefined);
  });

  test('says when there comes to be, or stops being, a write to take back', () => {
    const history = new WriteHistory<{ label: string; notes: string[] }>();
    const heard: boolean[] = [];
    history.onDidChange((canUndo) => heard.push(canUndo));
    history.remember(write('first'));
    history.remember(write('second'));
    history.clear();
    history.clear();
    assert.deepStrictEqual(heard, [true, false]);
  });

  test('a mark holds until Deckard writes again', () => {
    const history = new WriteHistory<{ label: string; notes: string[] }>();
    history.remember(write('first'));
    const mine = history.mark();
    assert.strictEqual(mine.isLatest(), true);
    history.remember(write('second'));
    assert.strictEqual(mine.isLatest(), false);
  });

  test('a mark is stale once its write is taken back', () => {
    const history = new WriteHistory<{ label: string; notes: string[] }>();
    history.remember(write('first'));
    const mine = history.mark();
    history.clear();
    assert.strictEqual(mine.isLatest(), false);
  });

  test('the mark of a write that changed nothing holds while there is still nothing', () => {
    const history = new WriteHistory<{ label: string; notes: string[] }>();
    history.remember(write('nothing', []));
    const mine = history.mark();
    history.clear();
    assert.strictEqual(mine.isLatest(), true, 'nothing replaced nothing');
    history.remember(write('first'));
    assert.strictEqual(mine.isLatest(), false);
  });
});
