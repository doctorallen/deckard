import * as vscode from 'vscode';

import { WorkspaceIndexer } from '../../core/workspace/indexer';

/**
 * Tells a page how far the first scan has got, as it goes, until the index
 * is ready: `{ type: 'indexing', progress }`, which the shared page script
 * writes into its loading line as "Indexing this workspace: 412 of 3,760
 * notes read…". Does nothing once the workspace has been indexed.
 */
export function followIndexing(
  indexer: Pick<WorkspaceIndexer, 'hasIndexed' | 'scanProgress' | 'onDidProgress' | 'ready'>,
  post: (message: unknown) => void,
): vscode.Disposable {
  // Only an indexer that says it has not indexed yet is followed.
  if (indexer.hasIndexed !== false) {
    return { dispose: () => undefined };
  }
  const send = (): void => post({ type: 'indexing', progress: indexer.scanProgress ?? null });
  send();
  const listener = indexer.onDidProgress(send);
  void indexer.ready.then(() => listener.dispose());
  return listener;
}
