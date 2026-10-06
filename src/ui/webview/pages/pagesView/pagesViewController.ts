import * as vscode from 'vscode';

import type { IndexReader } from '../../../../core/workspace/indexReader';
import type { PagesViewPageToHost, PagesViewSnapshot } from '../../../protocol/pagesView';
import { isPageShown, readPagesStyle } from '../../../state/pagesViewChoices';
import { listDeckardPages } from '../../../state/deckardPages';
import { readPageFacts } from '../../../views/pagesTree';
import type { PageChrome } from '../../components';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { goToPage } from '../../host/sharedHandlers';
import { getPagesViewHtml } from '../../pagesViewHtml';
import { narrowPagesViewMessage } from './messages';

/** What Pages reads its hints from, and where its sheets are. */
export interface PagesViewControllerOptions {
  indexer: Pick<IndexReader, 'getSnapshot'>;
  extensionUri: vscode.Uri;
}

/**
 * The Pages view, first in the Deckard sidebar: every Deckard page the
 * reader keeps there, as labeled rows with what is worth knowing about
 * each now, or as a row of their icons for a reader who knows them. Each
 * opens its page by the command the page list names.
 */
export class PagesViewController implements PageController<PagesViewSnapshot, PagesViewPageToHost> {
  public readonly name = 'Pages';
  /** Drawn again from its last snapshot when shown, which is cheap enough to build into the HTML. */
  public readonly options: PageOptions = {
    retainContextWhenHidden: false,
    enableFindWidget: false,
    followIndexing: false,
    readsInertState: true,
    embedsSnapshot: true,
  };
  public readonly narrow = narrowPagesViewMessage;
  public readonly handlers: MessageHandlers<PagesViewPageToHost> = { goToPage: goToPage() };

  /** Reads the hints from `pages.indexer`. */
  public constructor(private readonly pages: PagesViewControllerOptions) {}

  /** The view's HTML, carrying `state` to draw at once when given one. */
  public html(webview: vscode.Webview, chrome: PageChrome, state?: PagesViewSnapshot): string {
    return getPagesViewHtml(webview, this.pages.extensionUri, chrome, state);
  }

  /** The pages kept, in the page list's order, with their hints as the notes are now. */
  public buildSnapshot(): PagesViewSnapshot {
    const configuration = vscode.workspace.getConfiguration('deckard');
    return {
      style: readPagesStyle(configuration),
      pages: listDeckardPages(readPageFacts(this.pages.indexer))
        .filter((page) => isPageShown(configuration, page.id))
        .map(({ id, label, description, detail }) => ({ id, label, description, detail })),
    };
  }

  /** Redraws when the reader changes what Pages shows, and when the window comes back, which a new day shows on. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    return [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.pages')) {
          page.refresh();
        }
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          page.refresh();
        }
      }),
    ];
  }
}
