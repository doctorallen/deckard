import * as vscode from 'vscode';

import type { IndexReader, IndexScanStatus, IndexUpdates } from '../../core/workspace/indexReader';
import { NavigationService } from '../../services/navigationService';
import type { NotePagePageToHost, NotePageSnapshot } from '../protocol/notePage';
import type { TaskWrites } from '../commands/taskActions';
import { PanelAdapter } from './host/panelAdapter';
import { WebviewHost } from './host/webviewHost';
import { NoteLocation, NotePageController } from './pages/notePage/notePageController';
import type { ActiveNotePage } from './activeNotePage';
import type { ThemePreview } from './themePreview';

/** What the note page is built from. */
export interface NotePagePanelOptions {
  indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  writes: TaskWrites;
  extensionUri: vscode.Uri;
  onOpenTag: (tagKey: string) => void | Promise<void>;
  /** The theme Choose Theme… is previewing, which the page draws in. */
  themePreview: ThemePreview;
  /** Where the page says it is in front, so Related Notes follows its note. */
  activeNotePage?: ActiveNotePage;
  /** Opens a search on a search page of its own. */
  onOpenSearch?: (query: string) => void | Promise<void>;
}

/** Where the note page is shown: beside the editor, or in a group, the active one unless named. */
export interface NotePageShowing {
  beside?: boolean;
  /** Beside, without taking the focus. */
  preserveFocus?: boolean;
  column?: vscode.ViewColumn;
}

/**
 * One note, read in a Deckard page: `NotePageController`, run by a
 * `WebviewHost` in one panel, reused for each note as VS Code's preview tab
 * is; this is the name the extension and its serializer know it by.
 */
export class NotePagePanel implements vscode.Disposable {
  private readonly controller: NotePageController;
  private readonly page: PanelAdapter<NotePageSnapshot, NotePagePageToHost>;

  /** Builds the page; nothing is shown until `show` or `restore`. */
  public constructor(options: NotePagePanelOptions) {
    this.controller = new NotePageController({
      indexer: options.indexer,
      writes: options.writes,
      navigation: new NavigationService(),
      onOpenTag: options.onOpenTag,
      extensionUri: options.extensionUri,
      activeNotePage: options.activeNotePage,
      onOpenSearch: options.onOpenSearch,
    });
    this.page = new PanelAdapter(
      new WebviewHost(this.controller, { indexer: options.indexer, themePreview: options.themePreview }),
      { viewType: 'deckard.notePage', title: 'Note', extensionUri: options.extensionUri, icon: ['resources', 'deckard.svg'] },
    );
  }

  /**
   * Shows a note on the page, scrolled to `line` when given, opening the
   * page, or bringing it forward: in `column`, the active group unless
   * told, as Markdown's Open Preview takes the place of the editor in its
   * group; or beside the editor when asked, with `preserveFocus` without
   * taking the focus from where it was asked, as Find, which stays open,
   * asks. A page open in another group moves to the one asked for.
   */
  public async show(location: NoteLocation, how: NotePageShowing = {}): Promise<void> {
    this.controller.navigate(location);
    const column = how.beside ? vscode.ViewColumn.Beside : (how.column ?? vscode.ViewColumn.Active);
    const preserveFocus = how.beside === true && how.preserveFocus === true;
    const panel = this.page.open({ viewColumn: column, preserveFocus });
    panel.reveal(column, preserveFocus);
    await this.page.host.whenPublished();
    this.page.host.refresh();
  }

  /** The note shown, if the page is open. */
  public get location(): NoteLocation | undefined {
    return this.page.panel ? this.controller.location : undefined;
  }

  /** Takes back the note page VS Code kept across a reload, with the note it showed. */
  public restore(panel: vscode.WebviewPanel, state?: unknown): Promise<void> {
    return this.page.restore(panel, state);
  }

  /** Closes the page, if it is open, and stops every listener. */
  public dispose(): void {
    this.page.dispose();
  }
}
