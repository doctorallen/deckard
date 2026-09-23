import * as vscode from 'vscode';

import { StalePreferences } from '../../core/storage/preferences';
import { WorkspaceIndex } from '../../core/types';

/**
 * Removing what points nowhere, on request.
 *
 * Deckard never throws away a favorite, a pin, or a saved search on its
 * own: an index that has stopped mentioning a tag is not proof the reader is
 * done with it, and a store that guessed wrong once emptied everything. What
 * it does instead is say how many of each point at nothing any more, and
 * remove them only when asked.
 */

interface TidyIndexSource {
  readonly ready: Promise<void>;
  getSnapshot(): WorkspaceIndex;
}

interface TidyStore {
  findStale(
    validTagKeys: Iterable<string>,
    validEntityKeys: Iterable<string>,
    validFilePaths: Iterable<string>,
  ): StalePreferences;
  removeStale(stale: StalePreferences): Promise<void>;
}

/** One line per kind, as "3 favorite tags", for whatever is stale. */
export function describeStale(stale: StalePreferences): string[] {
  const line = (count: number, one: string, many: string): string[] =>
    count === 0 ? [] : [`${count} ${count === 1 ? one : many}`];
  return [
    ...line(stale.favoriteTags.length, 'favorite tag', 'favorite tags'),
    ...line(stale.favoriteEntities.length, 'favorite entity', 'favorite entities'),
    ...line(stale.pinnedNotes.length, 'pinned note', 'pinned notes'),
    ...line(stale.savedFilters.length, 'saved search', 'saved searches'),
  ];
}

/** What each stale item is, for the reader to look at before agreeing. */
export function listStale(stale: StalePreferences): string {
  return [
    ...stale.favoriteTags,
    ...stale.favoriteEntities,
    ...stale.pinnedNotes.map((pin) =>
      pin.heading ? `${pin.filePath} › ${pin.heading}` : pin.filePath,
    ),
    ...stale.savedFilters.map((filter) => `"${filter.name}"`),
  ].join('\n');
}

export async function tidyPreferences(
  indexer: TidyIndexSource,
  preferences: TidyStore,
): Promise<void> {
  await indexer.ready;
  const index = indexer.getSnapshot();
  const stale = preferences.findStale(
    index.tags.keys(),
    index.entities.keys(),
    index.files.keys(),
  );
  const lines = describeStale(stale);
  if (lines.length === 0) {
    void vscode.window.showInformationMessage(
      'Every favorite, pin, and saved search still points at something in this workspace.',
    );
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Remove ${lines.join(', ')} that point at nothing in this workspace any more?`,
    { modal: true, detail: listStale(stale) },
    'Remove',
  );
  if (confirm === 'Remove') {
    await preferences.removeStale(stale);
    void vscode.window.showInformationMessage(`Removed ${lines.join(', ')}.`);
  }
}
