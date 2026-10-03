import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { HubTreeProvider } from '../../views/hubTree';
import type { HubTreeNode } from '../../state/hubTree';
import { registerCommand } from '../runCommand';
import { openResultAt } from '../navigation';

/**
 * The Hubs view: notes under the hub notes of the tags they are about, and
 * the button on a hub that opens the hub note itself, since selecting a hub
 * opens its tag's page.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const provider = new HubTreeProvider(services.indexer);
  const view = vscode.window.createTreeView('deckard.hubs', { treeDataProvider: provider, showCollapseAll: true });
  provider.attach(view);
  context.subscriptions.push(
    provider,
    view,
    registerCommand('deckard.hubs.openHubNote', (node?: HubTreeNode) => {
      const uri = node?.filePath ? services.indexer.getUri(node.filePath) : undefined;
      return uri ? vscode.commands.executeCommand('vscode.open', uri) : undefined;
    }),
    // A tree does not say which keys were held, so the other way to open a
    // note is on its menu: whichever of these deckard.openNotesIn does not pick.
    registerCommand('deckard.hubs.openInEditor', (node?: HubTreeNode) =>
      node?.filePath ? openResultAt(node.filePath, 1, { pin: true }) : undefined,
    ),
    registerCommand('deckard.hubs.openAsPage', (node?: HubTreeNode) =>
      node?.filePath ? vscode.commands.executeCommand('deckard.openNotePage', node.filePath) : undefined,
    ),
  );
}
