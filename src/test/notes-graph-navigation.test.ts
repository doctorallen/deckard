import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { WorkspaceIndexer } from '../core/workspace/indexer';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import {
  NotesGraphMessage,
  PersistedPreferences,
  SidebarGraphContext,
  SidebarNotesSnapshot,
} from '../core/types';
import { createNotesGraphSnapshot } from '../ui/state/notesGraphState';
import { aroundNoteScope, NotesGraphPanel, openingScope } from '../ui/webview/notesGraph';
import { SidebarNotesView } from '../ui/webview/sidebarNotes';
import { ThemePreview } from '../ui/webview/themePreview';

const defaultPreferences: PersistedPreferences = {
  version: 1,
  favoriteTags: [],
  favoriteEntities: [],
  tagSortMode: 'alphabetical',
  entitySortMode: 'alphabetical',
  tagAccessOrder: [],
  tagAccessCounts: {},
  entityAccessOrder: [],
  entityAccessCounts: {},
  taskOrder: [],
  taskSortMode: 'rank',
  dashboardTaskColumns: 1,
  dashboardNoteColumns: 1,
  dashboardTagColumns: 2,
  dashboardViewState: {
    mode: 'home',
    tagSearchQuery: '',
  },
  taskBoardLayout: 'board',
  taskBoardGroup: 'status',
  renderMode: 'markdown',
  searchPreview: 'lines',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  searchPageSize: 30,
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [],
  dashboardWidgets: [],
};

