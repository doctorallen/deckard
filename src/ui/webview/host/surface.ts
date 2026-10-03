import * as vscode from 'vscode';

import { panelPriority, viewPriority } from './panelPriority';

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
 * What a page's host talks to the page through: the two members a
 * host-controller test fakes, and all a message handler needs.
 */
export type PageWebview = Pick<vscode.Webview, 'postMessage' | 'onDidReceiveMessage'>;

/**
 * Where a page is shown, a panel in the editor area or a view in a side
 * bar, as its `WebviewHost` sees it. A panel and a view differ in what they
 * fire and how they rank for a redraw; this is what the host needs of
 * either.
 */
export interface WebviewSurface {
  readonly webview: PageWebview;
  /** Whether the reader can see the page now. */
  readonly visible: boolean;
  /** Whether the page is the editor in front; a view is never. */
  readonly active: boolean;
  /** Sets the page's HTML, built for this surface's webview. */
  render(html: (webview: vscode.Webview) => string): void;
  /** Fires when the page is shown, hidden, or brought to the front or sent back. */
  onDidChangeViewState(listener: () => void): vscode.Disposable;
  /** Fires when the reader closes the page. */
  onDidDispose(listener: () => void): vscode.Disposable;
  /** How soon the page redraws after the index changes; see `VIEW_PRIORITY`. */
  priority(): number;
  /** Closes the page, as disposing of its host does. */
  close(): void;
}

/** A webview panel in the editor area, as a page's surface. */
export class PanelSurface implements WebviewSurface {
  /**
   * Wraps a panel VS Code made or kept, ranked for a redraw by `rank`: in
   * front, then visible, then hidden, unless the page ranks otherwise.
   */
  public constructor(
    public readonly panel: vscode.WebviewPanel,
    private readonly rank: (panel: vscode.WebviewPanel) => number = panelPriority,
  ) {}

  /** Where the page's HTML and messages go. */
  public get webview(): vscode.Webview {
    return this.panel.webview;
  }

  /** Whether the panel's tab is showing. */
  public get visible(): boolean {
    return this.panel.visible;
  }

  /** Whether the panel is the editor in front. */
  public get active(): boolean {
    return this.panel.active;
  }

  /** Sets the panel's HTML. */
  public render(html: (webview: vscode.Webview) => string): void {
    this.panel.webview.html = html(this.panel.webview);
  }

  /** The panel's view-state event, which fires for visibility and for focus. */
  public onDidChangeViewState(listener: () => void): vscode.Disposable {
    return this.panel.onDidChangeViewState(() => listener());
  }

  /** The panel's close event. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    return this.panel.onDidDispose(() => listener());
  }

  /** How soon the panel redraws, by its rank. */
  public priority(): number {
    return this.rank(this.panel);
  }

  /** Closes the panel's tab. */
  public close(): void {
    this.panel.dispose();
  }
}

/** A webview view in a side bar, as a page's surface. */
export class ViewSurface implements WebviewSurface {
  /** Wraps a view VS Code resolved. */
  public constructor(public readonly view: vscode.WebviewView) {}

  /** Where the page's HTML and messages go. */
  public get webview(): vscode.Webview {
    return this.view.webview;
  }

  /** Whether the view is open in its side bar. */
  public get visible(): boolean {
    return this.view.visible;
  }

  /** A view is never the editor in front. */
  public get active(): boolean {
    return false;
  }

  /** Sets the view's HTML. */
  public render(html: (webview: vscode.Webview) => string): void {
    this.view.webview.html = html(this.view.webview);
  }

  /** The view's visibility event. */
  public onDidChangeViewState(listener: () => void): vscode.Disposable {
    return this.view.onDidChangeVisibility(() => listener());
  }

  /** The view's dispose event, when VS Code lets the view go. */
  public onDidDispose(listener: () => void): vscode.Disposable {
    return this.view.onDidDispose(() => listener());
  }

  /** Visible before hidden. */
  public priority(): number {
    return viewPriority(this.view);
  }

  /** A view is VS Code's to close, so this leaves it open. */
  public close(): void {
    return undefined;
  }
}

/**
 * Whether a page runs a script, and what a panel restored after a reload
 * keeps of the webview options it was made with: `on` sets scripts on and
 * nothing else; `merge` keeps the old options and sets scripts on; `off`
 * is a page with no script, whose options are left alone.
 */
export type PageScripts = 'on' | 'merge' | 'off';

/**
 * The webview options a page sets on a panel or view it is given: what its
 * `scripts` choice says (`on` when it made none), and, whatever it chose,
 * the folders under `extensionUri` it may load from, which hold its style
 * sheets and icons. A page with no script keeps the rest of what it had.
 */
export function scriptOptions(
  scripts: PageScripts | undefined,
  kept: vscode.WebviewOptions,
  extensionUri: vscode.Uri,
): vscode.WebviewOptions {
  const localResourceRoots = pageResourceRoots(extensionUri);
  if (scripts === 'off') {
    return { ...kept, localResourceRoots };
  }
  return scripts === 'merge'
    ? { ...kept, enableScripts: true, localResourceRoots }
    : { enableScripts: true, localResourceRoots };
}
