import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import type { IndexReader } from '../../../core/workspace/indexReader';
import { getCommandTagArgument } from '../commandArguments';
import { insertQueryBlock } from '../insertQueryBlock';

/** The search pages, which these commands open. */
type SearchPages = Services['pages']['search'];

/**
 * Search and Find: a tag's page, a search page on a query, Insert Query
 * Block, and Find with its keys.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, quickFind } = services;
  const searchPanels = services.pages.search;
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'deckard.showTagOverview',
      (tagKey?: unknown) => showTagOverview(searchPanels, indexer, tagKey),
    ),
    vscode.commands.registerCommand('deckard.search', (query?: unknown) =>
      searchPanels.showQuery(getCommandTagArgument(query) ?? ''),
    ),
    vscode.commands.registerCommand('deckard.insertQueryBlock', () =>
      insertQueryBlock(services.preferences.repository),
    ),
    vscode.commands.registerCommand(
      'deckard.searchWorkspace',
      (initialQuery?: unknown) =>
        quickFind.show(getCommandTagArgument(initialQuery)),
    ),
    vscode.commands.registerCommand('deckard.quickFind.complete', () =>
      quickFind.complete(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.openBeside', () =>
      quickFind.openBeside(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.insertLink', () =>
      quickFind.insertLinkFromActive(),
    ),
    vscode.commands.registerCommand('deckard.quickFind.actions', () =>
      quickFind.showActions(),
    ),
    vscode.commands.registerCommand(
      'deckard.searchNotes',
      (requestedQuery?: unknown) =>
        showQuerySearch(searchPanels, indexer, requestedQuery),
    ),
  );
}

/**
 * Opens a search page on a query.
 *
 * The command accepts a query argument so a link or another command can open a
 * saved search directly, and prompts for one otherwise.
 */
async function showQuerySearch(
  searchPanels: SearchPages,
  indexer: IndexReader,
  requestedQuery: unknown,
): Promise<void> {
  await indexer.ready;
  const query =
    getCommandTagArgument(requestedQuery) ??
    (await vscode.window.showInputBox({
      title: 'Search Deckard notes',
      prompt:
        'Write a query, such as (tag = #project/atlas AND tag = #urgent) OR text ~ "vendor"',
      placeHolder: 'tag = #project/atlas AND task = open',
    }));

  if (query?.trim()) {
    await searchPanels.showQuery(query);
  }
}

/**
 * Resolves a command argument or user choice only after the initial index exists.
 *
 * Serialized command URIs arrive as arrays, while the command palette supplies
 * no argument, so both paths converge on the same validated panel entrypoint.
 */
async function showTagOverview(
  searchPanels: SearchPages,
  indexer: IndexReader,
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
          description: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
          key: tag.key,
        })),
        { placeHolder: 'Choose a tag to open its page' },
      )
    )?.key;

  if (tagKey) {
    await searchPanels.show(tagKey);
  }
}
