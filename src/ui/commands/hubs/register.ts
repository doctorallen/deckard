import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { HubTreeProvider } from '../../views/hubTree';
import type { HubTreeNode } from '../../state/hubTree';
import { registerCommand } from '../runCommand';
import { openResultAt } from '../navigation';
import { openNoteAt } from '../noteOpening';
import { createHubNoteForTag } from '../typeNoteForm';
import type { WorkspaceIndex } from '../../../domain/model';
import type { HubSort, TagVisits } from '../../../core/storage/tagVisits';

/**
 * The Hubs view: notes under the hub notes of the tags they are about, and
 * the button on a hub that opens the hub note itself, since selecting a hub
 * opens its tag's page.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const provider = new HubTreeProvider(services.indexer, services.tagVisits);
  const view = vscode.window.createTreeView('deckard.hubs', { treeDataProvider: provider, showCollapseAll: true });
  provider.attach(view);
  context.subscriptions.push(
    provider,
    view,
    // The hub note itself, where deckard.openNotesIn opens notes.
    registerCommand('deckard.hubs.openHubNote', (node?: HubTreeNode) =>
      node?.filePath ? openNoteAt(node.filePath, 1, { pin: true }) : undefined,
    ),
    // A tree does not say which keys were held, so the other way to open a
    // note is on its menu: whichever of these deckard.openNotesIn does not pick.
    registerCommand('deckard.hubs.openInEditor', (node?: HubTreeNode) =>
      node?.filePath ? openResultAt(node.filePath, 1, { pin: true }) : undefined,
    ),
    registerCommand('deckard.hubs.openAsPage', (node?: HubTreeNode) =>
      node?.filePath ? vscode.commands.executeCommand('deckard.openNotePage', node.filePath) : undefined,
    ),
    // By name, or the hubs with the most new since their page was last open first.
    registerCommand('deckard.hubs.setSort', () => chooseHubSort(services.tagVisits)),
    // The palette's way to the offer a tag's page makes under its title: a
    // tag a type has rows of gets the new note's form, any other its hub note.
    registerCommand('deckard.createHubNoteForTag', async () => {
      await services.indexer.ready;
      const picked = await vscode.window.showQuickPick(
        listTagsWithoutHub(services.indexer.getSnapshot()).map((tag) => ({
          label: tag.label,
          description: `${tag.count} ${tag.count === 1 ? 'entry' : 'entries'}`,
          key: tag.key,
        })),
        { title: 'Deckard: Create Hub Note for Tag', placeHolder: 'Choose a tag with no hub note yet' },
      );
      if (picked) {
        await createHubNoteForTag({ indexer: services.indexer, history: services.history }, picked.key);
      }
    }),
  );
}

/** Sort Hubs By…: by name, or What's new, the one in force marked Current. */
async function chooseHubSort(visits: Pick<TagVisits, 'hubSort' | 'setHubSort'>): Promise<void> {
  const current = visits.hubSort();
  const choices: Array<{ label: string; detail: string; sort: HubSort }> = [
    { label: 'Name', detail: 'A-Z on each level.', sort: 'name' },
    { label: 'What’s new', detail: 'The hubs with the most new since you last opened their page first.', sort: 'new' },
  ];
  const chosen = await vscode.window.showQuickPick(
    choices.map((choice) => ({ ...choice, description: choice.sort === current ? 'Current' : undefined })),
    { title: 'Sort hubs by', placeHolder: 'Choose how each level of the Hubs view is ordered' },
  );
  if (chosen && chosen.sort !== current) {
    await visits.setHubSort(chosen.sort);
  }
}

/** The tags no hub note describes yet, the most used first. */
export function listTagsWithoutHub(index: WorkspaceIndex): Array<{ key: string; label: string; count: number }> {
  const described = new Set<string>();
  index.files.forEach((file) => file.hub?.describes.forEach((tag) => described.add(tag.key)));
  return [...index.tags.values()]
    .filter((tag) => !described.has(tag.key))
    .map((tag) => ({ key: tag.key, label: tag.label, count: tag.count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
