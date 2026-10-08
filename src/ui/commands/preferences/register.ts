import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { managePreferences } from '../managePreferences';
import { exportPreferences, importPreferences, restorePreferences } from '../preferenceBackups';
import { tidyPreferences } from '../tidyPreferences';
import { registerCommand } from '../runCommand';

/**
 * Preference backups: tidying the preferences, and exporting, importing, and
 * restoring them, each also a row of Manage Favorites, Pins, and Searches….
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const { repository: preferences, maintenance, snapshots } = services.preferences;
  context.subscriptions.push(
    registerCommand('deckard.managePreferences', () => managePreferences()),
    registerCommand('deckard.tidyPreferences', () =>
      tidyPreferences(indexer, maintenance),
    ),
    registerCommand('deckard.exportPreferences', () =>
      exportPreferences({ reader: preferences, maintenance }),
    ),
    registerCommand('deckard.importPreferences', () =>
      importPreferences({ reader: preferences, maintenance }, snapshots),
    ),
    registerCommand('deckard.restorePreferences', () =>
      restorePreferences({ reader: preferences, maintenance }, snapshots),
    ),
  );
}
