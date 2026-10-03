import * as path from 'path';

import type { ShellUri, ShellWebview } from '../ui/webview/host/pageShell';

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
 * A URI as the stand-in hands it out: its path, the file it names, and its
 * text. A page builder joins onto one with `with`, as it would a
 * `vscode.Uri`, so a page renders without the extension host.
 */
class StandInUri implements ShellUri {
  public constructor(
    public readonly path: string,
    /** The text the page is written with. */
    private readonly text: string,
    /** The file named, for a file URI; a webview URI names none. */
    public readonly fsPath?: string,
  ) {}

  /** A file URI for a path, written as `vscode.Uri.file` writes one on a POSIX system. */
  public static file(fsPath: string): StandInUri {
    return new StandInUri(fsPath, `file://${fsPath}`, fsPath);
  }

  /** The same kind of URI at another path, as `vscode.Uri.with` gives it. */
  public with(change: { path: string }): StandInUri {
    return this.fsPath === undefined ? new StandInUri(change.path, change.path) : StandInUri.file(change.path);
  }

  public toString(): string {
    return this.text;
  }
}

/**
 * The file a URI names. Under the e2e stub, `Uri.joinPath` writes the folder
 * it was given as a `file://` URI into `fsPath`, so that prefix is dropped.
 */
function filePathOf(uri: ShellUri & { fsPath?: string }): string {
  const named = String(uri.fsPath ?? uri.path ?? '');
  return named.startsWith('file://') ? named.slice('file://'.length) : named;
}

/**
 * A resource's webview URI: a file of the repository under {@link ORIGIN},
 * by its path from the repository's root. Anything outside the repository
 * comes back unchanged, as no page links one.
 */
function asWebviewUri(uri: ShellUri): ShellUri {
  const relative = path.relative(REPOSITORY_ROOT, filePathOf(uri));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return uri;
  }
  const address = `${ORIGIN}/${relative.split(path.sep).join('/')}`;
  return new StandInUri(address, address);
}

/** The stand-in webview: the CSP source and URI mapping VS Code would give a page. */
export const pageWebview: ShellWebview = {
  cspSource: ORIGIN,
  asWebviewUri,
};

/**
 * The extension's folder as a page sees it: the repository's root, as a
 * stand-in for `vscode.Uri.file`, so the page catalog runs without VS Code.
 * A host test that hands the folder to VS Code itself makes it with
 * `vscode.Uri.file(REPOSITORY_ROOT)`.
 */
export function pageExtensionUri(): ShellUri {
  return StandInUri.file(REPOSITORY_ROOT);
}
