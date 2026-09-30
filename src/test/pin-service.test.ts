import * as assert from 'assert';

import { pinKey } from '../core/storage/preferencesSchema';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { PinnedNote } from '../domain/model';
import { PinService, PinStore } from '../services/pinService';

/** Pins in a list, told apart by key, recording each call. */
function store(): PinStore & { pins: PinnedNote[]; calls: string[] } {
  const pins: PinnedNote[] = [];
  const calls: string[] = [];
  return {
    pins,
    calls,
    isPinned: (key) => pins.some((pin) => pinKey(pin) === key),
    pinNote: async (pin) => {
      calls.push(`pin ${pin.heading ?? pin.filePath}`);
      pins.push(pin);
    },
    unpinNote: async (key) => {
      calls.push('unpin');
      pins.splice(pins.findIndex((pin) => pinKey(pin) === key), 1);
    },
  };
}

suite('PinService', () => {
  const index = buildWorkspaceIndex(
    new Map([['notes/Atlas.md', parseMarkdown('notes/Atlas.md', '---\ntags: [a]\n---\n# Atlas\n\n## Budget\n\nText.\n')]]),
  );

  test('a line pins the heading it sits under, and is pinned once it is', async () => {
    const pins = store();
    const service = new PinService({ index: { getSnapshot: () => index }, store: pins });

    assert.strictEqual(service.isLinePinned('notes/Atlas.md', 8), false);
    const pinned = await service.pin('notes/Atlas.md', 8);
    assert.deepStrictEqual(pinned, {
      kind: 'pinned',
      pin: { filePath: 'notes/Atlas.md', heading: 'Budget', headingLevel: 2, occurrence: 0 },
    });
    assert.strictEqual(service.isLinePinned('notes/Atlas.md', 8), true);
    assert.strictEqual(service.isLinePinned('notes/Atlas.md', 4), false, 'the heading above is another entry');
  });

  test('a line above every heading pins the note itself', () => {
    const service = new PinService({ index: { getSnapshot: () => index }, store: store() });
    assert.deepStrictEqual(service.pinFor('notes/Atlas.md', 1), { filePath: 'notes/Atlas.md' });
  });

  test('unpinning takes the line’s pin away by its key', async () => {
    const pins = store();
    const service = new PinService({ index: { getSnapshot: () => index }, store: pins });
    await service.pin('notes/Atlas.md', 8);

    assert.strictEqual((await service.unpin('notes/Atlas.md', 7)).kind, 'unpinned');
    assert.deepStrictEqual(pins.pins, []);
  });

  test('a note the index does not have is no entry, and nothing is asked of the store', async () => {
    const pins = store();
    const service = new PinService({ index: { getSnapshot: () => index }, store: pins });

    assert.deepStrictEqual(await service.pin('notes/Gone.md', 1), { kind: 'no-entry' });
    assert.deepStrictEqual(await service.unpin('notes/Gone.md', 1), { kind: 'no-entry' });
    assert.strictEqual(service.isLinePinned('notes/Gone.md', 1), false);
    assert.deepStrictEqual(pins.calls, []);
  });
});
