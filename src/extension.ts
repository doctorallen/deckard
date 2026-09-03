import * as vscode from 'vscode';

import { PreferencesStore } from './core/storage/preferences';
import { WorkspaceIndexer } from './core/workspace/indexer';
import { createDailyNote } from './ui/commands/dailyNote';
import { extractHeadingCommand } from './ui/commands/extractHeading';
import { EditorTagDecorations } from './ui/commands/tagDecorations';
import { TagCompletionProvider } from './ui/commands/tagSuggestions';
import { DashboardPanel } from './ui/webview/dashboard';
import { SidebarNotesView } from './ui/webview/sidebarNotes';
import { TagOverviewPanels } from './ui/webview/tagOverview';

let activeServices: ExtensionServices | undefined;

/**
 * Creates the extension's service graph and registers every VS Code entrypoint.
 *
 * Keeping services alive from one activation boundary lets panels, the sidebar,
 * decorations, and completion all observe the same index and preference store.
 */
export function activate(context: vscode.ExtensionContext): void {
  const indexer = new WorkspaceIndexer();
  const preferences = new PreferencesStore(context.globalState);
  const tagPanels = new TagOverviewPanels(
    indexer,
    preferences,
    context.extensionUri,
  );
  const sidebarNotes = new SidebarNotesView(
    indexer,
    preferences,
    tagPanels,
    (tagKey) => tagPanels.show(tagKey),
    context.extension.packageJSON.version,
  );
  const tagDecorations = new EditorTagDecorations();
  const tagSuggestions = new TagCompletionProvider(indexer);
  const dashboard = new DashboardPanel(
    indexer,
    preferences,
    context.extensionUri,
    (tagKey) => {
      void tagPanels.show(tagKey);
    },
  );
  activeServices = {
    indexer,
    preferences,
    tagPanels,
    sidebarNotes,
    tagDecorations,
    tagSuggestions,
    dashboard,
  };

  context.subscriptions.push(
    indexer,
    preferences,
    tagPanels,
    sidebarNotes,
    tagDecorations,
    tagSuggestions,
    dashboard,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'deckard.relatedNotes',
      sidebarNotes,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('deckard.dashboard', {
      deserializeWebviewPanel: (webviewPanel) =>
        dashboard.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.tagOverview', {
      deserializeWebviewPanel: (webviewPanel, state) =>
        tagPanels.restore(webviewPanel, state),
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.showDashboard', () =>
      dashboard.show(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.reindexWorkspace', async () => {
      await indexer.ready;
      await indexer.refresh();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.createDailyNote', () =>
      createDailyNote(),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('deckard.extractHeading', () =>
      extractHeadingCommand(indexer),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deckard.showTagOverview',
      (tagKey?: unknown) => showTagOverview(tagPanels, indexer, tagKey),
    ),
  );

  void indexer.start().then(async () => {
    const index = indexer.getSnapshot();
    await preferences.prune(
      index.tags.keys(),
      index.tasks.keys(),
      index.sections.keys(),
    );
  });
}

/**
 * Releases services explicitly so timers, watchers, panels, and event emitters
 * stop even when deactivation happens before the next workspace change.
 */
export function deactivate(): void {
  activeServices?.indexer.dispose();
  activeServices?.preferences.dispose();
  activeServices?.tagPanels.dispose();
  activeServices?.sidebarNotes.dispose();
  activeServices?.tagDecorations.dispose();
  activeServices?.tagSuggestions.dispose();
  activeServices?.dashboard.dispose();
  activeServices = undefined;
}

/**
 * Names the long-lived services that share the extension lifecycle.
 */
interface ExtensionServices {
  indexer: WorkspaceIndexer;
  preferences: PreferencesStore;
  tagPanels: TagOverviewPanels;
  sidebarNotes: SidebarNotesView;
  tagDecorations: EditorTagDecorations;
  tagSuggestions: TagCompletionProvider;
  dashboard: DashboardPanel;
}

/**
 * Resolves a command argument or user choice only after the initial index exists.
 *
 * Serialized command URIs arrive as arrays, while the command palette supplies
 * no argument, so both paths converge on the same validated panel entrypoint.
 */
async function showTagOverview(
  tagPanels: TagOverviewPanels,
  indexer: WorkspaceIndexer,
  requestedTag: unknown,
): Promise<void> {
  await indexer.ready;
  const tags = [...indexer.getSnapshot().tags.values()];
  const tagArgument = Array.isArray(requestedTag)
    ? requestedTag[0]
    : requestedTag;
  const tagKey =
    typeof tagArgument === 'string'
      ? tagArgument
      : (
          await vscode.window.showQuickPick(
            tags.map((tag) => ({
              label: tag.label,
              description: `${tag.count} items`,
              key: tag.key,
            })),
            { placeHolder: 'Choose a tag to inspect' },
          )
        )?.key;

  if (tagKey) {
    await tagPanels.show(tagKey);
  }
}
