import * as vscode from 'vscode';

import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { openSourceAt } from './navigation';

/**
 * Provides keyboard-first deterministic search over the local Deckard index.
 */
export async function searchWorkspace(indexer: WorkspaceIndexer): Promise<void> {
  await indexer.ready;
  const query = await vscode.window.showInputBox({
    prompt: 'Search notes, people, projects, topics, and tasks',
    placeHolder: 'What did I discuss with Alex about Atlas?',
  });
  if (!query?.trim()) {
    return;
  }

  const results = indexer.search(query);
  if (results.length === 0) {
    void vscode.window.showInformationMessage(
      'Deckard found no saved notes matching that search.',
    );
    return;
  }

  const selected = await vscode.window.showQuickPick(
    results.map((result) => ({
      label: `${result.type === 'task' ? '$(checklist)' : '$(note)'} ${result.title}`,
      description: `${result.filePath}:${result.line}`,
      detail: [
        result.excerpt,
        result.matchedEntities.map((entity) => entity.label).join(' '),
      ]
        .filter(Boolean)
        .join(' — '),
      result,
    })),
    {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: `${results.length} matching saved note entries`,
    },
  );
  if (selected) {
    await openSourceAt(selected.result.filePath, selected.result.line);
  }
}
