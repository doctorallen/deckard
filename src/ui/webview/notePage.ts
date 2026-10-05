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

/** One note page: its controller, and the panel it is kept in. */
interface OpenNotePage {
  readonly controller: NotePageController;
  readonly page: PanelAdapter<NotePageSnapshot, NotePagePageToHost>;
}

/**
 * Notes, read in Deckard pages: each in a panel of its own, run by a
 * `NotePageController` and a `WebviewHost`, as a note opens in an editor
 * tab of its own. Opening a note that already has a page brings that page
 * forward instead of opening a second; this is the name the extension and
 * its serializer know the pages by.
 */
export class NotePagePanel implements vscode.Disposable {
  private readonly pages = new Set<OpenNotePage>();

  /** Builds nothing yet: each page is made when a note is shown or a panel restored. */
  public constructor(private readonly options: NotePagePanelOptions) {}

  /**
   * Shows a note on a page, scrolled to `line` when given: the page already
   * showing it, brought forward, else a new one, in `column`, the active
   * group unless told, as an editor tab opens; or beside the editor when
   * asked, with `preserveFocus` without taking the focus from where it was
   * asked, as Find, which stays open, asks. A page open in another group
   * moves to the one asked for.
   */
  public async show(location: NoteLocation, how: NotePageShowing = {}): Promise<void> {
    const open = this.find(location.filePath) ?? this.create();
    open.controller.navigate(location);
    const column = how.beside ? vscode.ViewColumn.Beside : (how.column ?? vscode.ViewColumn.Active);
    const preserveFocus = how.beside === true && how.preserveFocus === true;
    const panel = open.page.open({ viewColumn: column, preserveFocus });
    this.watch(open, panel);
    panel.reveal(column, preserveFocus);
    await open.page.host.whenPublished();
    open.page.host.refresh();
  }

  /** Takes back a note page VS Code kept across a reload, with the note it showed, as a page of its own. */
  public async restore(panel: vscode.WebviewPanel, state?: unknown): Promise<void> {
    const open = this.create();
    await open.page.restore(panel, state);
    this.watch(open, panel);
  }

  /** Closes every page, and stops every listener. */
  public dispose(): void {
    [...this.pages].forEach((open) => this.close(open));
  }

  /** The open page showing a note, if one is. */
  private find(filePath: string): OpenNotePage | undefined {
    return [...this.pages].find((open) => open.page.panel && open.controller.location?.filePath === filePath);
  }

  /** A new page, not yet in a panel. */
  private create(): OpenNotePage {
    const { options } = this;
    const controller = new NotePageController({
      indexer: options.indexer,
      writes: options.writes,
      navigation: new NavigationService(),
      onOpenTag: options.onOpenTag,
      extensionUri: options.extensionUri,
      activeNotePage: options.activeNotePage,
      onOpenSearch: options.onOpenSearch,
    });
    const page = new PanelAdapter(
      new WebviewHost(controller, { indexer: options.indexer, themePreview: options.themePreview }),
      { viewType: 'deckard.notePage', title: 'Note', extensionUri: options.extensionUri, icon: ['resources', 'deckard.svg'] },
    );
    const open = { controller, page };
    this.pages.add(open);
    return open;
  }

  /** Lets a page go when its panel closes, so a closed tab leaves nothing listening. */
  private watch(open: OpenNotePage, panel: vscode.WebviewPanel): void {
    if (watched.has(panel)) {
      return;
    }
    watched.add(panel);
    panel.onDidDispose(() => this.close(open));
  }

  /** Stops a page's listeners and forgets it. */
  private close(open: OpenNotePage): void {
    if (this.pages.delete(open)) {
      open.page.dispose();
    }
  }
}

/** Panels whose closing is already watched. */
const watched = new WeakSet<vscode.WebviewPanel>();
