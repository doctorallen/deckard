import * as vscode from 'vscode';

import {
  deckardThemeNames,
  deckardThemes,
  DeckardTheme,
  getDeckardTheme,
  previewDeckardTheme,
} from '../webview/themes';
import { settingTarget, writeSetting } from './settings';

/**
 * Choose Theme…: a quick pick of Deckard's eight themes that shows each on
 * the open pages as it is moved through. Nothing is written until one is
 * kept; Escape puts back the theme that was in use.
 */

export interface ThemeItem extends vscode.QuickPickItem {
  theme: DeckardTheme;
}

interface ThemeManifest {
  configuration?: { properties?: Record<string, { enumDescriptions?: string[] }> }[];
}

export interface ChooseThemeDeps {
  createQuickPick(): vscode.QuickPick<ThemeItem>;
  /** Writes the theme kept; false when it could not be written. */
  writeTheme(theme: DeckardTheme): Promise<boolean>;
  /** Whether any Deckard page is on screen to preview on. */
  hasVisibleDeckardPage(): boolean;
  openDashboard(): Thenable<unknown>;
  preview(theme: DeckardTheme | undefined, options?: { silent?: boolean }): void;
  current(): DeckardTheme;
  /** How long the active item rests before it is previewed, in ms. */
  delay?: number;
}

/** The eight themes as the picker lists them, the one in use marked. */
export function createThemeItems(manifest: ThemeManifest, current: DeckardTheme): ThemeItem[] {
  const descriptions =
    (manifest.configuration ?? [])
      .map((group) => group.properties?.['deckard.theme']?.enumDescriptions)
      .find((found) => found !== undefined) ?? [];
  return deckardThemes.map((theme, index) => ({
    label: deckardThemeNames[theme],
    ...(theme === current ? { description: 'In use' } : {}),
    ...(descriptions[index] ? { detail: descriptions[index] } : {}),
    theme,
  }));
}

/** Whether a Deckard page is showing in some editor group. */
export function hasVisibleDeckardPage(): boolean {
  return vscode.window.tabGroups.all.some((group) => {
    const input = group.activeTab?.input;
    return input instanceof vscode.TabInputWebview && input.viewType.includes('deckard.');
  });
}

function defaultDeps(): ChooseThemeDeps {
  return {
    createQuickPick: () => vscode.window.createQuickPick<ThemeItem>(),
    writeTheme: (theme) => writeSetting('theme', theme, settingTarget('theme')),
    hasVisibleDeckardPage,
    openDashboard: () => vscode.commands.executeCommand('deckard.showDashboard'),
    preview: previewDeckardTheme,
    current: getDeckardTheme,
  };
}

/** Runs Choose Theme…, and returns the theme kept, if one was. */
export async function chooseTheme(
  manifest: ThemeManifest,
  deps: ChooseThemeDeps = defaultDeps(),
): Promise<DeckardTheme | undefined> {
  // Run from the walkthrough, there may be nothing to preview on.
  if (!deps.hasVisibleDeckardPage()) {
    await deps.openDashboard();
  }
  const original = deps.current();
  const items = createThemeItems(manifest, original);
  const pick = deps.createQuickPick();
  pick.title = 'Deckard theme';
  pick.placeholder = `Move through the themes to preview them. Enter keeps one, Escape puts back ${deckardThemeNames[original]}.`;
  pick.items = items;
  pick.activeItems = items.filter((item) => item.theme === original);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let kept: DeckardTheme | undefined;
    const settle = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const disposables = [
      pick.onDidChangeActive((active) => {
        const theme = active[0]?.theme;
        settle();
        if (!theme) {
          return;
        }
        timer = setTimeout(() => {
          timer = undefined;
          deps.preview(theme === original ? undefined : theme);
        }, deps.delay ?? 120);
      }),
      pick.onDidAccept(async () => {
        settle();
        const theme = pick.activeItems[0]?.theme ?? pick.selectedItems[0]?.theme;
        kept = theme;
        pick.hide();
        if (theme && theme !== original && (await deps.writeTheme(theme))) {
          // The pages already show it; the setting's own change redraws them.
          deps.preview(undefined, { silent: true });
        } else {
          deps.preview(undefined);
        }
      }),
      pick.onDidHide(() => {
        settle();
        if (kept === undefined) {
          deps.preview(undefined);
        }
        disposables.forEach((disposable) => disposable.dispose());
        pick.dispose();
        resolve(kept);
      }),
    ];
    pick.show();
  });
}
