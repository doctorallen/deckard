import * as vscode from 'vscode';

import { getDeckardTheme } from '../themes';
import type { ThemePreview } from '../themePreview';
import { affectsDisplayChoices, onDidChangePageWidth, readDisplayChoices, readZen } from '../../commands/displaySettings';
import type { PageChrome } from '../components';

/**
 * The look a page is written in, read now: the theme `themePreview` is
 * showing, else the configured one, whether Zen is on, and how cards and
 * tags are drawn. A host reads it each time it writes a page, so the page
 * builders read no settings.
 */
export function readPageChrome(themePreview?: { readonly current: PageChrome['theme'] | undefined }): PageChrome {
  return { theme: getDeckardTheme(themePreview), zen: readZen(), display: readDisplayChoices() };
}

/** Whether a settings change alters how a page is drawn rather than what it says. */
export function affectsPageChrome(event: vscode.ConfigurationChangeEvent): boolean {
  return (
    event.affectsConfiguration('deckard.theme') ||
    affectsDisplayChoices(event)
  );
}

/**
 * Calls back when a page has to be drawn again in another look: the theme or
 * a Display setting changed, the gear chose another page width, or Choose
 * Theme… is previewing a theme on `themePreview`. A page that redraws on
 * this needs no listener of its own for it.
 */
export function onDidChangePageChrome(
  listener: () => void,
  themePreview: Pick<ThemePreview, 'onDidChange'>,
): vscode.Disposable {
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (affectsPageChrome(event)) {
      listener();
    }
  });
  const preview = themePreview.onDidChange(listener);
  const width = onDidChangePageWidth(listener);
  return { dispose: () => { configuration.dispose(); preview.dispose(); width.dispose(); } };
}
