import * as path from 'path';

import * as vscode from 'vscode';

/**
 * The one stand-in webview every page test renders against.
 *
 * A page links what it loads through `asWebviewUri`: icons and images today,
 * and its bundle and style sheets once the pages move to `dist/webview`
 * (decision 0001). A stand-in that handed out the resource unchanged, or a
 * made-up folder such as `/deckard`, would name a file no harness can read,
 * so a page that loads its script by URI would run nothing. This one hands
 * out every file of the repository under the origin the page loader reads
 * back (`test/harness/loadPage.js`), relative to the repository, so a page
 * gets the same URIs on every machine and its bundle is read from the build.
 */

/** The repository's root folder. The compiled tests run from `out/test`. */
export const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

/** The origin this stand-in hands URIs out under, which is also its `cspSource`. */
const ORIGIN = 'vscode-webview://deckard';

/**
 * The file a URI names. Under the e2e stub, `Uri.joinPath` writes the folder
 * it was given as a `file://` URI into `fsPath`, so that prefix is dropped.
 */
function filePathOf(uri: vscode.Uri): string {
  const named = String(uri.fsPath ?? uri.path ?? '');
  return named.startsWith('file://') ? named.slice('file://'.length) : named;
}

/**
 * A resource's webview URI: a file of the repository under {@link ORIGIN},
 * by its path from the repository's root. Anything outside the repository
 * comes back unchanged, as no page links one.
 */
function asWebviewUri(uri: vscode.Uri): vscode.Uri {
  const relative = path.relative(REPOSITORY_ROOT, filePathOf(uri));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return uri;
  }
  return vscode.Uri.parse(`${ORIGIN}/${relative.split(path.sep).join('/')}`);
}

/** The stand-in webview: the CSP source and URI mapping VS Code would give a page. */
export const pageWebview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'> = {
  cspSource: ORIGIN,
  asWebviewUri,
};

/** The extension's folder as a page sees it: the repository's root. */
export function pageExtensionUri(): vscode.Uri {
  return vscode.Uri.file(REPOSITORY_ROOT);
}
