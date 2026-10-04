import * as vscode from 'vscode';

import type { MessageMap } from '../../protocol/messaging';
import { pageResourceRoots, PanelSurface, scriptOptions } from './surface';
import type { WebviewHost } from './webviewHost';

/** The panel a page opens in: its type, its tab's title, and its tab's icon. */
export interface PanelAdapterOptions {
  /** The panel's view type, which its serializer is registered under. */
  viewType: string;
  title: string;
  extensionUri: vscode.Uri;
  /** The tab's icon, as a path under the extension, such as `['resources', 'deckard.svg']`. */
  icon: readonly string[];
  /**
   * How soon the panel redraws after the index changes; `panelPriority` by
   * default. The Calendar page ranks itself as a side view does.
   */
  priority?: (panel: vscode.WebviewPanel) => number;
}

/**
 * Keeps a page in at most one editor panel: it opens the panel, takes back
 * one VS Code kept across a reload, and attaches it to the page's host.
 * Showing the page again reveals the panel it has.
 */
export class PanelAdapter<TSnapshot, TPageToHost extends MessageMap<TPageToHost>>
  implements vscode.Disposable
{
  /** Keeps `host`'s page in the panel `options` describe. */
  public constructor(
    public readonly host: WebviewHost<TSnapshot, TPageToHost>,
    private readonly options: PanelAdapterOptions,
  ) {}

  /** The page's panel, while it is open. */
  public get panel(): vscode.WebviewPanel | undefined {
    const surface = this.host.surface;
    return surface instanceof PanelSurface ? surface.panel : undefined;
  }

  /**
   * Opens the page, or brings its panel to the front, and sends it its
   * snapshot once the index has notes to show.
   */
  public async show(): Promise<void> {
    this.open();
    this.panel?.reveal(vscode.ViewColumn.Active);
    await this.host.whenPublished();
    this.host.refresh();
  }

  /**
   * The page's panel, made and attached first when it has none, but not
   * brought forward or sent anything: for a page whose showing differs
   * from `show`'s. A new panel opens where `where` says, the active group
   * unless told.
   */
  public open(where: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean } = vscode.ViewColumn.Active): vscode.WebviewPanel {
    const open = this.panel;
    if (open) {
      return open;
    }
    const { retainContextWhenHidden, enableFindWidget, scripts = 'on' } = this.host.controller.options;
    const panel = vscode.window.createWebviewPanel(
      this.options.viewType,
      this.options.title,
      where,
      {
        ...(scripts === 'off' ? {} : { enableScripts: true }),
        retainContextWhenHidden,
        ...(enableFindWidget ? { enableFindWidget: true } : {}),
        localResourceRoots: pageResourceRoots(this.options.extensionUri),
      },
    );
    this.attach(panel);
    return panel;
  }

  /**
   * Takes back a panel VS Code kept across a reload, with what the page
   * saved, unless the page is already open, when the kept one is closed.
   */
  public async restore(panel: vscode.WebviewPanel, state?: unknown): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }
    const restoring = this.host.controller.options.restore?.(state);
    if (restoring) {
      await restoring;
    }
    this.attach(panel);
    await this.host.whenPublished();
    this.host.refresh();
  }

  /** Closes the panel, if it is open, and stops the page's listeners. */
  public dispose(): void {
    this.host.dispose();
  }

  /**
   * Gives a new or restored panel its icon, its scripts and the folders it
   * may load from, and the page. A panel restored after a reload keeps the
   * options it was made with, so they are set here too.
   */
  private attach(panel: vscode.WebviewPanel): void {
    panel.iconPath = vscode.Uri.joinPath(this.options.extensionUri, ...this.options.icon);
    panel.webview.options = scriptOptions(
      this.host.controller.options.scripts,
      panel.webview.options,
      this.options.extensionUri,
    );
    this.host.attach(new PanelSurface(panel, this.options.priority));
  }
}
