import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex, WorkspaceIndexer } from '../core/workspace/indexer';
import { PreferencesStore } from '../core/storage/preferences';
import { DashboardMessage, PersistedPreferences } from '../core/types';
import { DashboardPanel } from '../ui/webview/dashboard';

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
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
};

suite('Dashboard navigation', () => {
  test('opens a project entity from its indexed Dashboard key', async () => {
    const parsed = parseMarkdown(
      'notes/metadata-only.md',
      '---\nprojects: [neon-relay]\n---\nA project note.',
    );
    const workspaceIndex = buildWorkspaceIndex(
      new Map([[parsed.filePath, parsed]]),
    );
    const index = {
      onDidUpdate: () => ({ dispose: () => undefined }),
      getSnapshot: () => workspaceIndex,
    } as unknown as WorkspaceIndexer;

    const preferences = {
      onDidChange: () => ({ dispose: () => undefined }),
      value: defaultPreferences,
    } as unknown as PreferencesStore;
    const opened: string[] = [];
    const dashboard = new DashboardPanel(
      index,
      preferences,
      vscode.Uri.file(process.cwd()),
      async (tagKey) => {
        opened.push(tagKey);
      },
    );

    try {
      const controller = dashboard as unknown as {
        handleValidMessage(message: DashboardMessage): Promise<void>;
      };
      await controller.handleValidMessage({
        type: 'openTag',
        tagKey: '#project/neon-relay',
      });

      assert.deepStrictEqual(opened, ['#project/neon-relay']);
    } finally {
      dashboard.dispose();
    }
  });
});
