import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import type { IndexReader } from '../../../core/workspace/indexReader';
import { getCommandTagArgument } from '../commandArguments';
import { insertQueryBlock } from '../insertQueryBlock';
import { registerCommand } from '../runCommand';

/** The search pages, which these commands open. */
type SearchPages = Services['pages']['search'];

/**
 * Search pages: a tag's page, a search page on a query, given or asked for,
 * and Insert Query Block.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const searchPanels = services.pages.search;
  context.subscriptions.push(
    registerCommand(
      'deckard.showTagOverview',
      (tagKey?: unknown) => showTagOverview(searchPanels, indexer, tagKey),
    ),
    registerCommand('deckard.search', (query?: unknown) =>
      searchPanels.showQuery(getCommandTagArgument(query) ?? ''),
    ),
    registerCommand('deckard.insertQueryBlock', () =>
      insertQueryBlock(services.preferences.repository),
    ),
    registerCommand(
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
      title: 'Deckard: Open Search Page',
      prompt:
        'A search, such as #project/atlas AND is:open, or nothing for a page of every note',
      placeHolder: '#project/atlas AND is:open',
    }));

  // Nothing typed opens the page with every note, as Open Search Page did
  // before the two became one command; dismissing it opens nothing.
  if (query !== undefined) {
    await searchPanels.showQuery(query.trim());
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
