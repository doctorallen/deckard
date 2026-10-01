import type * as vscode from 'vscode';

import type { RelatedNotesDebugPageToHost } from '../../../protocol/relatedNotesDebug';
import type { MessageHandlers, PageController, PageOptions } from '../../host/pageController';
import { getRelatedNotesDebugHtml } from '../../relatedNotesDebugHtml';
import type { EntryRelatedNotesDiagnostic } from '../../sidebarNotes';
import type { DeckardTheme } from '../../themeNames';
import { narrowRelatedNotesDebugMessage } from './messages';

/**
 * The Related Notes debug page: the full evidence calculation for one
 * Markdown entry, drawn whole into its HTML each time an entry is shown.
 * It runs no script, so it sends nothing and is sent nothing.
 */
export class RelatedNotesDebugController implements PageController<never, RelatedNotesDebugPageToHost> {
  public readonly name = 'Related Notes debug';
  public readonly options: PageOptions = {
    retainContextWhenHidden: true,
    enableFindWidget: true,
    scripts: 'off',
    // The page is drawn afresh each time an entry is shown, and a theme
    // change leaves the evidence on screen as it was drawn.
    onChromeChange: 'none',
    // It is drawn whole in its HTML, and never sent a snapshot.
    hasSnapshot: false,
  };
  public readonly narrow = narrowRelatedNotesDebugMessage;
  public readonly handlers: MessageHandlers<RelatedNotesDebugPageToHost> = {};
  /** The entry's evidence the page draws, once one has been shown. */
  private diagnostic: EntryRelatedNotesDiagnostic | undefined;

  /** Keeps the evidence the next HTML draws. */
  public setDiagnostic(diagnostic: EntryRelatedNotesDiagnostic): void {
    this.diagnostic = diagnostic;
  }

  /**
   * The page's HTML, drawing the evidence kept last. Only `show` draws it,
   * after keeping the evidence, so it is never empty on screen.
   */
  public html(webview: vscode.Webview, theme: DeckardTheme): string {
    return this.diagnostic ? getRelatedNotesDebugHtml(webview, this.diagnostic, theme) : '';
  }

  /** The evidence is drawn whole in the HTML, so there is never a snapshot to send. */
  public buildSnapshot(): undefined {
    return undefined;
  }
}
