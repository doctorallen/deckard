import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex, WorkspaceIndexer } from '../core/workspace/indexer';
import { PreferencesStore } from '../core/storage/preferences';
import { DashboardMessage, PersistedPreferences } from '../core/types';
import { DashboardNavigation, DashboardPanel } from '../ui/webview/dashboard';

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

/** Records where the Dashboard sends the reader. */
function createNavigation(): DashboardNavigation & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    openTag: async (tagKey) => {
      opened.push(`tag ${tagKey}`);
    },
    openSearch: async (query) => {
      opened.push(`search ${query}`);
    },
    openTaskBoard: async (query) => {
      opened.push(`board ${query ?? ''}`);
    },
    openDailyNote: async () => {
      opened.push('today');
    },
    quickAdd: async (text) => {
      opened.push(`add ${text}`);
      return true;
    },
    createHubNote: async (tagKey) => {
      opened.push(`hub ${tagKey}`);
    },
  };
}

function createIndexer(files: Parameters<typeof parseMarkdown>[] = []) {
  const parsed = files.map((args) => parseMarkdown(...args));
  const workspaceIndex = buildWorkspaceIndex(
    new Map(parsed.map((file) => [file.filePath, file])),
  );
  return {
    onDidUpdate: () => ({ dispose: () => undefined }),
    getSnapshot: () => workspaceIndex,
    ready: Promise.resolve(),
  } as unknown as WorkspaceIndexer;
}

type Controller = {
  handleValidMessage(message: DashboardMessage): Promise<void>;
};

suite('Dashboard navigation', () => {
  test('opens a project entity from its indexed Dashboard key', async () => {
    const index = createIndexer([
      ['notes/metadata-only.md', '---\nprojects: [neon-relay]\n---\nA project note.'],
    ]);
    const preferences = {
      onDidChange: () => ({ dispose: () => undefined }),
      value: defaultPreferences,
    } as unknown as PreferencesStore;
    const navigation = createNavigation();
    const dashboard = new DashboardPanel(
      index,
      preferences,
      vscode.Uri.file(process.cwd()),
      navigation,
    );

    try {
      await (dashboard as unknown as Controller).handleValidMessage({
        type: 'openTag',
        tagKey: '#project/neon-relay',
      });
      assert.deepStrictEqual(navigation.opened, ['tag #project/neon-relay']);
    } finally {
      dashboard.dispose();
    }
  });

  test('opens saved views on search pages, a tag set as its tags joined by AND', async () => {
    const index = createIndexer([
      ['notes/filter.md', '# Atlas #project/atlas #follow-up #urgent'],
    ]);
    const preferences = {
      onDidChange: () => ({ dispose: () => undefined }),
      value: {
        ...defaultPreferences,
        savedFilters: [
          {
            id: 'atlas-follow-up',
            name: 'Atlas follow-up',
            tagKeys: ['#follow-up', '#project/atlas', '#urgent', '#gone'],
          },
          { id: 'open-atlas', name: 'Open Atlas', tagKeys: [], query: '#project/atlas is:open' },
        ],
      },
    } as unknown as PreferencesStore;
    const navigation = createNavigation();
    const dashboard = new DashboardPanel(
      index,
      preferences,
      vscode.Uri.file(process.cwd()),
      navigation,
    );

    try {
      await (dashboard as unknown as Controller).handleValidMessage({
        type: 'openSavedFilter',
        filterId: 'atlas-follow-up',
      });
      await dashboard.openSavedFilter('open-atlas');
      assert.deepStrictEqual(navigation.opened, [
        'search #follow-up AND #project/atlas AND #urgent',
        'search #project/atlas is:open',
      ]);
    } finally {
      dashboard.dispose();
    }
  });

  test('sends Home\'s links to search pages, the Task Board, and back to itself', async () => {
    const calls: string[] = [];
    const preferences = {
      onDidChange: () => ({ dispose: () => undefined }),
      value: {
        ...defaultPreferences,
        savedFilters: [{ id: 'kept', name: 'Kept', tagKeys: [], query: 'is:open' }],
      },
      recordRecentQuery: async (query: string) => {
        calls.push(`recent ${query}`);
      },
      setDashboardWidgets: async (widgets: Array<{ id: string }>) => {
        calls.push(`widgets ${widgets.map((widget) => widget.id).join(',')}`);
      },
      resetDashboardWidgets: async () => {
        calls.push('reset');
      },
    } as unknown as PreferencesStore;
    const navigation = createNavigation();
    const dashboard = new DashboardPanel(
      createIndexer(),
      preferences,
      vscode.Uri.file(process.cwd()),
      navigation,
    );

    try {
      const controller = dashboard as unknown as Controller;
      await controller.handleValidMessage({ type: 'openSearch', query: ' #project/atlas ' });
      await controller.handleValidMessage({ type: 'openTaskBoard', query: 'is:open' });
      await controller.handleValidMessage({
        type: 'setDashboardWidgets',
        widgets: [
          { id: 'kept', kind: 'savedQuery', width: 'half', filterId: 'kept' },
          { id: 'gone', kind: 'savedQuery', width: 'half', filterId: 'gone' },
          { id: 'tasks', kind: 'tasks', width: 'half' },
        ],
      });
      await controller.handleValidMessage({ type: 'resetDashboardWidgets' });

      assert.deepStrictEqual(navigation.opened, [
        'search #project/atlas',
        'board is:open',
      ]);
      assert.deepStrictEqual(calls, [
        'recent #project/atlas',
        'widgets kept,tasks',
        'reset',
      ]);
    } finally {
      dashboard.dispose();
    }
  });

  test('persists the Tags tab\'s grid columns', async () => {
    const columnUpdates: Array<{ section: string; columns: number }> = [];
    const preferences = {
      onDidChange: () => ({ dispose: () => undefined }),
      value: defaultPreferences,
      setDashboardColumns: async (section: string, columns: number) => {
        columnUpdates.push({ section, columns });
      },
    } as unknown as PreferencesStore;
    const dashboard = new DashboardPanel(
      createIndexer(),
      preferences,
      vscode.Uri.file(process.cwd()),
      createNavigation(),
    );

    try {
      await (dashboard as unknown as Controller).handleValidMessage({
        type: 'setDashboardColumns',
        section: 'tags',
        columns: 4,
      });
      assert.deepStrictEqual(columnUpdates, [{ section: 'tags', columns: 4 }]);
    } finally {
      dashboard.dispose();
    }
  });
});
