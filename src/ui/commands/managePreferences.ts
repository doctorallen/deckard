import * as vscode from 'vscode';

/**
 * Deckard: Manage Favorites, Pins, and Searches…, one palette row for the
 * four rare upkeep commands, which the palette no longer lists one by one.
 * Each row runs the command it names, as it always ran.
 */
export const PREFERENCE_ACTIONS: ReadonlyArray<vscode.QuickPickItem & { command: string }> = [
  {
    label: 'Tidy…',
    detail: 'Remove the favorites, pins, and tag-set searches that point at nothing, after asking',
    command: 'deckard.tidyPreferences',
  },
  {
    label: 'Export…',
    detail: 'Write what Deckard remembers about this workspace to a JSON file',
    command: 'deckard.exportPreferences',
  },
  {
    label: 'Import…',
    detail: 'Read an exported file back and, after asking, replace what this workspace remembers',
    command: 'deckard.importPreferences',
  },
  {
    label: 'Restore from a Copy…',
    detail: "Take back one of Deckard's automatic copies, after asking",
    command: 'deckard.restorePreferences',
  },
];

/** Lists the four, and runs the one chosen. */
export async function managePreferences(): Promise<void> {
  const picked = await vscode.window.showQuickPick(PREFERENCE_ACTIONS, {
    title: 'Favorites, pins, and searches',
    placeHolder: 'What Deckard remembers about this workspace',
  });
  if (picked) {
    await vscode.commands.executeCommand(picked.command);
  }
}
