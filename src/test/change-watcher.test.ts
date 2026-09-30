import * as assert from 'assert';

import { ChangeTarget, ChangeWatcher, QueuedChange } from '../core/workspace/changeWatcher';
import { OwnWrites } from '../core/workspace/writeHistory';
import type { ResourceUri } from '../ports/uri';
import { fakeFolder, FakeWorkspaceEvents, joinUri } from './fakeWorkspace';

/** A watcher over one folder whose target writes down each call, and the batches it is given. */
function createWatcher(isNote = (uri: ResourceUri) => uri.path.endsWith('.md')) {
  const folder = fakeFolder('/tmp/deckard-change-watcher', 'w');
  const calls: string[] = [];
  const batches: Array<ReadonlyArray<QueuedChange>> = [];
  let resolveBatch: () => void = () => undefined;
  const target: ChangeTarget = {
    forgetParkedRules: () => calls.push('forget parked rules'),
    republishParking: () => calls.push('republish parking'),
    rescan: () => calls.push('rescan'),
    applyQueued: async (changes) => {
      batches.push(changes);
      resolveBatch();
    },
  };
  const events = new FakeWorkspaceEvents();
  const ownWrites = new OwnWrites();
  const watcher = new ChangeWatcher(
    {
      isNotesFile: isNote,
      getPatterns: () => {
        calls.push('read patterns');
        return [{ folder, pattern: '**/*.md' }];
      },
    },
    target,
    events,
    ownWrites,
  );
  const nextBatch = () =>
    new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });
  return { folder, calls, batches, events, ownWrites, watcher, nextBatch };
}

suite('Carrying out what a change requires', () => {
  test('carries out a settings change in order: parking, watchers, then the rescan', () => {
    const { calls, events, watcher } = createWatcher();
    watcher.start();
    calls.length = 0;
    events.changeSettings('deckard.parked', 'deckard.notesFolder');
    assert.deepStrictEqual(calls, ['forget parked rules', 'republish parking', 'read patterns', 'rescan']);
    assert.deepStrictEqual(events.watchers.map((each) => each.disposed), [true, false]);
    watcher.dispose();
    assert.ok(events.watchers.every((each) => each.disposed), 'disposing stops watching');
  });

  test('keeps only the newest change for each file, and lets the batch go at once for a save of its own', async () => {
    const { folder, batches, events, ownWrites, watcher, nextBatch } = createWatcher();
    watcher.start();
    const note = joinUri(folder.uri, 'a.md');
    const other = joinUri(folder.uri, 'b.md');
    try {
      const batch = nextBatch();
      events.watchers[0].changed.fire(note);
      events.watchers[0].deleted.fire(other);
      events.watchers[0].created.fire(joinUri(folder.uri, 'template.txt'));
      ownWrites.note(note.toString());
      events.saves.fire({ uri: note });
      await batch;
      assert.deepStrictEqual(
        batches.map((changes) => changes.map((change) => [change.uri.path, change.deleted])),
        [[[note.path, false], [other.path, true]]],
      );
    } finally {
      watcher.dispose();
    }
  });

  test('takes an own write only for a note, so a save of another file leaves it waiting', () => {
    const { folder, events, ownWrites, watcher } = createWatcher(() => false);
    watcher.start();
    const uri = joinUri(folder.uri, 'a.md');
    ownWrites.note(uri.toString());
    events.saves.fire({ uri });
    watcher.dispose();
    assert.strictEqual(ownWrites.take(uri.toString()), true);
  });
});
