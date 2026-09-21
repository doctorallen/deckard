import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex, WorkspaceIndexer } from '../core/workspace/indexer';
import {
  NotesGraphMessage,
  PersistedPreferences,
  SidebarGraphContext,
  SidebarNotesSnapshot,
} from '../core/types';
import { createNotesGraphSnapshot } from '../ui/state/notesGraphState';
import { NotesGraphPanel } from '../ui/webview/notesGraph';
import { SidebarNotesView } from '../ui/webview/sidebarNotes';

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
