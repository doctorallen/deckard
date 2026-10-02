import * as assert from 'assert';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService } from '../services/navigationService';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import {
  aroundNoteScope,
  NotesGraphController,
  NotesGraphControllerOptions,
} from '../ui/webview/pages/notesGraph/notesGraphController';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { captureTimingLog } from './timingLog';
import { REPOSITORY_ROOT } from './pageWebview';
import type { NotesGraphWireSnapshot, SidebarGraphContext } from '../ui/protocol/notesGraph';

/** A note with an entry, a plain line, a task, and a link; one that only links; one that does neither. */
const NOTES: Array<[string, string]> = [
  ['/notes/atlas.md', '# Atlas #project/relay\nSome words about [[linking]].\n- [ ] Call the vendor\n'],
  ['/notes/linking.md', 'See [[atlas]] for more.\n'],
  ['/notes/plain.md', 'Nothing to see here.\n'],
];

/** The index of `notes`, as a workspace of those files. */
function indexOf(notes: Array<[string, string]>): WorkspaceIndex {
  const files = notes.map(([filePath, text]) => parseMarkdown(filePath, text));
  return buildWorkspaceIndex(new Map(files.map((file) => [file.filePath, file])));
}

/**
 * The graph over `NOTES`, attached to a fake panel: what the page is sent,
 * and what Related Notes is told.
 */
