import * as vscode from 'vscode';

import {
  deckardThemeNames,
  deckardThemes,
  DeckardTheme,
  getDeckardTheme,
} from '../webview/themes';
import { settingTarget, writeSetting } from './settings';

/**
 * Choose Theme…: a quick pick of Deckard's eight themes that shows each on
 * the open pages as it is moved through. Nothing is written until one is
 * kept; Escape puts back the theme that was in use.
 */

/** A picker row: the theme's name, its description, and whether it is in use. */
export interface ThemeItem extends vscode.QuickPickItem {
  theme: DeckardTheme;
}

/** The part of package.json the theme descriptions are read from. */
interface ThemeManifest {
  configuration?: { properties?: Record<string, { enumDescriptions?: string[] }> }[];
}

/**
 * What Choose Theme… acts through: the picker, the setting, and the preview.
 * Injected so a test can drive the picker and read what was previewed and
 * written, without VS Code.
 */
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

/**
 * The preview Choose Theme… shows its themes on: the extension's
 * ThemePreview, which every page draws with.
 */
export interface ThemePreviewTarget {
  readonly current: DeckardTheme | undefined;
  show(theme: DeckardTheme | undefined, options?: { silent?: boolean }): void;
}

/**
 * What Choose Theme… runs in the extension: VS Code's quick pick and
 * settings, and `themePreview`, the one every page draws with.
 */
export function createChooseThemeDeps(themePreview: ThemePreviewTarget): ChooseThemeDeps {
  return {
    createQuickPick: () => vscode.window.createQuickPick<ThemeItem>(),
    writeTheme: (theme) => writeSetting('theme', theme, settingTarget('theme')),
    hasVisibleDeckardPage,
    openDashboard: () => vscode.commands.executeCommand('deckard.showDashboard'),
    preview: (theme, options) => themePreview.show(theme, options),
    current: () => getDeckardTheme(themePreview),
  };
}

/** Runs Choose Theme…, and returns the theme kept, if one was. */
export async function chooseTheme(
  manifest: ThemeManifest,
  deps: ChooseThemeDeps,
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

  return runPick(pick, deps, original);
}

/**
 * Shows a theme on the open pages once the picker's active row has rested
 * for `deps.delay`, so moving quickly through the list does not redraw every
 * page for each row passed. The theme in use is shown by clearing the preview.
 */
class RestingPreview {
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Previews through `deps`, treating `original` as no preview at all. */
  public constructor(
    private readonly deps: ChooseThemeDeps,
    private readonly original: DeckardTheme,
  ) {}

  /** Previews `theme` after the rest, replacing any preview still waiting. */
  public schedule(theme: DeckardTheme | undefined): void {
    this.cancel();
    if (!theme) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.deps.preview(theme === this.original ? undefined : theme);
    }, this.deps.delay ?? 120);
  }

  /** Drops a preview still waiting for its rest; nothing when none is. */
  public cancel(): void {
    if (this.timer === undefined) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Shows the picker and resolves when it is hidden: with the theme kept by
 * Enter, or undefined when it was dismissed, after putting the original back.
 */
function runPick(
  pick: vscode.QuickPick<ThemeItem>,
  deps: ChooseThemeDeps,
  original: DeckardTheme,
): Promise<DeckardTheme | undefined> {
  return new Promise((resolve) => {
    const preview = new RestingPreview(deps, original);
    let kept: DeckardTheme | undefined;
    const disposables = [
      pick.onDidChangeActive((active) => preview.schedule(active[0]?.theme)),
      pick.onDidAccept(async () => {
        preview.cancel();
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
        preview.cancel();
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
