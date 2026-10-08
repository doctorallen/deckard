import * as vscode from 'vscode';

import type { PreferencesReader } from '../../../core/storage/preferencesRepository';
import { readViewChoice, type ViewChoice } from '../../../core/storage/preferencesViewChoices';
import { VIEW_CHOICE_CONTEXT_KEYS } from './viewToggles';

/**
 * Publishes each view choice that has a context key, now and whenever the
 * preferences change it, so the Outline's title offers whichever command
 * of its pair changes something. A key is set again only when its choice
 * changed.
 */
export function publishViewChoices(reader: Pick<PreferencesReader, 'value' | 'onDidChange'>): vscode.Disposable {
  const published = new Map<ViewChoice, boolean>();
  const publish = (): void => {
    const value = reader.value;
    for (const [choice, key] of Object.entries(VIEW_CHOICE_CONTEXT_KEYS) as [ViewChoice, string][]) {
      const on = readViewChoice(value, choice);
      if (published.get(choice) !== on) {
        published.set(choice, on);
        void vscode.commands.executeCommand('setContext', key, on);
      }
    }
  };
  publish();
  return reader.onDidChange(publish);
}
