import * as vscode from 'vscode';

import type { WorkspaceIndex } from '../../domain/model';
import type { PagesViewPageToHost, PagesViewSnapshot } from '../protocol/pagesView';
import { ViewAdapter } from './host/viewAdapter';
import { WebviewHost } from './host/webviewHost';
import { PagesViewController } from './pages/pagesView/pagesViewController';
import type { ThemePreview } from './themePreview';

/** The index Pages reads its hints from and redraws on. */
interface PagesIndexSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  readonly onDidUpdate: vscode.Event<unknown>;
  getSnapshot(): WorkspaceIndex;
}

/** What Pages is built from. */
export interface PagesViewOptions {
  indexer: PagesIndexSource;
  /** The theme Choose Theme… is previewing, which the view draws in. */
  themePreview: ThemePreview;
  /** The extension's folder, which the view's style sheets are under. */
  extensionUri: vscode.Uri;
}

/**
 * The Pages view, as a webview in the Deckard sidebar, so it can be a list
 * or a row of icons. The page is `PagesViewController`, run by a
 * `WebviewHost` in the view VS Code resolves; this is the name the
 * extension registers it by.
 */
export class PagesView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly page: ViewAdapter<PagesViewSnapshot, PagesViewPageToHost>;

  /** Builds the view; nothing is drawn until VS Code resolves it. */
  public constructor(options: PagesViewOptions) {
    const controller = new PagesViewController({ indexer: options.indexer, extensionUri: options.extensionUri });
    this.page = new ViewAdapter(new WebviewHost(controller, { indexer: options.indexer, themePreview: options.themePreview }), options.extensionUri);
  }

  /** Draws Pages in the view VS Code made. */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.page.resolveWebviewView(webviewView);
  }

  /** Stops every listener; the view is VS Code's to close. */
  public dispose(): void {
    this.page.dispose();
  }
}
