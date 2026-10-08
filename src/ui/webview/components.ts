/**
 * What the webview hosts share when they write a page's HTML: the loading
 * line a page shows before its state arrives, the sheets every page links
 * after its own, and the nonce. The pages themselves are bundles built from
 * src/webview, and what they share is the Preact core in src/webview/shared
 * (docs/components.md). Nothing here reads the settings: the event that
 * redraws a page in another look is in host/pageChrome.ts.
 */

import { escapeHtml } from '../../shared/html';
import { ZEN_CHOICES, type DisplayChoices } from '../state/displayLevel';
import { DeckardTheme } from './themeNames';

export type { DisplayChoices };



/**
 * The look a page is written in: the theme its host read, preview and all,
 * whether zen mode is on, and how cards and tags are drawn. The host reads
 * them as it writes the page; a page builder is given them.
 */
export interface PageChrome {
  theme: DeckardTheme;
  zen: boolean;
  display?: DisplayChoices;
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
  /**
   * The markers the tail's sheets hang on: ` class="zen"`, and
   * ` data-cards="flat"` and ` data-tags="text"` for those choices, or
   * nothing.
   */
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
    bodyAttribute: bodyMarkers(chrome),
  };
}

/**
 * The body's markers: the zen class while Zen is on, and one data attribute
 * for each display value that isn't the default. A host always gives the
 * values it resolved; given none, zen stands for what Zen turns on.
 */
function bodyMarkers(chrome: PageChrome): string {
  const display: DisplayChoices = chrome.display ?? (chrome.zen ? ZEN_CHOICES : {});
  return [
    chrome.zen ? ' class="zen"' : '',
    display.styling === 'plain' ? ' data-styling="plain"' : '',
    display.help === 'hidden' ? ' data-help="hidden"' : '',
    display.density === 'compact' ? ' data-density="compact"' : '',
    display.cards === 'flat' ? ' data-cards="flat"' : '',
    display.tags === 'text' ? ' data-tags="text"' : '',
    display.controls === 'quiet' ? ' data-controls="quiet"' : '',
    detailMarkers(display),
    display.width === 'full' ? ' data-width="full"' : '',
    dateMarkers(display),
  ].join('');
}

/**
 * The markers for how dates read, each only when it isn't the default: the
 * two formats, written as attribute text since the reader typed them, the
 * language `L` to `llll` follow, and the week start `w` counts from.
 */
function dateMarkers(display: DisplayChoices): string {
  return [
    display.dateFormat ? ` data-date-format="${escapeHtml(display.dateFormat)}"` : '',
    display.shortDateFormat ? ` data-short-date-format="${escapeHtml(display.shortDateFormat)}"` : '',
    display.dateLocale ? ` data-date-locale="${escapeHtml(display.dateLocale)}"` : '',
    display.weekStart ? ` data-week-start="${display.weekStart}"` : '',
  ].join('');
}

/** The markers for an entry's details: when they show, and which. */
function detailMarkers(display: DisplayChoices): string {
  return [
    display.fileAndLine ? ` data-file-line="${display.fileAndLine}"` : '',
    display.details ? ` data-details="${display.details}"` : '',
  ].join('');
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

