import * as vscode from 'vscode';

import { PreferenceServices } from '../../core/storage/preferences';

/** The two ways on from a saved search, as the message's buttons say them. */
export const SHOW_RESULTS_ON_HOME = 'Show Results on Home';
export const OPEN_HOME = 'Open Home';

/**
 * Says a search was saved, and offers what a saved search is for: its
 * results on Home, or Home itself. Home opens on its own tab either way.
 */
export async function offerSavedSearchOnHome(
  preferences: Pick<PreferenceServices, 'homeWidgets'>,
  saved: { id: string; name: string },
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Saved the search "${saved.name}".`,
    SHOW_RESULTS_ON_HOME,
    OPEN_HOME,
  );
  if (choice === SHOW_RESULTS_ON_HOME) {
    await preferences.homeWidgets.addSavedSearchWidget(saved.id);
  }
  if (choice === SHOW_RESULTS_ON_HOME || choice === OPEN_HOME) {
    await preferences.homeWidgets.setDashboardMode('home');
    await vscode.commands.executeCommand('deckard.showDashboard');
  }
}
