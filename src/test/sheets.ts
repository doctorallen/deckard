import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * The style sheets a page draws with, read as written under src/webview,
 * for the tests that assert on CSS text. A page's shell links its sheets
 * from dist/webview, which esbuild builds and reformats; the tests read the
 * sources instead, so a rule is found as its author wrote it.
 */

/** The page code's folder, from the compiled tests in out/test. */
const WEBVIEW_SOURCE = path.resolve(__dirname, '..', '..', 'src', 'webview');

/** A sheet as written, by its path under src/webview, such as `shared/zen.css`. */
export function readSheet(name: string): string {
  return readFileSync(path.join(WEBVIEW_SOURCE, name), 'utf8');
}

/** A theme's sheet as written. */
export function themeSheet(theme: string): string {
  return readSheet(`shared/themes/${theme}.css`);
}

/**
 * A sheet with each `@import` replaced by the sheet it names, in place, as
 * esbuild bundles it: every rule a page that links it draws with.
 */
export function expandSheet(name: string): string {
  return readSheet(name).replace(/@import\s+"([^"]+)";/g, (_whole, target: string) =>
    expandSheet(path.posix.join(path.posix.dirname(name), target)),
  );
}

/** The sheets a page's shell links, by path under dist/webview, in cascade order. */
export function linkedSheets(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="[^"]*\/dist\/webview\/([^"]+)">/g)].map((match) => match[1]);
}

/**
 * Where a sheet a page links from dist/webview is written: a page's under
 * its folder, a theme's and the tail under `shared`.
 */
export function sheetSource(linked: string): string {
  if (linked.startsWith('themes/') || linked === 'tail.css') {
    return `shared/${linked}`;
  }
  return `${linked.replace(/\.css$/, '')}/page.css`;
}

/** Every rule a page draws with, as written: the sheets it links, in order, each with its imports in place. */
export function pageSheets(html: string): string {
  return linkedSheets(html)
    .map((sheet) => expandSheet(sheetSource(sheet)))
    .join('\n');
}

/**
 * A page's HTML followed by every rule it draws with, as written: the text
 * a test of a template page reads, script, markup, and CSS together, now
 * that the CSS is in files.
 */
export function withSheets(html: string): string {
  return `${html}\n${pageSheets(html)}`;
}
