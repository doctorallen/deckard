import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import type { IndexRoles } from '../../../core/workspace/indexReader';
import { checkSetup } from '../checkSetup';
import { chooseTheme, createChooseThemeDeps } from '../chooseTheme';
import { exportPreferences, importPreferences, restorePreferences } from '../preferenceBackups';
import { createSampleWorkspace } from '../sampleWorkspace';
import { tidyPreferences } from '../tidyPreferences';
import { registerCommand } from '../runCommand';

/**
 * Preferences and setup: Show Log, tidying and backing up the preferences,
 * Check Setup, the sample workspace, Choose Theme…, the walkthrough, and
 * Reindex Workspace.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { log, indexer, scanner, themePreview } = services;
  const { repository: preferences, maintenance, snapshots } = services.preferences;
  context.subscriptions.push(
    registerCommand('deckard.showLog', () => log.show()),
    registerCommand('deckard.tidyPreferences', () =>
      tidyPreferences(indexer, maintenance),
    ),
    registerCommand('deckard.exportPreferences', () =>
      exportPreferences({ reader: preferences, maintenance }),
    ),
    registerCommand('deckard.importPreferences', () =>
      importPreferences({ reader: preferences, maintenance }),
    ),
    registerCommand('deckard.restorePreferences', () =>
      restorePreferences({ reader: preferences, maintenance }, snapshots),
    ),
    registerCommand('deckard.checkSetup', () =>
      checkSetup(indexer, scanner),
    ),
    registerCommand('deckard.createSampleWorkspace', () =>
      createSampleWorkspace(context),
    ),
    registerCommand('deckard.chooseTheme', () =>
      chooseTheme(context.extension.packageJSON.contributes, createChooseThemeDeps(themePreview)),
    ),
    registerCommand('deckard.openWalkthrough', () =>
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        `${context.extension.id}#deckard.gettingStarted`,
        false,
      ),
    ),
    registerCommand('deckard.reindexWorkspace', () => reindexWorkspace(indexer)),
  );
}

/** Reads and parses every note again, then says what it found. */
async function reindexWorkspace(indexer: IndexRoles<vscode.Uri>): Promise<void> {
  await indexer.ready;
  // Asked for by hand, every note is read and parsed again.
  await indexer.refresh({ reuse: 'none' });
  // Reindexing looked like it did nothing: a status-bar spinner, then
  // silence. Asked for by hand, it says what it found.
  const index = indexer.getSnapshot();
  const plural = (count: number, noun: string): string =>
    `${count} ${noun}${count === 1 ? '' : 's'}`;
  void vscode.window.showInformationMessage(
    `Deckard indexed ${plural(index.files.size, 'file')}: ${plural(
      index.sections.size,
      'note',
    )}, ${plural(index.tasks.size, 'task')}, and ${plural(
      index.tags.size,
      'tag',
    )}.`,
  );
}
