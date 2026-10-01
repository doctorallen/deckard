import type * as vscode from 'vscode';

import { createServices, startServices } from './composition/services';
import { features } from './composition/features';
import type { QueryBlocks } from './ui/preview/queryBlocks';

/**
 * What the extension exports. VS Code's Markdown preview calls
 * `extendMarkdownIt` to draw ```deckard query blocks.
 */
export interface DeckardExports {
  extendMarkdownIt: QueryBlocks['extendMarkdownIt'];
}

/**
 * Creates the extension's service graph and registers every VS Code entrypoint.
 *
 * Keeping services alive from one activation boundary lets panels, the sidebar,
 * decorations, and completion all observe the same index and preference store.
 */
export function activate(context: vscode.ExtensionContext): DeckardExports {
  const services = createServices(context);
  for (const feature of features) {
    void feature.register(context, services);
  }
  startServices(services);

  return {
    extendMarkdownIt: (md) => services.queryBlocks.extendMarkdownIt(md),
  };
}
