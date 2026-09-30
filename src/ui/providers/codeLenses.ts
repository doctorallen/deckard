import * as vscode from 'vscode';

import { resolveSourceUri } from '../commands/navigation';

/**
 * What the CodeLens providers share: a lens whose command is built only when
 * VS Code resolves it, and the lookup that turns index entries into places
 * for the references peek.
 */

/**
 * A lens whose command, and whatever work finding its locations takes, is
 * built only when VS Code resolves it, so lenses out of view cost nothing.
 */
export class LazyCodeLens extends vscode.CodeLens {
  /**
   * @param range Where the lens sits.
   * @param createCommand Builds the lens's command when VS Code resolves it.
   */
  public constructor(
    range: vscode.Range,
    public readonly createCommand: () =>
      vscode.Command | Promise<vscode.Command>,
  ) {
    super(range);
  }
}

/** Builds a lazy lens's command, which is what resolving a lens means here. */
export async function resolveLazyCodeLens(lens: LazyCodeLens): Promise<LazyCodeLens> {
  lens.command = await lens.createCommand();
  return lens;
}

/**
 * The places `items` point to, for the references peek, in their order. Each
 * note's URI is resolved once, one note after another, and an item whose note
 * cannot be found is left out.
 * @param items The entries to place.
 * @param pathOf The workspace-relative note an entry is in.
 * @param rangeOf Where in its note an entry is.
 */
export async function locate<Item>(
  items: readonly Item[],
  pathOf: (item: Item) => string,
  rangeOf: (item: Item) => vscode.Range | vscode.Position,
): Promise<vscode.Location[]> {
  const uris = new Map<string, vscode.Uri | undefined>();
  for (const item of items) {
    const filePath = pathOf(item);
    if (!uris.has(filePath)) {
      uris.set(filePath, await resolveSourceUri(filePath));
    }
  }
  return items.flatMap((item) => {
    const uri = uris.get(pathOf(item));
    return uri ? [new vscode.Location(uri, rangeOf(item))] : [];
  });
}
