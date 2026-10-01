import * as vscode from 'vscode';

import type { MessageMap } from '../../protocol/messaging';
import { scriptOptions, ViewSurface } from './surface';
import type { WebviewHost } from './webviewHost';

/**
 * Shows a page as a webview view in a side bar. VS Code resolves the view
 * when it is first shown, and again if it let the old one go; each time,
 * the host lets go of the old one and attaches the new, and sends the
 * snapshot once the index has notes to show.
 */
export class ViewAdapter<TSnapshot, TPageToHost extends MessageMap<TPageToHost>>
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  /** Shows `host`'s page in the views VS Code resolves. */
  public constructor(public readonly host: WebviewHost<TSnapshot, TPageToHost>) {}

  /** The view VS Code is showing the page in, while it has one. */
  public get view(): vscode.WebviewView | undefined {
    const surface = this.host.surface;
    return surface instanceof ViewSurface ? surface.view : undefined;
  }

  /** Attaches the view VS Code made, then draws it once there are notes. */
  public resolveWebviewView(view: vscode.WebviewView): void {
    this.host.detach();
    const options = scriptOptions(this.host.controller.options.scripts, view.webview.options);
    if (options) {
      view.webview.options = options;
    }
    this.host.attach(new ViewSurface(view));
    void this.host.whenPublished().then(() => this.host.refresh());
  }

  /** Stops the page's listeners; the view itself is VS Code's to close. */
  public dispose(): void {
    this.host.dispose();
  }
}
