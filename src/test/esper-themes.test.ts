import * as assert from 'assert';

import * as vscode from 'vscode';

import {
  ESPER_THEMES_ID,
  ESPER_THEMES_MESSAGE,
  ESPER_THEMES_SUGGESTED,
  INSTALL_BUTTON,
  SEE_THEMES_BUTTON,
  shouldSuggestEsperThemes,
  suggestEsperThemesOnce,
} from '../ui/commands/esperThemes';

function memento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => [...store.keys()],
    get: <T>(key: string, fallback?: T) => (store.has(key) ? (store.get(key) as T) : fallback) as T,
    update: async (key: string, value: unknown) => void store.set(key, value),
  };
}

/** Suggests with a stand-in reader who presses `choice`, and returns what was shown and run. */
async function suggest(state: vscode.Memento, choice: string | undefined, installed = false) {
  const shown: string[][] = [];
  const ran: unknown[][] = [];
  await suggestEsperThemesOnce(state, {
    isInstalled: () => installed,
    show: async (message, ...buttons) => {
      shown.push([message, ...buttons]);
      return choice;
    },
    run: async (...args) => void ran.push(args),
  });
  return { shown, ran };
}

suite('Esper Themes suggestion', () => {
  test('suggests only on a machine that has not been asked and lacks the theme', () => {
    assert.strictEqual(shouldSuggestEsperThemes({ alreadySuggested: false, installed: false }), true);
    assert.strictEqual(shouldSuggestEsperThemes({ alreadySuggested: true, installed: false }), false);
    assert.strictEqual(shouldSuggestEsperThemes({ alreadySuggested: false, installed: true }), false);
  });

  test('installs it from Install, and asks only once', async () => {
    const state = memento();
    const first = await suggest(state, INSTALL_BUTTON);
    assert.deepStrictEqual(first.shown, [[ESPER_THEMES_MESSAGE, INSTALL_BUTTON, SEE_THEMES_BUTTON]]);
    assert.deepStrictEqual(first.ran, [['workbench.extensions.installExtension', ESPER_THEMES_ID]]);
    assert.strictEqual(state.get(ESPER_THEMES_SUGGESTED), true);
    const again = await suggest(state, INSTALL_BUTTON);
    assert.deepStrictEqual(again.shown, []);
  });

  test('opens its Extensions page from See Themes, and does nothing when dismissed', async () => {
    assert.deepStrictEqual((await suggest(memento(), SEE_THEMES_BUTTON)).ran, [['extension.open', ESPER_THEMES_ID]]);
    const dismissed = memento();
    assert.deepStrictEqual((await suggest(dismissed, undefined)).ran, []);
    assert.strictEqual(dismissed.get(ESPER_THEMES_SUGGESTED), true);
  });

  test('says nothing when the theme is installed, and does not ask later either', async () => {
    const state = memento();
    assert.deepStrictEqual((await suggest(state, INSTALL_BUTTON, true)).shown, []);
    assert.strictEqual(state.get(ESPER_THEMES_SUGGESTED), true);
  });
});
