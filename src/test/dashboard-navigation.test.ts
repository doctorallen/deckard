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
  dashboardTaskColumns: 1,
  dashboardTagColumns: 2,
  renderMode: 'markdown',
  tagOverviewSortMode: 'alphabetical',
  tagOverviewLayout: 'tabs',
  relatedNotesSortMode: 'tags',
  sectionAccessCounts: {},
  savedFilters: [],
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

  test('reopens a saved three-tag filter using host-side preferences', async () => {
    const parsed = parseMarkdown(
      'notes/filter.md',
      '# Atlas #project/atlas #follow-up #urgent',
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
      value: {
        ...defaultPreferences,
        savedFilters: [
          {
            id: 'atlas-follow-up',
            name: 'Atlas follow-up',
            tagKeys: ['#follow-up', '#project/atlas', '#urgent'],
          },
        ],
      },
      removeSavedFilter: async () => undefined,
    } as unknown as PreferencesStore;
    const opened: Array<{ tagKey: string; filterTagKeys?: readonly string[] }> =
      [];
    const dashboard = new DashboardPanel(
      index,
      preferences,
      vscode.Uri.file(process.cwd()),
      async (tagKey, filterTagKeys) => {
        opened.push({ tagKey, filterTagKeys });
      },
    );

    try {
      const controller = dashboard as unknown as {
        handleValidMessage(message: DashboardMessage): Promise<void>;
      };
      await controller.handleValidMessage({
        type: 'openSavedFilter',
        filterId: 'atlas-follow-up',
      });

      assert.deepStrictEqual(opened, [
        {
          tagKey: '#follow-up',
          filterTagKeys: ['#project/atlas', '#urgent'],
        },
      ]);
    } finally {
      dashboard.dispose();
    }
  });

  test('persists independently selected Dashboard grid columns', async () => {
    const workspaceIndex = buildWorkspaceIndex(new Map());
    const index = {
      onDidUpdate: () => ({ dispose: () => undefined }),
      getSnapshot: () => workspaceIndex,
    } as unknown as WorkspaceIndexer;
    const columnUpdates: Array<{ section: 'tasks' | 'tags'; columns: 1 | 2 | 3 | 4 }> = [];
    const preferences = {
      onDidChange: () => ({ dispose: () => undefined }),
      value: defaultPreferences,
      setDashboardColumns: async (
        section: 'tasks' | 'tags',
        columns: 1 | 2 | 3 | 4,
      ) => {
        columnUpdates.push({ section, columns });
      },
    } as unknown as PreferencesStore;
    const dashboard = new DashboardPanel(
      index,
      preferences,
      vscode.Uri.file(process.cwd()),
      async () => undefined,
    );

    try {
      const controller = dashboard as unknown as {
        handleValidMessage(message: DashboardMessage): Promise<void>;
      };
      await controller.handleValidMessage({
        type: 'setDashboardColumns',
        section: 'tasks',
        columns: 3,
      });
      await controller.handleValidMessage({
        type: 'setDashboardColumns',
        section: 'tags',
        columns: 4,
      });

      assert.deepStrictEqual(columnUpdates, [
        { section: 'tasks', columns: 3 },
        { section: 'tags', columns: 4 },
      ]);
    } finally {
      dashboard.dispose();
    }
  });
});
