import * as assert from 'assert';

import { Emitter } from '../core/emitter';
import { setTimingLog, TimingLog } from '../core/timing';
import { WorkspaceIndexer } from '../core/workspace/indexer';
import {
  onIndexUpdateInTurn,
  VIEW_PRIORITY,
} from '../core/workspace/publishing';
import { panelPriority, viewPriority } from '../ui/webview/panelPriority';
import { WorkspaceScanner } from '../core/workspace/scanner';
import { createFakeAccess, fakeFolder } from './fakeWorkspace';

/** An indexer over an empty folder whose view turns a test steps through. */
function createIndexer(): { indexer: WorkspaceIndexer; step: () => boolean; pending: () => number } {
  const turns: Array<() => void> = [];
  const workspaceFolder = fakeFolder('/tmp/deckard-publishing', 'w');
  const scanner = new WorkspaceScanner(createFakeAccess({
    workspaceFolders: [workspaceFolder],
    findFiles: async () => [],
    readFile: async () => new Uint8Array(),
  }));
  const indexer = new WorkspaceIndexer(scanner, undefined, {
    schedule: (run) => turns.push(run),
  });
  return {
    indexer,
    step: () => {
      const run = turns.shift();
      run?.();
      return run !== undefined;
    },
    pending: () => turns.length,
  };
}

suite('Publishing an index update to views', () => {
  test('runs plain listeners at once and each view in a turn of its own, the one in front first', async () => {
    const { indexer, step } = createIndexer();
    const ran: string[] = [];
    const priorities: Record<string, number> = {
      hidden: VIEW_PRIORITY.hidden,
      front: VIEW_PRIORITY.active,
      visible: VIEW_PRIORITY.visible,
      tidy: VIEW_PRIORITY.housekeeping,
    };
    for (const name of ['hidden', 'tidy', 'visible', 'front']) {
      indexer.onDidUpdateView(() => ran.push(name), {
        name,
        priority: () => priorities[name],
      });
    }
    indexer.onDidUpdate(() => ran.push('plain'));

    await indexer.refresh();
    assert.deepStrictEqual(ran, ['plain'], 'no view has run in the publishing turn');
    while (step()) {
      ran.push('|');
    }
    assert.deepStrictEqual(ran, ['plain', 'front', '|', 'visible', '|', 'hidden', '|', 'tidy', '|']);
    indexer.dispose();
  });

  test('a publish while views wait starts the order again, and each view still runs once', async () => {
    const { indexer, step } = createIndexer();
    const ran: string[] = [];
    let frontIsA = true;
    indexer.onDidUpdateView(() => ran.push('a'), { name: 'a', priority: () => (frontIsA ? 0 : 1) });
    indexer.onDidUpdateView(() => ran.push('b'), { name: 'b', priority: () => (frontIsA ? 1 : 0) });
    indexer.onDidUpdateView(() => ran.push('c'), { name: 'c', priority: () => 2 });

    await indexer.refresh();
    step();
    assert.deepStrictEqual(ran, ['a']);
    frontIsA = false;
    await indexer.refresh();
    while (step()) {
      // drain
    }
    assert.deepStrictEqual(ran, ['a', 'b', 'a', 'c'], 'the newer order, each view once');
    indexer.dispose();
  });

  test('never runs a view that was disposed while it waited, and a throwing view does not stop the rest', async () => {
    const { indexer, step } = createIndexer();
    const ran: string[] = [];
    const errors: string[] = [];
    const log: TimingLog = {
      logLevel: 3,
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      error: (message) => errors.push(message),
    };
    setTimingLog(log);
    try {
      indexer.onDidUpdateView(() => {
        throw new Error('boom');
      }, { name: 'broken view', priority: () => 0 });
      const gone = indexer.onDidUpdateView(() => ran.push('gone'), { name: 'gone', priority: () => 1 });
      indexer.onDidUpdateView(() => ran.push('kept'), { name: 'kept', priority: () => 2 });

      await indexer.refresh();
      gone.dispose();
      while (step()) {
        // drain
      }
      assert.deepStrictEqual(ran, ['kept']);
      assert.deepStrictEqual(errors, ['Could not refresh broken view: boom']);
    } finally {
      setTimingLog(undefined);
      indexer.dispose();
    }
  });

  test('stops redrawing once the indexer is disposed', async () => {
    const { indexer, step } = createIndexer();
    const ran: string[] = [];
    indexer.onDidUpdateView(() => ran.push('view'), { name: 'view', priority: () => 0 });
    await indexer.refresh();
    indexer.dispose();
    while (step()) {
      // drain
    }
    assert.deepStrictEqual(ran, []);
  });

  test('falls back to a plain listener on an index that cannot publish in turns', () => {
    const emitter = new Emitter<void>();
    let ran = 0;
    const subscription = onIndexUpdateInTurn(
      { onDidUpdate: emitter.event },
      { name: 'fake', priority: () => 0 },
      () => {
        ran += 1;
      },
    );
    emitter.fire();
    assert.strictEqual(ran, 1, 'ran in the same turn');
    subscription.dispose();
    emitter.fire();
    assert.strictEqual(ran, 1);
    emitter.dispose();
  });

  test('ranks a panel by whether it is in front or visible, and a side view by whether it is visible', () => {
    assert.strictEqual(panelPriority({ active: true, visible: true }), VIEW_PRIORITY.active);
    assert.strictEqual(panelPriority({ active: false, visible: true }), VIEW_PRIORITY.visible);
    assert.strictEqual(panelPriority({ active: false, visible: false }), VIEW_PRIORITY.hidden);
    assert.strictEqual(panelPriority(undefined), VIEW_PRIORITY.hidden);
    assert.strictEqual(viewPriority({ visible: true }), VIEW_PRIORITY.visible);
    assert.strictEqual(viewPriority(undefined), VIEW_PRIORITY.hidden);
  });
});
