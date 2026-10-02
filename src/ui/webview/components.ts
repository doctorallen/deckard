/**
 * What the webview hosts share when they write a page's HTML: the loading
 * line a page shows before its state arrives, the sheets every page links
 * after its own, the event that redraws a page in another look, and the
 * nonce. The pages themselves are bundles built from src/webview, and what
 * they share is the Preact core in src/webview/shared (docs/components.md).
 */

import * as vscode from 'vscode';
import { deckardThemeCss } from './themes';
import type { ThemePreview } from './themePreview';
import { DeckardTheme } from './themeNames';

/**
 * What a page shows before its first state arrives: `#app`, busy, holding
 * one `.loading` line. `attributes` adds any the page's main carries.
 */
export function loadingHtml(label: string, attributes = ''): string {
  return `<main id="app"${attributes ? ` ${attributes}` : ''} aria-busy="true"><div class="loading" role="status"><span>${label}</span></div></main>`;
}

/** What a page lays over its own rules, and how its body is marked. */
export interface PageTail {
  /**
   * The sheets a page links after its own, under dist/webview, in cascade
   * order: its theme, then the tail (src/webview/shared/tail.css), which
   * holds control edges, provenance, high contrast, card tags, and zen.
   */
  readonly sheets: readonly string[];
  /** The marker the zen sheet hangs on, ` class="zen"`, or nothing. */
  readonly bodyAttribute: string;
}

/**
 * What every page puts after its own rules: the theme, then the tail, which
 * ends with zen. Kept in one place so "zen comes after the theme" is a fact
 * in the code rather than a convention ten pages have to remember. `theme`
 * is the one the page's host read, preview and all, and `zen` whether zen
 * mode is on; neither is read from the settings here.
 */
export function getPageTailCss(chrome: { theme: DeckardTheme; zen: boolean }): PageTail {
  return {
    sheets: [deckardThemeCss[chrome.theme], 'tail.css'],
    bodyAttribute: chrome.zen ? ' class="zen"' : '',
  };
}

/** Whether a settings change alters how a page is drawn rather than what it says. */
export function affectsPageChrome(event: vscode.ConfigurationChangeEvent): boolean {
  return (
    event.affectsConfiguration('deckard.theme') ||
    event.affectsConfiguration('deckard.zenMode')
  );
}

/**
 * Calls back when a page has to be drawn again in another look: the theme or
 * zen setting changed, or Choose Theme… is previewing a theme on
 * `themePreview`. A page that redraws on this needs no configuration
 * listener of its own for it.
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
  return { dispose: () => { configuration.dispose(); preview.dispose(); } };
}

/**
 * A per-webview nonce for the page's scripts.
 */
export function createNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