function openGraph() {
  let index = indexOf(NOTES);
  const updates = new vscode.EventEmitter<void>();
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    getFilePath: () => 'notes/not-active.md',
    isNotesFile: () => true,
    onDidUpdate: (listener: () => void) => updates.event(listener),
  } as unknown as NotesGraphControllerOptions['indexer'];
  const contexts: Array<{ context: SidebarGraphContext | undefined; reveal: boolean | undefined }> = [];
  const controller = new NotesGraphController({
    indexer,
    onGraphContext: (context, reveal) => void contexts.push({ context, reveal }),
    navigation: new NavigationService(),
    extensionUri: vscode.Uri.file(REPOSITORY_ROOT),
  });
  const host = new WebviewHost(controller, { indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  host.attach(surface);
  const nodeOf = (kind: string, filePath?: string) => {
    const node = controller.buildSnapshot().nodes.find(
      (candidate) => candidate.kind === kind && (filePath === undefined || candidate.filePath === filePath),
    );
    assert.ok(node, `a ${kind} node`);
    return node;
  };
  return {
    host,
    controller,
    surface,
    contexts,
    nodeOf,
    send: (message: unknown) => surface.webview.send(message),
    states: () => surface.webview.postedOf<{ type: 'state'; data: NotesGraphWireSnapshot }>('state'),
    types: () => surface.webview.posted.map((message) => (message as { type: string }).type),
    updateIndex: (next: WorkspaceIndex) => {
      index = next;
      updates.fire();
    },
  };
}

/**
 * Runs `run` with commands and opened documents recorded rather than
 * done, and returns what was recorded, in order.
 */
async function record(run: () => Promise<void>): Promise<unknown[][]> {
  const commands = vscode.commands as unknown as Record<string, unknown>;
  const window = vscode.window as unknown as Record<string, unknown>;
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const originals = [commands.executeCommand, window.showTextDocument, workspace.openTextDocument];
  const calls: unknown[][] = [];
  commands.executeCommand = async (...call: unknown[]) => void calls.push(call);
  workspace.openTextDocument = async (uri: vscode.Uri) => ({ uri, lineCount: 40 });
  window.showTextDocument = async (document: { uri: vscode.Uri }, options: { preview: boolean; viewColumn?: number }) => {
    const editor = {
      document,
      selection: new vscode.Selection(0, 0, 0, 0),
      revealRange: () =>
        calls.push(['open', document.uri.fsPath, editor.selection.active.line + 1, options.preview, options.viewColumn === vscode.ViewColumn.Beside]),
    };
    return editor;
  };
  try {
    await run();
  } finally {
    [commands.executeCommand, window.showTextDocument, workspace.openTextDocument] = originals;
  }
  return calls;
}

suite('Notes graph host', () => {
  test('takes its turn as Notes Graph, and times the graph alone with every node it holds, as it always has', async () => {
    const { host, controller, send, states } = openGraph();
    try {
      assert.strictEqual(controller.name, 'Notes Graph');
      await send({ type: 'setGraphFilter', showNotes: true, showTasks: false });
      const lines = captureTimingLog(() => host.refresh());
      const { nodes, hiddenNodeCount = 0 } = states()[states().length - 1].data;
      assert.ok(hiddenNodeCount > 0, 'a kind is hidden');
      assert.deepStrictEqual(lines, [`Notes Graph: N ms (${nodes.length + hiddenNodeCount} nodes)`]);
    } finally {
      host.dispose();
    }
  });

  test('a selected node is sent back after each graph, and Related Notes lists what it is joined to', async () => {
    const { host, contexts, nodeOf, send, types } = openGraph();
    try {
      const note = nodeOf('note', '/notes/atlas.md');
      await send({ type: 'selectNode', nodeId: note.id });
      assert.deepStrictEqual(types(), ['selectNode']);
      assert.strictEqual(contexts.at(-1)?.reveal, true, 'a click on the graph shows Related Notes');
      assert.strictEqual(contexts.at(-1)?.context?.selectedNode?.id, note.id);
      assert.ok(contexts.at(-1)?.context?.connections.some((connection) => connection.node.kind === 'tag'));

      host.refresh();
      assert.deepStrictEqual(types(), ['selectNode', 'state', 'selectNode']);
      assert.strictEqual(contexts.at(-1)?.reveal, false, 'a redraw does not');
      assert.strictEqual(contexts.at(-1)?.context?.selectedNode?.id, note.id);

      await send({ type: 'clearSelection' });
      assert.deepStrictEqual(contexts.at(-1), { context: { selectedNode: undefined, connections: [] }, reveal: false });
      host.refresh();
      assert.deepStrictEqual(types(), ['selectNode', 'state', 'selectNode', 'state']);
    } finally {
      host.dispose();
    }
  });

  test('is not redrawn by a save that changes nothing it draws, and is by one that does', () => {
    const { host, states, updateIndex } = openGraph();
    try {
      host.refresh();
      assert.strictEqual(states().length, 1);

      updateIndex(indexOf([[NOTES[0][0], NOTES[0][1].replace('Some words', 'Some other words')], ...NOTES.slice(1)]));
      assert.strictEqual(states().length, 1, 'a prose-only save sends nothing');

      updateIndex(indexOf([[NOTES[0][0], NOTES[0][1].replace('#project/relay', '#project/relay #topic/maps')], ...NOTES.slice(1)]));
      assert.strictEqual(states().length, 2, 'a new tag redraws');
    } finally {
      host.dispose();
    }
  });

  test('a hidden graph is sent one graph when shown, and Related Notes hears from it only while it is in front', () => {
    const { host, surface, contexts, states, updateIndex } = openGraph();
    try {
      host.refresh();
      assert.strictEqual(contexts.length, 1, 'the graph in front says what it shows');

      surface.setVisible(false);
      assert.deepStrictEqual(contexts.at(-1), { context: undefined, reveal: undefined });
      updateIndex(indexOf(NOTES.slice(1)));
      assert.strictEqual(states().length, 1, 'nothing is sent while hidden');

      surface.setVisible(true);
      assert.strictEqual(states().length, 2);
      assert.ok(states()[1].data.nodes.every((node) => node.filePath !== '/notes/atlas.md'), 'with the newest index');
      assert.strictEqual(contexts.length, 4, 'once after the graph, and once for coming to the front');
    } finally {
      host.dispose();
    }
  });

  test('lets go of a selection the graph no longer holds, and of any when it is closed', async () => {
    const { host, surface, contexts, nodeOf, send, types, updateIndex } = openGraph();
    try {
      await send({ type: 'selectNode', nodeId: nodeOf('note', '/notes/atlas.md').id });
      updateIndex(indexOf(NOTES.slice(1)));
      assert.deepStrictEqual(types(), ['selectNode', 'state']);
      assert.strictEqual(contexts.at(-1)?.context?.selectedNode, undefined);

      await send({ type: 'selectNode', nodeId: nodeOf('note', '/notes/linking.md').id });
      surface.dispose();
      assert.deepStrictEqual(contexts.at(-1), { context: undefined, reveal: undefined });
      host.refresh();
      assert.deepStrictEqual(types(), ['selectNode', 'state', 'selectNode'], 'a closed graph is sent nothing');
    } finally {
      host.dispose();
    }
  });

  test('redraws for a change of kinds or scope, and not for kinds it already shows', async () => {
    const { host, controller, send, states } = openGraph();
    try {
      await send({ type: 'setGraphFilter', showNotes: true, showTasks: true });
      assert.strictEqual(states().length, 0);
      await send({ type: 'setGraphFilter', showNotes: true, showTasks: false });
      assert.strictEqual(states().length, 1);
      assert.ok(states()[0].data.nodes.every((node) => node.kind !== 'task'));
      assert.strictEqual(states()[0].data.hiddenNodeCount, 1);

      await send({ type: 'setGraphScope', local: true, depth: 9 });
      assert.strictEqual(states().length, 1, 'deeper than the graph draws is refused');
      await send({ type: 'setGraphScope', local: false, depth: 3, skipPeriodic: false });
      assert.strictEqual(states().length, 2);
      assert.deepStrictEqual(
        [states()[1].data.focus?.local, states()[1].data.focus?.depth, states()[1].data.focus?.skipPeriodic],
        [false, 3, false],
      );
      assert.strictEqual((controller as unknown as { scopeChosen: boolean }).scopeChosen, true);
    } finally {
      host.dispose();
    }
  });

  test('opens around one note from its menu without choosing a scope for later', () => {
    assert.deepStrictEqual(
      aroundNoteScope({ local: false, depth: 3, skipPeriodic: true }),
      { local: true, depth: 1, skipPeriodic: true },
    );
    const { host, controller, states } = openGraph();
    try {
      controller.aroundNote('/notes/atlas.md');
      host.refresh();
      const focus = states()[0].data.focus;
      assert.deepStrictEqual([focus?.filePath, focus?.local, focus?.depth], ['/notes/atlas.md', true, 1]);
      assert.strictEqual((controller as unknown as { scopeChosen: boolean }).scopeChosen, false);
    } finally {
      host.dispose();
    }
  });

  test('opens a line the graph draws as a node, and a tag by its exact key, and nothing else', async () => {
    const { host, send } = openGraph();
    try {
      const calls = await record(async () => {
        await send({ type: 'openSource', filePath: '/notes/atlas.md', line: 1 });
        await send({ type: 'openSource', filePath: '/notes/atlas.md', line: 3, beside: true, pin: true });
        await send({ type: 'openSource', filePath: '/notes/linking.md', line: 1 });
        await send({ type: 'openSource', filePath: '/notes/atlas.md', line: 2 });
        await send({ type: 'openSource', filePath: '/notes/plain.md', line: 1 });
        await send({ type: 'openSource', filePath: '/notes/missing.md', line: 1 });
        await send({ type: 'openTag', tagKey: '#project/relay' });
        await send({ type: 'openTag', tagKey: 'project/relay' });
        await send({ type: 'openTag', tagKey: '#gone' });
      });
      assert.deepStrictEqual(calls, [
        ['open', '/notes/atlas.md', 1, true, false],
        ['open', '/notes/atlas.md', 3, false, true],
        ['open', '/notes/linking.md', 1, true, false],
        ['deckard.showTagOverview', '#project/relay'],
      ]);
    } finally {
      host.dispose();
    }
  });

  test('from Related Notes, opens a node it holds, or selects it; and highlights one', async () => {
    const { host, controller, contexts, nodeOf, surface } = openGraph();
    try {
      const note = nodeOf('note', '/notes/atlas.md');
      const tag = nodeOf('tag');
      const calls = await record(async () => {
        await controller.activateNode(host, tag.id, true);
        await controller.activateNode(host, note.id, true);
        await controller.activateNode(host, 'note:/notes/missing.md', true);
      });
      assert.deepStrictEqual(calls, [
        ['deckard.showTagOverview', tag.id.slice(4)],
        ['open', '/notes/atlas.md', note.line, false, false],
      ]);

      await controller.activateNode(host, note.id, false);
      assert.deepStrictEqual(surface.webview.posted, [{ type: 'selectNode', nodeId: note.id }]);
      assert.strictEqual(contexts.at(-1)?.reveal, false);

      controller.highlightNode(host, tag.id);
      controller.highlightNode(host, 'tag:#gone');
      controller.highlightNode(host);
      assert.deepStrictEqual(surface.webview.posted.slice(1), [
        { type: 'highlightNode', nodeId: tag.id },
        { type: 'highlightNode' },
        { type: 'highlightNode' },
      ]);
    } finally {
      host.dispose();
    }
  });

  test('acts on nothing it does not accept', async () => {
    const { host, surface, contexts, send } = openGraph();
    try {
      const calls = await record(async () => {
        await send({ type: 'selectNode', nodeId: null });
        await send({ type: 'selectNode', nodeId: 'note:/notes/missing.md' });
        await send({ type: 'setGraphFilter', showNotes: true });
        await send({ type: 'toggleTask', taskId: 'a', completed: true });
        await send({ type: 'openTag', tagKey: '' });
      });
      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(surface.webview.posted, []);
      assert.deepStrictEqual(contexts, []);
    } finally {
      host.dispose();
    }
  });
});
