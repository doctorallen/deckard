import * as assert from 'assert';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { NavigationService } from '../services/navigationService';
import { DashboardPanelOptions } from '../ui/webview/dashboard';
import { WebviewHost } from '../ui/webview/host/webviewHost';
import { DashboardController, DashboardNavigation, DashboardPreferences } from '../ui/webview/pages/dashboard/dashboardController';
import { ThemePreview } from '../ui/webview/themePreview';
import { FakeSurface } from './fakeWebview';
import { createTaskWrites } from './taskWrites';
import { PersistedPreferences } from '../domain/model';
import { DashboardMessage } from '../ui/protocol/dashboard';

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
  } as unknown as DashboardPanelOptions['indexer'];
}

/**
 * Home's page on a fake panel, built as `DashboardPanel` builds it: `send`
 * hands it a message as the page posts one, and resolves when it is done.
 */
function openHome(options: Pick<DashboardPanelOptions, 'indexer' | 'preferences' | 'navigation'>) {
  const controller = new DashboardController({
    ...options,
    extensionUri: vscode.Uri.file(process.cwd()),
    writes: createTaskWrites(),
    navigationService: new NavigationService(),
    source: { getWidgetChoices: () => [], addWidget: () => undefined, resetWidgets: async () => undefined },
  });
  const host = new WebviewHost(controller, { indexer: options.indexer, themePreview: new ThemePreview() });
  const surface = new FakeSurface();
  host.attach(surface);
  return {
    controller,
    host,
    send: (message: DashboardMessage) => surface.webview.send(message),
  };
}

suite('Dashboard navigation', () => {
  test('opens a project entity from its indexed Dashboard key', async () => {
    const index = createIndexer([
      ['notes/metadata-only.md', '---\nprojects: [neon-relay]\n---\nA project note.'],
    ]);
    const preferences = {
      reader: {
        onDidChange: () => ({ dispose: () => undefined }),
        onDidRecordVisit: () => ({ dispose: () => undefined }),
        value: defaultPreferences,
      },
    } as unknown as DashboardPreferences;
    const navigation = createNavigation();
    const home = openHome({ indexer: index, preferences, navigation });

    try {
      await home.send({
        type: 'openTag',
        tagKey: '#project/neon-relay',
      });
      assert.deepStrictEqual(navigation.opened, ['tag #project/neon-relay']);
    } finally {
      home.host.dispose();
    }
  });

  test('opens saved views on search pages, a tag set as its tags joined by AND', async () => {
    const index = createIndexer([
      ['notes/filter.md', '# Atlas #project/atlas #follow-up #urgent'],
    ]);
    const preferences = {
      reader: {
        onDidChange: () => ({ dispose: () => undefined }),
        onDidRecordVisit: () => ({ dispose: () => undefined }),
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
      },
    } as unknown as DashboardPreferences;
    const navigation = createNavigation();
    const home = openHome({ indexer: index, preferences, navigation });

    try {
      await home.send({
        type: 'openSavedFilter',
        filterId: 'atlas-follow-up',
      });
      await home.controller.openSavedFilter('open-atlas');
      assert.deepStrictEqual(navigation.opened, [
        'search #follow-up AND #project/atlas AND #urgent',
        'search #project/atlas is:open',
      ]);
    } finally {
      home.host.dispose();
    }
  });

  test('sends Home\'s links to search pages, the Task Board, and back to itself', async () => {
    const calls: string[] = [];
    const preferences = {
      reader: {
        onDidChange: () => ({ dispose: () => undefined }),
        onDidRecordVisit: () => ({ dispose: () => undefined }),
        value: {
          ...defaultPreferences,
          savedFilters: [{ id: 'kept', name: 'Kept', tagKeys: [], query: 'is:open' }],
        },
      },
      savedSearches: {
        recordRecentQuery: async (query: string) => {
          calls.push(`recent ${query}`);
        },
      },
      homeWidgets: {
        setDashboardWidgets: async (widgets: Array<{ id: string }>) => {
          calls.push(`widgets ${widgets.map((widget) => widget.id).join(',')}`);
        },
        resetDashboardWidgets: async () => {
          calls.push('reset');
        },
      },
    } as unknown as DashboardPreferences;
    const navigation = createNavigation();
    const home = openHome({ indexer: createIndexer(), preferences, navigation });

    try {
      await home.send({ type: 'openSearch', query: ' #project/atlas ' });
      await home.send({ type: 'openTaskBoard', query: 'is:open' });
      await home.send({
        type: 'setDashboardWidgets',
        widgets: [
          { id: 'kept', kind: 'savedQuery', width: 'half', filterId: 'kept' },
          { id: 'gone', kind: 'savedQuery', width: 'half', filterId: 'gone' },
          { id: 'tasks', kind: 'tasks', width: 'half' },
        ],
      });
      // The reset asks first, in a modal; this answers it.
      const warn = vscode.window.showWarningMessage;
      (vscode.window as { showWarningMessage: unknown }).showWarningMessage = async () => 'Reset Widgets';
      try {
        await home.send({ type: 'resetDashboardWidgets' });
      } finally {
        (vscode.window as { showWarningMessage: unknown }).showWarningMessage = warn;
      }

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
      home.host.dispose();
    }
  });

  test('persists the Tags tab\'s grid columns', async () => {
    const columnUpdates: Array<{ section: string; columns: number }> = [];
    const preferences = {
      reader: {
        onDidChange: () => ({ dispose: () => undefined }),
        onDidRecordVisit: () => ({ dispose: () => undefined }),
        value: defaultPreferences,
      },
      display: {
        setDashboardColumns: async (section: string, columns: number) => {
          columnUpdates.push({ section, columns });
        },
      },
    } as unknown as DashboardPreferences;
    const home = openHome({ indexer: createIndexer(), preferences, navigation: createNavigation() });

    try {
      await home.send({
        type: 'setDashboardColumns',
        section: 'tags',
        columns: 4,
      });
      assert.deepStrictEqual(columnUpdates, [{ section: 'tags', columns: 4 }]);
    } finally {
      home.host.dispose();
    }
  });
});
