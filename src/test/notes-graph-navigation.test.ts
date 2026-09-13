import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { PreferencesStore } from '../core/storage/preferences';
import { buildWorkspaceIndex, WorkspaceIndexer } from '../core/workspace/indexer';
import {
  NotesGraphMessage,
  PersistedPreferences,
  SidebarNotesSnapshot,
} from '../core/types';
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
  dashboardNoteSortMode: 'alphabetical',
  dashboardViewState: {
    mode: 'tasks',
    taskFilter: 'active',
    selectedTaskTags: [],
    selectedNoteTags: [],
    taskSearchQuery: '',
    noteSearchQuery: '',
    tagSearchQuery: '',
    taskTagQuery: '',
    noteTagQuery: '',
  },
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [],
};

suite('Notes graph navigation', () => {
  test('forwards a valid graph source without entry-level tags', async () => {
    const parsed = parseMarkdown(
      'notes/source.md',
      '---\ntags: [project/atlas]\n---\n\n# Source',
    );
    const workspaceIndex = buildWorkspaceIndex(
      new Map([[parsed.filePath, parsed]]),
    );
    const indexer = createIndexer(workspaceIndex);
    const selected: Array<{ filePath: string; line: number }> = [];
    const posted: unknown[] = [];
    const graph = new NotesGraphPanel(
      indexer,
      vscode.Uri.file(process.cwd()),
      async (filePath, line) => {
        selected.push({ filePath, line });
        return [{ filePath: 'notes/related.md', line: 8 }];
      },
    );

    try {
      const controller = graph as unknown as {
        panel: {
          dispose(): void;
          webview: {
            postMessage(message: unknown): Promise<boolean>;
          };
        };
        handleValidMessage(message: NotesGraphMessage): Promise<void>;
      };
      controller.panel = {
        dispose: () => undefined,
        webview: {
          postMessage: async (message) => {
            posted.push(message);
            return true;
          },
        },
      };
      await controller.handleValidMessage({
        type: 'showConnections',
        filePath: parsed.filePath,
        line: parsed.sections[0].startLine,
      });

      assert.deepStrictEqual(selected, [
        { filePath: parsed.filePath, line: parsed.sections[0].startLine },
      ]);
      assert.deepStrictEqual(posted, [
        {
          type: 'relatedSources',
          source: {
            filePath: parsed.filePath,
            line: parsed.sections[0].startLine,
          },
          sources: [{ filePath: 'notes/related.md', line: 8 }],
        },
      ]);
    } finally {
      graph.dispose();
    }
  });

  test('renders manual graph context without the selected file being active', () => {
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
      tagOverview: {
        onDidChange: () => ({ dispose: () => undefined }),
        getActiveTagKey: () => undefined,
        getActiveTagFilterKeys: () => [],
      },
    });
    const controller = sidebar as unknown as {
      entryContext: {
        filePath: string;
        sourceLine: number;
        source: 'manual';
      };
      createSnapshot(): SidebarNotesSnapshot;
    };
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
  } as unknown as WorkspaceIndexer;
}
