import * as vscode from 'vscode';

import type { Release } from '../../../../core/changelog';
import type { HelpGuideMessage, HelpPageToHost } from '../../../protocol/help';
import type { WhatsNew } from '../../../commands/whatsNew';
import { GUIDE_PAGES, isGuidePage } from '../../guide';
import { getHelpHtml } from '../../helpHtml';
import { guideUnavailableHtml, renderGuidePage, warmGuideRenderer } from './guidePage';
import { HelpManifest, isRunnableFromHelp } from './helpManifest';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import type { DeckardTheme } from '../../themeNames';
import { narrowHelpMessage } from './messages';

/** What Help is drawn from. */
export interface HelpControllerOptions {
  extensionUri: vscode.Uri;
  /**
   * What the extension contributes, so the commands and settings tables
   * describe this version rather than a copy written beside them.
   */
  manifest: HelpManifest;
  /** The shipped changelog's Highlights, for What's new. */
  whatsNew?: Pick<WhatsNew, 'releases' | 'newSince'>;
}

/**
 * The Help page: Deckard's self-contained product guide, drawn by the host
 * from the manifest and the changelog. It is sent no snapshot; it asks to
 * run a command, to read a guide page in place, or to open the changelog.
 */
export class HelpController implements PageController<never, HelpPageToHost> {
  public readonly name = 'Help';
  public readonly options: PageOptions;
  public readonly narrow = narrowHelpMessage;
  public readonly handlers: MessageHandlers<HelpPageToHost>;
  /** What's new's releases, read when Help opens and drawn from then on. */
  private releases: Release[] = [];
  /** The section the HTML being drawn opens at, while one is asked for. */
  private anchor: string | undefined;

  /** Draws from `help.manifest` and `help.whatsNew`, and reads the guide under `help.extensionUri`. */
  public constructor(private readonly help: HelpControllerOptions) {
    this.options = {
      // Help is not kept running while hidden (Q1 of the webviews plan): its
      // page saves the guide page it shows and its scroll with setState, and
      // comes back there when shown.
      retainContextWhenHidden: false,
      enableFindWidget: true,
      // The page's own script marks the section being read in the rail. A
      // panel restored after a reload keeps the options it was made with,
      // which before 1.23 had no scripts, so they are kept and scripts set.
      scripts: 'merge',
      // A theme or zen change draws Help again from the top; it has no
      // snapshot to send.
      onChromeChange: 'reload',
      // Help is drawn whole in its HTML, so a restore or a show refreshes
      // nothing and writes nothing to the log.
      hasSnapshot: false,
      restore: () => this.loadReleases(),
    };
    this.handlers = {
      runCommand: async (message) => {
        if (isRunnableFromHelp(help.manifest, message.command)) {
          await vscode.commands.executeCommand(message.command);
        }
      },
      openGuide: (message, page) => this.showGuide(page, message.page, message.anchor),
      openChangelog: () =>
        vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(help.extensionUri, 'CHANGELOG.md')),
    };
  }

  /** Reads What's new's releases again, before Help is drawn in a panel. */
  public async loadReleases(): Promise<void> {
    this.releases = (await this.help.whatsNew?.releases()) ?? [];
  }

  /**
   * Runs `draw` with Help's HTML opening at `anchor`. Only a new panel's
   * first HTML takes one; a redraw after a theme change opens at the top.
   */
  public drawingAt<T>(anchor: string | undefined, draw: () => T): T {
    this.anchor = anchor;
    try {
      return draw();
    } finally {
      this.anchor = undefined;
    }
  }

  /** Help's HTML, at the section asked for while one is. */
  public html(webview: vscode.Webview, theme: DeckardTheme): string {
    const newSince = this.help.whatsNew?.newSince();
    return getHelpHtml(webview, this.help.extensionUri, this.help.manifest, {
      releases: this.releases,
      ...(newSince ? { newSince } : {}),
      ...(this.anchor ? { anchor: this.anchor } : {}),
      theme,
    });
  }

  /** Help is drawn whole in its HTML, so there is never a snapshot to send. */
  public buildSnapshot(): undefined {
    return undefined;
  }

  /**
   * Starts VS Code's Markdown extension as Help opens, made new or
   * restored, so the first guide page it shows does not wait on it.
   */
  public onDidAttach(): void {
    warmGuideRenderer();
  }

  /**
   * Shows a guide page in the panel, read from the copy the VSIX ships and
   * rendered by VS Code's Markdown extension. A page that cannot be read,
   * or rendered, says so where the page would be.
   */
  private async showGuide(page: PageContext, name: string, anchor?: string): Promise<void> {
    if (!page.surface || !isGuidePage(name)) {
      return;
    }
    const html = await this.guideHtml(name);
    const message: HelpGuideMessage = {
      type: 'guide',
      page: name,
      title: GUIDE_PAGES[name],
      html,
      ...(anchor ? { anchor } : {}),
    };
    // The panel is looked up again once the page is rendered, so a Help
    // opened again meanwhile is the one sent the page; as before the move,
    // one closed meanwhile is not checked for.
    void page.surface!.webview.postMessage(message);
  }

  /**
   * A guide page's HTML for the panel: the page rendered, or a sentence
   * saying it could not be read, with the page on GitHub, or could not be
   * rendered, with the page on the guide's site.
   */
  private async guideHtml(name: string): Promise<string> {
    let source: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.help.extensionUri, 'docs', 'guide', `${name}.md`),
      );
      source = Buffer.from(bytes).toString('utf8');
    } catch {
      return '<p>Deckard could not read this page of the guide. It is also on GitHub, at <a href="https://github.com/doctorallen/deckard/blob/master/docs/guide/' + name + '.md">docs/guide/' + name + '.md</a>.</p>';
    }
    try {
      return await renderGuidePage(source);
    } catch {
      return guideUnavailableHtml(name);
    }
  }
}
