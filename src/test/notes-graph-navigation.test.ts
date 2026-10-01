import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import type { IndexReader, IndexUpdates } from '../core/workspace/indexReader';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  PersistedPreferences,
  SidebarGraphContext,
  SidebarNotesSnapshot,
} from '../core/types';
import { createNotesGraphSnapshot } from '../ui/state/notesGraphState';
import { openingScope } from '../ui/webview/pages/notesGraph/notesGraphController';
import { SidebarNotesController, SidebarNotesPreferences } from '../ui/webview/pages/sidebarNotes/sidebarNotesController';

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
      SidebarNotesController.prototype,
    ) as SidebarNotesController;
    Object.assign(sidebar, {
      sidebar: {
        indexer: createIndexer(workspaceIndex),
        preferences: { reader: { value: defaultPreferences } } as SidebarNotesPreferences,
        activeSearch: { active: undefined },
      },
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
): IndexReader & IndexUpdates {
  return {
    onDidUpdate: () => ({ dispose: () => undefined }),
    getSnapshot: () => snapshot,
    getFilePath: () => 'notes/not-active.md',
    isNotesFile: () => true,
  } as unknown as IndexReader & IndexUpdates;
}
