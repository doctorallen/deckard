import * as assert from 'assert';

import { createWorkspaceIndex } from '../core/workspace/indexer';
import { IndexService } from '../core/workspace/indexService';
import { WorkspaceScanner } from '../core/workspace/scanner';
import {
  createFakeAccess,
  fakeFolder,
  FakeSettings,
  FakeWorkspaceEvents,
  joinUri,
} from './fakeWorkspace';

/** A promise and the function that settles it, for holding a read until a test lets it go. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** Lets the reads already let go finish. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** The titles of the tasks the index holds, in order. */
function taskTitles(service: { getSnapshot(): { tasks: Map<string, { title: string }> } }): string[] {
  return [...service.getSnapshot().tasks.values()].map((task) => task.title);
}

suite('The index keeps the newest of what lands while it scans', () => {
  test('a save applied while a scan is reading is not undone when the scan finishes', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const plan = joinUri(folder.uri, 'plan.md');
    let disk = '# Plan\n- [ ] Old task\n';
    let held: ReturnType<typeof gate> | undefined;
    const access = createFakeAccess({
      workspaceFolders: [folder],
      findFiles: async () => [plan],
      readFile: async () => {
        // The text is what the file holds when the read starts.
        const text = disk;
        await held?.wait;
        return Buffer.from(text);
      },
    });
    const service = new IndexService(new WorkspaceScanner(access), undefined, {
      publish: () => undefined,
    });
    await service.start();

    held = gate();
    const rescan = service.refresh({ reuse: 'none' });
    await settle();
    const scanRead = held;
    held = undefined;
    disk = '# Plan\n- [ ] New task\n';
    await service.applyQueued([{ uri: plan, deleted: false }]);
    assert.deepStrictEqual(taskTitles(service), ['New task']);

    scanRead.open();
    await rescan;
    assert.deepStrictEqual(taskTitles(service), ['New task'], 'the scan keeps the save');
  });

  test('a note created and one deleted while a scan is reading stay as the changes left them', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const kept = joinUri(folder.uri, 'kept.md');
    const gone = joinUri(folder.uri, 'gone.md');
    const added = joinUri(folder.uri, 'added.md');
    const listed = [kept, gone];
    let held: ReturnType<typeof gate> | undefined;
    const access = createFakeAccess({
      workspaceFolders: [folder],
      findFiles: async () => {
        const found = [...listed];
        await held?.wait;
        return found;
      },
      readFile: async (uri) => Buffer.from(`# ${uri.path.split('/').pop()}`),
    });
    const service = new IndexService(new WorkspaceScanner(access), undefined, {
      publish: () => undefined,
    });
    await service.start();

    held = gate();
    const rescan = service.refresh({ reuse: 'none' });
    await settle();
    const scanList = held;
    held = undefined;
    listed.splice(1, 1, added);
    await service.applyQueued([
      { uri: gone, deleted: true },
      { uri: added, deleted: false },
    ]);
    scanList.open();
    await rescan;
    assert.deepStrictEqual([...service.getSnapshot().files.keys()].sort(), ['added.md', 'kept.md']);
  });

  test('an older batch that finishes reading last does not replace a newer one', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const plan = joinUri(folder.uri, 'plan.md');
    let disk = '# Plan\n- [ ] First\n';
    let held: ReturnType<typeof gate> | undefined;
    const access = createFakeAccess({
      workspaceFolders: [folder],
      findFiles: async () => [plan],
      readFile: async () => {
        const text = disk;
        await held?.wait;
        return Buffer.from(text);
      },
    });
    const service = new IndexService(new WorkspaceScanner(access), undefined, {
      publish: () => undefined,
    });
    await service.start();

    held = gate();
    disk = '# Plan\n- [ ] Second\n';
    const older = service.applyQueued([{ uri: plan, deleted: false }]);
    await settle();
    const olderRead = held;
    held = undefined;
    disk = '# Plan\n- [ ] Third\n';
    await service.applyQueued([{ uri: plan, deleted: false }]);
    olderRead.open();
    await older;
    assert.deepStrictEqual(taskTitles(service), ['Third']);
  });

  test('a batch begun before a scan and finished after it does not replace what the scan read', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const plan = joinUri(folder.uri, 'plan.md');
    let disk = '# Plan\n- [ ] First\n';
    let held: ReturnType<typeof gate> | undefined;
    const access = createFakeAccess({
      workspaceFolders: [folder],
      findFiles: async () => [plan],
      readFile: async () => {
        const text = disk;
        await held?.wait;
        return Buffer.from(text);
      },
    });
    const service = new IndexService(new WorkspaceScanner(access), undefined, {
      publish: () => undefined,
    });
    await service.start();

    held = gate();
    disk = '# Plan\n- [ ] Second\n';
    const batch = service.applyQueued([{ uri: plan, deleted: false }]);
    await settle();
    const batchRead = held;
    held = undefined;
    // Saved again; the scan begun now reads the newer note and lands first.
    disk = '# Plan\n- [ ] Third\n';
    await service.refresh({ reuse: 'none' });
    assert.deepStrictEqual(taskTitles(service), ['Third']);
    batchRead.open();
    await batch;
    assert.deepStrictEqual(taskTitles(service), ['Third'], 'the older read is dropped');
  });

  test("a batch begun before a scan keeps what an editor held, which is newer than the scan's read of the disk", async () => {
    const folder = fakeFolder('/ws', 'ws');
    const plan = joinUri(folder.uri, 'plan.md');
    const other = joinUri(folder.uri, 'other.md');
    let held: ReturnType<typeof gate> | undefined;
    const access = createFakeAccess({
      workspaceFolders: [folder],
      findFiles: async () => [plan, other],
      readFile: async (uri) => {
        const text = uri.path.endsWith('plan.md') ? '# Plan\n- [ ] Saved\n' : '# Other\n';
        await held?.wait;
        return Buffer.from(text);
      },
    });
    const service = new IndexService(new WorkspaceScanner(access), undefined, {
      publish: () => undefined,
    });
    await service.start();

    held = gate();
    // The batch reads the other note from disk first, then the plan as its editor holds it.
    const batch = service.applyQueued([
      { uri: other, deleted: false },
      { uri: plan, content: '# Plan\n- [ ] Typed\n', deleted: false },
    ]);
    await settle();
    const batchRead = held;
    held = undefined;
    await service.refresh({ reuse: 'none' });
    batchRead.open();
    await batch;
    assert.deepStrictEqual(taskTitles(service), ['Typed']);
  });

  test('a setting changed during a scan leaves the index under the new setting, and ready waits for it', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const keep = joinUri(folder.uri, 'keep.md');
    const archived = joinUri(folder.uri, 'archive', 'old.md');
    const settings = new FakeSettings();
    const firstListing = gate();
    let listings = 0;
    const scanner = new WorkspaceScanner(
      createFakeAccess({
        workspaceFolders: [folder],
        settings,
        // The first listing is slow, as in a large workspace; later ones are quick.
        findFiles: async () => {
          listings += 1;
          if (listings === 1) {
            await firstListing.wait;
          }
          return [keep, archived];
        },
        readFile: async (uri) => Buffer.from(uri === keep ? '# Keep' : '# Old'),
      }),
    );
    const events = new FakeWorkspaceEvents();
    const indexer = createWorkspaceIndex({ scanner, events, schedule: (run) => run() });
    const first = indexer.start();
    await settle();
    settings.set('deckard.exclude', { archive: true });
    events.changeSettings('deckard.exclude');
    const ready = indexer.ready;
    firstListing.open();
    await first;
    await ready;
    await settle();
    assert.deepStrictEqual([...indexer.getSnapshot().files.keys()], ['keep.md']);
    indexer.dispose();
  });

  test('a refresh a newer one supersedes waits for the newer one before it resolves', async () => {
    const folder = fakeFolder('/ws', 'ws');
    const note = joinUri(folder.uri, 'note.md');
    let disk = '# Note\n- [ ] Before\n';
    const holds: Array<ReturnType<typeof gate>> = [];
    const access = createFakeAccess({
      workspaceFolders: [folder],
      findFiles: async () => [note],
      readFile: async () => {
        const text = disk;
        const hold = gate();
        holds.push(hold);
        await hold.wait;
        return Buffer.from(text);
      },
    });
    const service = new IndexService(new WorkspaceScanner(access), undefined, {
      publish: () => undefined,
    });
    const older = service.refresh();
    await settle();
    disk = '# Note\n- [ ] After\n';
    const newer = service.refresh();
    await settle();
    let olderDone = false;
    void older.then(() => {
      olderDone = true;
    });
    holds[0].open();
    await settle();
    assert.strictEqual(olderDone, false, 'the superseded refresh waits for the newer one');
    holds[1].open();
    await Promise.all([older, newer]);
    assert.deepStrictEqual(taskTitles(service), ['After']);
  });
});
