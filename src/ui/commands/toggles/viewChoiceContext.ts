import * as vscode from 'vscode';

import type { PreferencesReader } from '../../../core/storage/preferencesRepository';
import { readViewChoice, VIEW_CHOICES, type ViewChoice } from '../../../core/storage/preferencesViewChoices';
import { VIEW_CHOICE_CONTEXT_KEYS } from './viewToggles';

/**
 * Publishes each view choice as its context key, now and whenever the
 * preferences change it, so the Calendar's menu and the Outline's title
 * offer whichever command of a pair changes something. A key is set again
 * only when its choice changed.
 */
export function publishViewChoices(reader: Pick<PreferencesReader, 'value' | 'onDidChange'>): vscode.Disposable {
  const published = new Map<ViewChoice, boolean>();
  const publish = (): void => {
    const value = reader.value;
    for (const choice of VIEW_CHOICES) {
      const on = readViewChoice(value, choice);
      if (published.get(choice) !== on) {
        published.set(choice, on);
        void vscode.commands.executeCommand('setContext', VIEW_CHOICE_CONTEXT_KEYS[choice], on);
      }
    }
  };
  publish();
  return reader.onDidChange(publish);
}
