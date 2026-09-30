import * as vscode from 'vscode';
import { onDidChangePageChrome } from './components';
import { getDeckardTheme } from './themes';
import { ThemePreview } from './themePreview';

import { GUIDE_PAGES, isGuidePage, renderGuidePage } from './guide';
import { getHelpHtml, HelpManifest, isRunnableFromHelp } from './helpHtml';
import { parseHelpMessage } from './messages';
import { Release } from '../../core/changelog';
import { WhatsNew } from '../commands/whatsNew';

/**
 * Hosts Deckard's self-contained product guide in a reusable webview panel.
 */
export class HelpPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    /** The theme Choose Theme… is previewing, which the page draws in. */
    private readonly themePreview: ThemePreview,
    /**
     * What the extension contributes, so the commands and settings tables
     * describe this version rather than a copy written beside them.
     */
    private readonly manifest: HelpManifest = {},
    /** The shipped changelog's Highlights, for What's new. */
    private readonly whatsNew?: Pick<WhatsNew, 'releases' | 'newSince'>,
  ) {}

  /** Opens Help, at a section when one is named, such as `whats-new`. */
  public async show(anchor?: string): Promise<void> {
    if (!this.panel) {
      await this.loadReleases();
      this.createPanel(anchor);
    } else if (anchor) {
      void this.panel.webview.postMessage({ type: 'reveal', anchor });
    }
    this.panel?.reveal(vscode.ViewColumn.Active);
  }

  private releases: Release[] = [];

  private async loadReleases(): Promise<void> {
    this.releases = (await this.whatsNew?.releases()) ?? [];
  }

  private html(webview: vscode.Webview, anchor?: string): string {
    const newSince = this.whatsNew?.newSince();
    return getHelpHtml(webview, this.extensionUri, this.manifest, {
      releases: this.releases,
      ...(newSince ? { newSince } : {}),
      ...(anchor ? { anchor } : {}),
      theme: getDeckardTheme(this.themePreview),
    });
  }

  public async restore(panel: vscode.WebviewPanel): Promise<void> {
    if (this.panel) {
      panel.dispose();
      return;
    }
    await this.loadReleases();
    this.attachPanel(panel);
  }

  public dispose(): void {
    this.disposePanelListeners();
    this.panel?.dispose();
  }

  private createPanel(anchor?: string): void {
    const panel = vscode.window.createWebviewPanel(
      'deckard.help',
      'Deckard Help',
      vscode.ViewColumn.Active,
      {
        // The page's own script marks the section being read in the rail.
        enableScripts: true,
        enableFindWidget: true,
        retainContextWhenHidden: true,
      },
    );
    this.attachPanel(panel, anchor);
  }

  private attachPanel(panel: vscode.WebviewPanel, anchor?: string): void {
    this.panel = panel;
    // A panel restored after a reload keeps the options it was made with,
    // which before 1.23 had no scripts.
    panel.webview.options = { ...panel.webview.options, enableScripts: true };
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'deckard.svg',
    );
    panel.webview.html = this.html(panel.webview, anchor);
    this.panelDisposables = [
      onDidChangePageChrome(() => {
        if (this.panel) {
          this.panel.webview.html = this.html(this.panel.webview);
        }
      }, this.themePreview),
      panel.webview.onDidReceiveMessage((message: unknown) => this.handle(message)),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposePanelListeners();
      }),
    ];
  }

  /** Runs a command the page names, when Help is allowed to run it. */
  public async handle(value: unknown): Promise<void> {
    const message = parseHelpMessage(value);
    if (message?.type === 'runCommand' && isRunnableFromHelp(this.manifest, message.command)) {
      await vscode.commands.executeCommand(message.command);
    } else if (message?.type === 'openGuide') {
      await this.showGuide(message.page, message.anchor);
    } else if (message?.type === 'openChangelog') {
      await vscode.commands.executeCommand(
        'markdown.showPreview',
        vscode.Uri.joinPath(this.extensionUri, 'CHANGELOG.md'),
      );
    }
  }

  /**
   * Shows a guide page in the panel, read from the copy the VSIX ships. A
   * page that cannot be read says so where the page would be.
   */
  private async showGuide(page: string, anchor?: string): Promise<void> {
    if (!this.panel || !isGuidePage(page)) {
      return;
    }
    let html: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.extensionUri, 'docs', 'guide', `${page}.md`),
      );
      html = renderGuidePage(Buffer.from(bytes).toString('utf8'));
    } catch {
      html = '<p>Deckard could not read this page of the guide. It is also on GitHub, at <a href="https://github.com/doctorallen/deckard/blob/master/docs/guide/' + page + '.md">docs/guide/' + page + '.md</a>.</p>';
    }
    void this.panel.webview.postMessage({
      type: 'guide',
      page,
      title: GUIDE_PAGES[page],
      html,
      ...(anchor ? { anchor } : {}),
    });
  }

  private disposePanelListeners(): void {
    this.panelDisposables
      .splice(0)
      .forEach((disposable) => disposable.dispose());
  }
}
