import * as vscode from 'vscode';

import { escapeHtml } from '../../../shared/html';
import { getPageTailCss } from '../components';
import type { DeckardTheme } from '../themeNames';

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
 * The folders under the extension a page may load from, its webview's
 * `localResourceRoots`: the built pages, and the icons and images in
 * `resources/`.
 */
export function pageResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
    vscode.Uri.joinPath(extensionUri, 'resources'),
  ];
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
  readonly webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>;
  /** The extension's folder, which `dist/webview/` is under. */
  readonly extensionUri: vscode.Uri;
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
}

/**
 * A page's document: its policy, then its style sheets, linked from
 * `dist/webview/` in cascade order (the page's own sheet, its theme, and the
 * tail every page lays last), then the body, marked for zen when it is on.
 * The host builds no style text: every rule is in a sheet esbuild built
 * from `src/webview/`.
 */
export function buildPageShell(options: PageShellOptions): string {
  const { webview, extensionUri, theme, zen } = options;
  const tail = getPageTailCss({ theme, zen });
  const links = [`${options.page}.css`, ...tail.sheets]
    .map((sheet) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', ...sheet.split('/'))))
    .map((uri) => `<link rel="stylesheet" href="${escapeHtml(uri.toString())}">`);
  const policy = getContentSecurityPolicy(webview.cspSource, options.nonce, options.csp);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    ...(options.title ? [`<title>${escapeHtml(options.title)}</title>`] : []),
    ...links,
    '</head>',
    `<body${tail.bodyAttribute}${options.bodyAttributes ?? ''}>${options.body}</body></html>`,
  ].join('\n');
}
