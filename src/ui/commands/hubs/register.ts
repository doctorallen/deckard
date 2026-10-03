import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { HubTreeProvider } from '../../views/hubTree';
import type { HubTreeNode } from '../../state/hubTree';
import { registerCommand } from '../runCommand';

/**
 * The Hubs view: notes under the hub notes of the tags they are about, and
 * the button on a hub that opens its tag's page.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const provider = new HubTreeProvider(services.indexer);
  const view = vscode.window.createTreeView('deckard.hubs', { treeDataProvider: provider, showCollapseAll: true });
  provider.attach(view);
  context.subscriptions.push(
    provider,
    view,
    registerCommand('deckard.hubs.openTagPage', (node?: HubTreeNode) =>
      node?.tagKey ? vscode.commands.executeCommand('deckard.showTagOverview', node.tagKey) : undefined,
    ),
  );
}
