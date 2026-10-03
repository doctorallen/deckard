/**
 * What the webview hosts share when they write a page's HTML: the loading
 * line a page shows before its state arrives, the sheets every page links
 * after its own, and the nonce. The pages themselves are bundles built from
 * src/webview, and what they share is the Preact core in src/webview/shared
 * (docs/components.md). Nothing here reads the settings: the event that
 * redraws a page in another look is in host/pageChrome.ts.
 */

import { DeckardTheme } from './themeNames';

/**
 * The look a page is written in: the theme its host read, preview and all,
 * and whether zen mode is on. The host reads both as it writes the page;
 * a page builder is given them.
 */
export interface PageChrome {
  theme: DeckardTheme;
  zen: boolean;
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
export function getPageTailCss(chrome: PageChrome): PageTail {
  return {
    sheets: [deckardThemeCss[chrome.theme], 'tail.css'],
    bodyAttribute: chrome.zen ? ' class="zen"' : '',
  };
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

