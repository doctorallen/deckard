import * as vscode from 'vscode';

import { PreferencesStore } from './core/storage/preferences';
import { SearchStore } from './core/storage/searchStore';
import { WorkspaceIndexer } from './core/workspace/indexer';
import { createDailyNote } from './ui/commands/dailyNote';
import { extractHeadingCommand } from './ui/commands/extractHeading';
import { EntityHeadingSuggestions } from './ui/commands/entitySuggestions';
import { linkCurrentHeading } from './ui/commands/linkEntity';
import { WikiLinkCompletionProvider } from './ui/commands/linkSuggestions';
import { moveInlineTagsToFrontmatter } from './ui/commands/moveTagsToFrontmatter';
import { renameIndexedTag } from './ui/commands/renameTag';
import {
  EditorTagDecorations,
  isMarkdownDocument,
} from './ui/commands/tagDecorations';
import { TagCompletionProvider } from './ui/commands/tagSuggestions';
import { searchWorkspace } from './ui/commands/workspaceSearch';
import { DashboardPanel } from './ui/webview/dashboard';
import { HelpPanel } from './ui/webview/help';
import { SidebarNotesView } from './ui/webview/sidebarNotes';
import { StatsPanel } from './ui/webview/stats';
import { TagOverviewPanels } from './ui/webview/tagOverview';

let activeServices: ExtensionServices | undefined;

/**
 * Creates the extension's service graph and registers every VS Code entrypoint.
 *
 * Keeping services alive from one activation boundary lets panels, the sidebar,
 * decorations, and completion all observe the same index and preference store.
 */
export function activate(context: vscode.ExtensionContext): void {
  const indexer = new WorkspaceIndexer(
    undefined,
    new SearchStore(context.storageUri),
  );
  const preferences = new PreferencesStore(context.globalState);
  const tagPanels = new TagOverviewPanels(
    indexer,
    preferences,
    context.extensionUri,
  );
  const tagDecorations = new EditorTagDecorations();
  const tagSuggestions = new TagCompletionProvider(indexer);
  const linkSuggestions = new WikiLinkCompletionProvider(indexer);
  const entitySuggestions = new EntityHeadingSuggestions();
  const dashboard = new DashboardPanel(
    indexer,
    preferences,
    context.extensionUri,
    async (tagKey) => {
      await tagPanels.show(tagKey);
    },
  );
  const sidebarNotes = new SidebarNotesView(
    indexer,
    preferences,
    tagPanels,
    (tagKey, filterTagKey) => tagPanels.show(tagKey, filterTagKey),
    context.extension.packageJSON.version,
  );
  const stats = new StatsPanel(indexer, preferences, context.extensionUri);
  const help = new HelpPanel(context.extensionUri);
  activeServices = {
    indexer,
    preferences,
    tagPanels,
    sidebarNotes,
    tagDecorations,
    tagSuggestions,
    linkSuggestions,
    entitySuggestions,
    dashboard,
    stats,
    help,
  };

  context.subscriptions.push(
    indexer,
    preferences,
    tagPanels,
    sidebarNotes,
    tagDecorations,
    tagSuggestions,
    linkSuggestions,
    entitySuggestions,
    dashboard,
    stats,
    help,
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
    vscode.window.registerWebviewPanelSerializer('deckard.stats', {
      deserializeWebviewPanel: (webviewPanel) => stats.restore(webviewPanel),
    }),
    vscode.window.registerWebviewPanelSerializer('deckard.help', {
      deserializeWebviewPanel: (webviewPanel) => help.restore(webviewPanel),
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
    vscode.commands.registerCommand('deckard.showStats', () => stats.show()),
    vscode.commands.registerCommand('deckard.showHelp', () => help.show()),
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
    vscode.commands.registerCommand('deckard.searchWorkspace', () =>
      searchWorkspace(indexer),
    ),
    vscode.commands.registerCommand('deckard.linkCurrentHeading', () =>
      linkCurrentHeading(indexer),
    ),
    vscode.commands.registerCommand('deckard.moveTagsToFrontmatter', () =>
      moveInlineTagsToFrontmatter(),
    ),
    vscode.commands.registerCommand(
      'deckard.renameTag',
      (requestedTagKey?: unknown) =>
        renameIndexedTag(
          indexer,
          getCommandTagArgument(requestedTagKey),
        ),
    ),
    vscode.commands.registerCommand(
        'deckard.showEntryRelatedNotes',
        async (documentUri?: unknown, sourceLine?: unknown) => {
          if (
            typeof documentUri !== 'string' ||
            typeof sourceLine !== 'number' ||
            !Number.isInteger(sourceLine) ||
            sourceLine < 1
          ) {
            return;
          }
          const uri = vscode.Uri.parse(documentUri);
          if (!isMarkdownDocument({ languageId: 'markdown', uri })) {
            return;
          }
          await sidebarNotes.showRelatedNotesForEntry(uri, sourceLine);
        },
    ),
  );

  void indexer.start().then(async () => {
    const index = indexer.getSnapshot();
    await preferences.prune(
      index.tags.keys(),
      index.tasks.keys(),
      index.sections.keys(),
      index.entities.keys(),
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
  activeServices?.linkSuggestions.dispose();
  activeServices?.entitySuggestions.dispose();
  activeServices?.dashboard.dispose();
  activeServices?.stats.dispose();
  activeServices?.help.dispose();
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
  linkSuggestions: WikiLinkCompletionProvider;
  entitySuggestions: EntityHeadingSuggestions;
  dashboard: DashboardPanel;
  stats: StatsPanel;
  help: HelpPanel;
}

function getCommandTagArgument(value: unknown): string | undefined {
  const argument = Array.isArray(value) ? value[0] : value;
  return typeof argument === 'string' ? argument : undefined;
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
  const tagKey =
    getCommandTagArgument(requestedTag) ??
    (
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
