import * as vscode from 'vscode';
import { DeckardTheme, deckardThemes } from './themeNames';

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

function isDeckardTheme(value: string): value is DeckardTheme {
  return (deckardThemes as readonly string[]).includes(value);
}

