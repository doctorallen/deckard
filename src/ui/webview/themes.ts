import * as vscode from 'vscode';
import { DeckardTheme, deckardThemes } from './themeNames';

// The names live in themeNames.ts, so the preview can name a theme without
// VS Code; every module that reads them from here still does.
export { deckardThemeNames, deckardThemes } from './themeNames';
export type { DeckardTheme } from './themeNames';

/**
 * The theme the pages draw in: the one `preview` (the ThemePreview) is
 * showing, if any, and otherwise the configured theme, falling back when
 * workspace settings are stale. Without a preview, as for a page built
 * outside the extension, it is the configured theme.
 */
export function getDeckardTheme(preview?: { readonly current: DeckardTheme | undefined }): DeckardTheme {
  if (preview?.current) {
    return preview.current;
  }
  const configuredTheme = vscode.workspace
    .getConfiguration('deckard')
    .get<string>('theme', 'corpo');

  return isDeckardTheme(configuredTheme) ? configuredTheme : 'corpo';
}

/**
 * Each theme's sheet, under dist/webview: the tokens and surfaces a theme
 * lays after a page's own rules, built from src/webview/shared/themes.
 */
export const deckardThemeCss: Readonly<Record<DeckardTheme, string>> = {
  corpo: 'themes/corpo.css',
  replicant: 'themes/replicant.css',
  oblivion: 'themes/oblivion.css',
  lcars: 'themes/lcars.css',
  synthwave: 'themes/synthwave.css',
  tomcat: 'themes/tomcat.css',
  fellowship: 'themes/fellowship.css',
  cooper: 'themes/cooper.css',
};

function isDeckardTheme(value: string): value is DeckardTheme {
  return (deckardThemes as readonly string[]).includes(value);
}

