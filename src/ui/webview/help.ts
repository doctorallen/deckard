import * as vscode from 'vscode';

import type { HelpMessage, HelpPageToHost, HelpRevealMessage, HelpTab } from '../protocol/help';
import type { IndexReader } from '../../core/workspace/indexReader';
import type { WhatsNew } from '../commands/whatsNew';
import { helpPlace } from './guide';
import type { HelpManifest } from './pages/help/helpManifest';
import type { MessageHandler } from './host/pageController';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import { HelpController, type HelpThisPagePort, type HelpTourPort } from './pages/help/helpController';
import type { ThemePreview } from './themePreview';

/** What Help is drawn from. */
export interface HelpPanelOptions {
  extensionUri: vscode.Uri;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /**
   * What the extension contributes, so a command a guide page names runs
   * from Help only when it may. Without it, none runs.
   */
  manifest?: HelpManifest;
  /** The shipped changelog's Highlights, for What's new. */
  whatsNew?: Pick<WhatsNew, 'releases' | 'newSince'>;
  /** What DECKARD's menu at the top of Help reads its hints from. */
  indexer?: Pick<IndexReader, 'getSnapshot'>;
  /** What This page reads and changes (plan 48). */
  thisPage?: HelpThisPagePort;
}

/** Where Help opens: for a page, which This page explains, or on a tab. */
export interface HelpShowOptions {
  /** The page that asked, by its host's name: Help opens beside it, on This page when it has a map. */
  forPage?: string;
  tab?: HelpTab;
}

/**
 * Hosts Deckard's guide, docs/guide, in a reusable webview panel.
 *
 * The page is `HelpController`, run by a `WebviewHost` in one panel; this
 * is the name the extension and its serializer know it by.
 */
export class HelpPanel implements vscode.Disposable {
  private readonly controller: HelpController;
  private readonly page: PanelAdapter<never, HelpPageToHost>;

  /** Builds the page; nothing is shown until `show` or `restore`. */
  public constructor({ extensionUri, themePreview, manifest = {}, whatsNew, indexer, thisPage }: HelpPanelOptions) {
    this.controller = new HelpController({ extensionUri, manifest, whatsNew, indexer, thisPage });
    this.page = new PanelAdapter(
      new WebviewHost<never, HelpPageToHost>(this.controller, { themePreview }),
      { viewType: 'deckard.help', title: 'Deckard Help', extensionUri, icon: ['resources', 'deckard.svg'] },
    );
  }

  /**
   * Opens Help, at a place when one is named: `whats-new`, a guide page by
   * its file name, or a section of the old quick glance, such as
   * `periodic`, at the guide page that holds it now (`helpPlace`). A new
   * panel is drawn at it, and so is a hidden one, whose page is not running
   * to be asked and is loaded again when shown; a visible one is asked to
   * show it.
   */
  public async show(anchor?: string, options: HelpShowOptions = {}): Promise<void> {
    const panel = this.page.panel;
    const place = anchor ? helpPlace(anchor) : undefined;
    const hasMap = options.forPage !== undefined && this.controller.askFrom(options.forPage);
    const tab: HelpTab = options.tab ?? (hasMap ? 'page' : 'guide');
    // Asked from a page, or for the Tour, Help docks beside the page so it stays in view.
    const beside = options.forPage !== undefined || tab === 'tour';
    if (!panel) {
      await this.controller.loadReleases();
      this.controller.drawingAt(place, () => this.page.open(beside ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true } : vscode.ViewColumn.Active), tab);
      return;
    }
    if (!panel.visible) {
      this.controller.drawingAt(place, () => this.page.host.renderHtml(), tab);
    } else if (place || tab !== 'guide') {
      const reveal: HelpRevealMessage = { type: 'reveal', ...(place ?? { page: '' }), tab };
      this.page.host.post(reveal);
    }
    if (beside) {
      panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Beside, true);
    } else {
      panel.reveal(vscode.ViewColumn.Active);
    }
  }

  /** Closes Help's panel, keeping the page ready to open again, as the Tour does while presenting. */
  public close(): void {
    this.page.panel?.dispose();
  }

  /** Gives Help the Tour, which is made after it. */
  public setTour(tour: HelpTourPort): void {
    this.controller.setTour(tour);
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
