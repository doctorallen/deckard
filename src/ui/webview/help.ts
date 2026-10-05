import * as vscode from 'vscode';

import type { HelpMessage, HelpPageToHost, HelpRevealMessage } from '../protocol/help';
import type { IndexReader } from '../../core/workspace/indexReader';
import type { WhatsNew } from '../commands/whatsNew';
import type { HelpManifest } from './pages/help/helpManifest';
import type { MessageHandler } from './host/pageController';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import { HelpController } from './pages/help/helpController';
import type { ThemePreview } from './themePreview';

/** What Help is drawn from. */
export interface HelpPanelOptions {
  extensionUri: vscode.Uri;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /**
   * What the extension contributes, so the commands and settings tables
   * describe this version rather than a copy written beside them. Without
   * it, the tables are empty.
   */
  manifest?: HelpManifest;
  /** The shipped changelog's Highlights, for What's new. */
  whatsNew?: Pick<WhatsNew, 'releases' | 'newSince'>;
  /** What DECKARD's menu at the top of Help reads its hints from. */
  indexer?: Pick<IndexReader, 'getSnapshot'>;
}

/**
 * Hosts Deckard's self-contained product guide in a reusable webview panel.
 *
 * The page is `HelpController`, run by a `WebviewHost` in one panel; this
 * is the name the extension and its serializer know it by.
 */
export class HelpPanel implements vscode.Disposable {
  private readonly controller: HelpController;
  private readonly page: PanelAdapter<never, HelpPageToHost>;

  /** Builds the page; nothing is shown until `show` or `restore`. */
  public constructor({ extensionUri, themePreview, manifest = {}, whatsNew, indexer }: HelpPanelOptions) {
    this.controller = new HelpController({ extensionUri, manifest, whatsNew, indexer });
    this.page = new PanelAdapter(
      new WebviewHost<never, HelpPageToHost>(this.controller, { themePreview }),
      { viewType: 'deckard.help', title: 'Deckard Help', extensionUri, icon: ['resources', 'deckard.svg'] },
    );
  }

  /**
   * Opens Help, at a section when one is named, such as `whats-new`. A new
   * panel is drawn at it, and so is a hidden one, whose page is not running
   * to be asked and is loaded again when shown; a visible one is asked to
   * show it.
   */
  public async show(anchor?: string): Promise<void> {
    const panel = this.page.panel;
    if (!panel) {
      await this.controller.loadReleases();
      this.controller.drawingAt(anchor, () => this.page.open());
    } else if (anchor && !panel.visible) {
      this.controller.drawingAt(anchor, () => this.page.host.renderHtml());
    } else if (anchor) {
      const reveal: HelpRevealMessage = { type: 'reveal', anchor };
      this.page.host.post(reveal);
    }
    this.page.panel?.reveal(vscode.ViewColumn.Active);
  }

  /** Takes back the Help panel VS Code kept across a reload, with What's new read again. */
  public restore(panel: vscode.WebviewPanel): Promise<void> {
    return this.page.restore(panel);
  }

  /** Closes Help, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }

  /**
   * Acts on a message as one from the page is acted on: a command runs
   * only when Help is allowed to run it.
   */
  public async handle(value: unknown): Promise<void> {
    const message = this.controller.narrow(value);
    if (!message) {
      return;
    }
    const handler = this.controller.handlers[message.type] as MessageHandler<HelpMessage>;
    await handler(message, this.page.host);
  }
}