suite('Notes graph navigation', () => {
  test('publishes direct graph connections for a selected node', async () => {
    const parsed = parseMarkdown(
      'notes/source.md',
      '---\ntags: [project/atlas]\n---\n\n# Source',
    );
    const workspaceIndex = buildWorkspaceIndex(
      new Map([[parsed.filePath, parsed]]),
    );
    const indexer = createIndexer(workspaceIndex);
    const snapshot = createNotesGraphSnapshot(workspaceIndex);
    const selectedNode = snapshot.nodes.find((node) => node.kind === 'note');
    assert.ok(selectedNode);
    const contexts: Array<{
      context: SidebarGraphContext | undefined;
      reveal: boolean | undefined;
    }> = [];
    const posted: unknown[] = [];
    const graph = new NotesGraphPanel(
      indexer,
      vscode.Uri.file(process.cwd()),
      async (context, reveal) => {
        contexts.push({ context, reveal });
      },
      new ThemePreview(),
    );

    try {
      const controller = graph as unknown as {
        panel: {
          active: boolean;
          dispose(): void;
          reveal(): void;
          webview: {
            postMessage(message: unknown): Promise<boolean>;
          };
        };
        handleValidMessage(message: NotesGraphMessage): Promise<void>;
      };
      controller.panel = {
        active: true,
        dispose: () => undefined,
        reveal: () => undefined,
        webview: {
          postMessage: async (message) => {
            posted.push(message);
            return true;
          },
        },
      };
      await controller.handleValidMessage({
        type: 'selectNode',
        nodeId: selectedNode.id,
      });

      assert.deepStrictEqual(posted, [
        { type: 'selectNode', nodeId: selectedNode.id },
      ]);
      assert.strictEqual(contexts.at(-1)?.reveal, true);
      assert.strictEqual(contexts.at(-1)?.context?.selectedNode?.id, selectedNode.id);
      assert.ok(
        contexts.at(-1)?.context?.connections.some(
          (connection) => connection.node.kind === 'tag',
        ),
      );
    } finally {
      graph.dispose();
    }
  });

  test('is not redrawn by a save that changes nothing it draws, and is by one that does', () => {
    const text = '# Atlas #project/atlas\n\nSome words about [[relay]].\n';
    const relay = parseMarkdown('notes/relay.md', '# Relay #project/atlas');
    const indexOf = (atlasText: string) => {
      const atlas = parseMarkdown('notes/atlas.md', atlasText);
      return buildWorkspaceIndex(new Map([[atlas.filePath, atlas], [relay.filePath, relay]]));
    };
    let current = indexOf(text);
    const listeners: Array<() => void> = [];
    const indexer = {
      onDidUpdate: (listener: () => void) => {
        listeners.push(listener);
        return { dispose: () => undefined };
      },
      getSnapshot: () => current,
      getFilePath: () => 'notes/not-active.md',
      isNotesFile: () => true,
    } as unknown as WorkspaceIndexer;
    const posted: Array<{ type: string }> = [];
    const graph = new NotesGraphPanel(indexer, vscode.Uri.file(process.cwd()), () => undefined, new ThemePreview());
    try {
      const controller = graph as unknown as { panel: unknown; refresh(): void };
      controller.panel = {
        active: false,
        visible: true,
        dispose: () => undefined,
        webview: {
          postMessage: async (message: { type: string }) => {
            posted.push(message);
            return true;
          },
        },
      };
      controller.refresh();
      const states = () => posted.filter((message) => message.type === 'state').length;
      assert.strictEqual(states(), 1);

      current = indexOf(text.replace('Some words', 'Some other words'));
      listeners.forEach((listener) => listener());
      assert.strictEqual(states(), 1, 'a prose-only save sends nothing');

      current = indexOf(text.replace('# Atlas #project/atlas', '# Atlas #project/atlas #topic/maps'));
      listeners.forEach((listener) => listener());
      assert.strictEqual(states(), 2, 'a new tag redraws');
    } finally {
      graph.dispose();
    }
  });

  test('opens around one note from its menu without choosing a scope for later', () => {
    assert.deepStrictEqual(
      aroundNoteScope({ local: false, depth: 3, skipPeriodic: true }),
      { local: true, depth: 1, skipPeriodic: true },
    );
    const graph = new NotesGraphPanel(
      createIndexer(buildWorkspaceIndex(new Map())),
      vscode.Uri.file(process.cwd()),
      () => undefined,
      new ThemePreview(),
    );
    try {
      const controller = graph as unknown as {
        scopeChosen: boolean;
        createPanel(): void;
        refresh(): void;
      };
      // No webview in this test: only the state showAround leaves behind.
      controller.createPanel = () => undefined;
      controller.refresh = () => undefined;
      void graph.showAround('notes/atlas.md');
      const state = graph as unknown as { scope: { local: boolean; depth: number }; focusPath: string };
      assert.strictEqual(state.focusPath, 'notes/atlas.md');
      assert.deepStrictEqual([state.scope.local, state.scope.depth], [true, 1]);
      assert.strictEqual(controller.scopeChosen, false);
    } finally {
      graph.dispose();
    }
  });

  test('opens around the note in the editor, until the reader chooses a scope', () => {
    const whole = { local: false, depth: 1 };
    assert.deepStrictEqual(openingScope('notes/atlas.md', false, whole), {
      local: true,
      depth: 1,
    });
    assert.deepStrictEqual(
      openingScope(undefined, false, whole),
      whole,
      'with no note open there is nothing to draw around',
    );
    assert.deepStrictEqual(
      openingScope('notes/atlas.md', true, whole),
      whole,
      'a scope the reader chose is kept',
    );
    assert.deepStrictEqual(
      openingScope('notes/atlas.md', true, { local: true, depth: 3 }),
      { local: true, depth: 3 },
      'including the depth they chose',
    );
  });

  test('uses graph context only while it is set, then restores notes', () => {
    const selected = parseMarkdown(
      'notes/selected.md',
      '---\ntags: [project/atlas]\n---\n\n# Selected',
    );
    const related = parseMarkdown(
      'notes/related.md',
      '---\ntags: [project/atlas]\n---\n\n# Related',
    );
    const workspaceIndex = buildWorkspaceIndex(
      new Map([
        [selected.filePath, selected],
        [related.filePath, related],
      ]),
    );
    const sidebar = Object.create(
      SidebarNotesView.prototype,
    ) as SidebarNotesView;
    Object.assign(sidebar, {
      indexer: createIndexer(workspaceIndex),
      preferences: { value: defaultPreferences } as PreferencesStore,
      activeSearch: { active: undefined },
    });
    const controller = sidebar as unknown as {
      graphContext: SidebarGraphContext | undefined;
      entryContext: {
        filePath: string;
        sourceLine: number;
        source: 'manual';
      };
      createSnapshot(): SidebarNotesSnapshot;
    };
    const graphSnapshot = createNotesGraphSnapshot(workspaceIndex);
    const selectedNode = graphSnapshot.nodes.find(
      (node) => node.filePath === selected.filePath && node.kind === 'note',
    );
    assert.ok(selectedNode);
    controller.graphContext = {
      selectedNode,
      connections: [],
    };

    const connectedSnapshot = controller.createSnapshot();

    assert.strictEqual(connectedSnapshot.state, 'graph');
    assert.strictEqual(connectedSnapshot.graph?.selectedNode?.id, selectedNode.id);

    controller.graphContext = undefined;
    controller.entryContext = {
      filePath: selected.filePath,
      sourceLine: selected.sections[0].startLine,
      source: 'manual',
    };

    const snapshot = controller.createSnapshot();

    assert.strictEqual(snapshot.activeFileName, 'selected.md');
    assert.ok(
      snapshot.notes.some((note) => note.filePath === related.filePath),
    );
  });
});

function createIndexer(
  snapshot: ReturnType<typeof buildWorkspaceIndex>,
): WorkspaceIndexer {
  return {
    onDidUpdate: () => ({ dispose: () => undefined }),
    getSnapshot: () => snapshot,
    getFilePath: () => 'notes/not-active.md',
    isNotesFile: () => true,
  } as unknown as WorkspaceIndexer;
}
