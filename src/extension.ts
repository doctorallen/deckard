import type * as vscode from 'vscode';

import { createServices, startServices } from './composition/services';
import { runFeatures } from './composition/feature';
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
 * The composition root: builds the extension's service graph once, lets each
 * feature register its commands against it, then starts the first index.
 *
 * Keeping services alive from one activation boundary lets panels, the sidebar,
 * decorations, and completion all observe the same index and preference store.
 * Everything that is released on deactivation is on `context.subscriptions`,
 * which VS Code disposes in the order it was pushed, so there is no
 * `deactivate()`. activate() stays synchronous: every command is registered,
 * and the exports returned, by the time VS Code counts Deckard active.
 */
export function activate(context: vscode.ExtensionContext): DeckardExports {
  const services = createServices(context);
  runFeatures(features, context, services);
  startServices(services);

  return {
    extendMarkdownIt: (md) => services.queryBlocks.extendMarkdownIt(md),
  };
}
