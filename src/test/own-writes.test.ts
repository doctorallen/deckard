import * as assert from 'assert';

import { noteOwnWrite, takeOwnWrite } from '../core/workspace/ownWrites';

/** A note Deckard saved itself is read back at once, and only once. */
suite('Own writes', () => {
  test('a noted save is taken once', () => {
    noteOwnWrite('file:///notes/a.md', 1000);
    assert.strictEqual(takeOwnWrite('file:///notes/a.md', 1500), true);
    assert.strictEqual(takeOwnWrite('file:///notes/a.md', 1600), false, 'a second save is the reader\'s');
  });

  test('a save nobody noted waits as before', () => {
    assert.strictEqual(takeOwnWrite('file:///notes/b.md', 1000), false);
  });

  test('a note not taken within a few seconds expires', () => {
    noteOwnWrite('file:///notes/c.md', 1000);
    assert.strictEqual(takeOwnWrite('file:///notes/c.md', 7000), false);
  });
});
