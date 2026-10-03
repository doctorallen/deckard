import { posix } from 'path';

import { escapeHtml } from '../../../shared/html';
import { getPageTailCss } from '../components';
import { type DeckardTheme, deckardThemeNames } from '../themeNames';

/**
 * A URI as the shell joins and writes it: a `vscode.Uri`, or the stand-in a
 * test renders with. The shell names no `vscode` type, so a page builds
 * without the extension host.
 */
export interface ShellUri {
  readonly path: string;
  with(change: { path: string }): ShellUri;
  toString(): string;
}

/** The webview a page is written for, as much of it as the shell reads. */
export interface ShellWebview {
  /** The origin the page's policy lets its sheets and images load from. */
  readonly cspSource: string;
  asWebviewUri(uri: ShellUri): ShellUri;
}

/**
 * A file under the extension's folder, joined as `vscode.Uri.joinPath`
 * joins one: the segments are joined onto the URI's path, and the rest of
 * the URI is kept. (On Windows VS Code joins a `file` URI through its file
 * path, which gives the same path for the plain segments a page names.)
 */
export function joinUnder(base: ShellUri, ...segments: string[]): ShellUri {
  return base.with({ path: posix.join(base.path, ...segments) });
}

/**
 * What a page's Content Security Policy grants beyond scripts by nonce and
 * styles from the extension: images from the extension and the origins
 * listed, or any HTTPS origin for `true`; fonts from the extension; and, for
 * `scripts: false`, no script at all. Each page's builder passes it to
 * `buildPageShell`.
 */
export interface ContentSecurityExtras {
  readonly images?: readonly string[] | true;
  readonly fonts?: boolean;
  /** False for a page that runs no script, whose policy then names no `script-src`. */
  readonly scripts?: boolean;
}

/**
 * The Content Security Policy every page is drawn under, so no page's
 * policy drifts from another's. Style sheets load only from the extension
 * (`cspSource`), and no style is inline. Scripts run only with the page's
 * nonce, unless the page runs none, when the policy names no `script-src`
 * and every script falls to `default-src 'none'`. Images load from the
 * extension, and from the origins `extras.images` names, or from any HTTPS
 * origin when it is `true`; a page that shows none gets no `img-src`.
 * Fonts load from the extension only on a page that asks for them.
 */
export function getContentSecurityPolicy(
  cspSource: string,
  nonce: string,
  extras: ContentSecurityExtras = {},
): string {
  const directives = [`default-src 'none'`, `style-src ${cspSource}`];
  if (extras.scripts !== false) {
    directives.push(`script-src 'nonce-${nonce}'`);
  }
  if (extras.images) {
    const origins = extras.images === true ? ['https:'] : extras.images;
    directives.push([`img-src ${cspSource}`, ...origins].join(' '));
  }
  if (extras.fonts) {
    directives.push(`font-src ${cspSource}`);
  }
  return `${directives.join('; ')};`;
}

/** What a page's document is built from. */
export interface PageShellOptions {
  readonly webview: ShellWebview;
  /** The extension's folder, which `dist/webview/` is under. */
  readonly extensionUri: ShellUri;
  /** The page's name in `dist/webview/`, where its sheet is `<page>.css`. */
  readonly page: string;
  /** The document's title, for a page that has one. */
  readonly title?: string;
  /** The nonce the page's scripts carry, which its policy names. */
  readonly nonce: string;
  /** The theme the page draws in: the one its host read, preview and all. */
  readonly theme: DeckardTheme;
  /** Whether zen mode is on, which marks the body. */
  readonly zen: boolean;
  /** What the page's policy grants beyond the default; see `getContentSecurityPolicy`. */
  readonly csp?: ContentSecurityExtras;
  /** Attributes the body carries after the zen class, written as HTML, such as Help's anchor. */
  readonly bodyAttributes?: string;
  /** What the body holds, as HTML. */
  readonly body: string;
  /**
   * Whether the page's script is its bundle, `dist/webview/<page>.js`,
   * loaded with the nonce last in the body, rather than a script its body
   * holds. The head then names the theme for the page's gear.
   */
  readonly bundle?: boolean;
  /**
   * The snapshot the page draws on its first frame, carried as inert JSON
   * in `<script type="application/json" id="state">` before the bundle
   * (decision 0005); absent for a page that shows its loading line until
   * its host posts one.
   */
  readonly state?: unknown;
}

/**
 * A snapshot as inert JSON for a page's shell. Every `<` is escaped, so no
 * note's text can close the block or open a comment; JSON reads `\u003c`
 * back as `<`.
 */
export function inertJson(state: unknown): string {
  return `<script type="application/json" id="state">${JSON.stringify(state).replace(/</g, '\\u003c')}</script>`;
}

/**
 * What a bundled page's body ends with: its first snapshot, when it has
 * one, then its script, loaded from `dist/webview/` with the page's nonce.
 */
function bundleTail(options: PageShellOptions): string {
  if (!options.bundle) {
    return '';
  }
  const script = options.webview.asWebviewUri(joinUnder(options.extensionUri, 'dist', 'webview', `${options.page}.js`));
  const state = options.state === undefined ? '' : inertJson(options.state);
  return `${state}<script nonce="${options.nonce}" src="${escapeHtml(script.toString())}"></script>\n`;
}

/**
 * A page's document: its policy, then its style sheets, linked from
 * `dist/webview/` in cascade order (the page's own sheet, its theme, and the
 * tail every page lays last), then the body, marked for zen when it is on,
 * ending with the page's bundle for a page that has one.
 * The host builds no style text: every rule is in a sheet esbuild built
 * from `src/webview/`. A bundled page's body ends with its first snapshot,
 * if it has one, and its script.
 */
export function buildPageShell(options: PageShellOptions): string {
  const { webview, extensionUri, theme, zen } = options;
  const tail = getPageTailCss({ theme, zen });
  const links = [`${options.page}.css`, ...tail.sheets]
    .map((sheet) => `<link rel="stylesheet" href="${escapeHtml(pageAsset(webview, extensionUri, sheet))}">`);
  const policy = getContentSecurityPolicy(webview.cspSource, options.nonce, options.csp);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    ...(options.title ? [`<title>${escapeHtml(options.title)}</title>`] : []),
    ...(options.bundle ? [`<meta name="deckard-theme" content="${escapeHtml(deckardThemeNames[theme])}">`] : []),
    ...links,
    '</head>',
    `<body${tail.bodyAttribute}${options.bodyAttributes ?? ''}>${options.body}${bundleTail(options)}</body></html>`,
  ].join('\n');
}

/** A file under `dist/webview/`, such as `help.js` or `themes/cooper.css`, as the page loads it. */
function pageAsset(webview: ShellWebview, extensionUri: ShellUri, file: string): string {
  return webview.asWebviewUri(joinUnder(extensionUri, 'dist', 'webview', ...file.split('/'))).toString();
}
